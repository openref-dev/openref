import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contrast is computed here, not claimed in a handoff.
 *
 * THE HANDOFF SHIPPED A MEASURED FAILURE AND SAID SO. `ai-docs/design/telltale/notes.md` recorded
 * `--oref-color-fg-muted` at 4.24 on the light background and 3.82 on the dark surface, against a
 * threshold of 4.5, and named it as the ink that could least afford to be borderline because it
 * carries the micro labels at 10 px. The value was raised before this package was written. This
 * file is what stops it drifting back, and it recomputes rather than reading the corrected numbers
 * out of the notes, because a number transcribed from a document is a number nothing checks.
 *
 * THE ARITHMETIC IS HERE RATHER THAN IMPORTED. `@openref/theme` has it and is not a package a
 * theme may depend on: the dependency rule gives a theme the contract and the IR types and nothing
 * else. So every theme carries its own copy of the WCAG formula, which is a small finding recorded
 * in `THEME-BOUNDARY.md` rather than a reason to reach across the boundary.
 */

const CSS = readFileSync(
  join(import.meta.dirname, '..', '..', 'src', 'styles', 'tokens.css'),
  'utf8',
);

/** Contrast a body of text must reach to meet WCAG 2.2 AA. */
const AA_TEXT = 4.5;

/** Contrast large text, an icon or a control boundary must reach. */
const AA_LARGE = 3;

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function parseHex(value: string): Rgb {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (match === null) throw new Error(`not a hexadecimal colour: ${value}`);

  const digits = match[1] ?? '';
  const full = digits.length === 3 ? digits.replace(/[0-9a-f]/gi, (d) => `${d}${d}`) : digits;

  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

/** Relative luminance, as WCAG 2.2 defines it over linearized sRGB channels. */
function luminance(colour: Rgb): number {
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(colour.r) + 0.7152 * channel(colour.g) + 0.0722 * channel(colour.b);
}

function ratio(foreground: string, background: string): number {
  const first = luminance(parseHex(foreground));
  const second = luminance(parseHex(background));
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);

  return (lighter + 0.05) / (darker + 0.05);
}

/** Every token that has a value in one mode, with the cascade applied. */
function values(mode: 'light' | 'dark'): ReadonlyMap<string, string> {
  const applied = new Map<string, string>();
  const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

  for (const block of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (block[1] ?? '').replace(/\s+/g, ' ').trim();
    if (
      selector.includes("[data-oref-color-scheme='light']") &&
      selector.includes("[data-oref-color-scheme='dark']")
    ) {
      continue;
    }

    const dark = selector.startsWith(':root:not') || selector.startsWith('[data-oref');
    if (mode === 'light' && dark) continue;

    for (const declaration of (block[2] ?? '').matchAll(/(--oref-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      applied.set(declaration[1] ?? '', (declaration[2] ?? '').trim());
    }
  }

  return applied;
}

function token(name: string, mode: 'light' | 'dark'): string {
  const value = values(mode).get(name);
  if (value === undefined) throw new Error(`no token named ${name} in ${mode}`);
  return value;
}

/** The surfaces this theme actually puts text on. */
const SURFACES = ['--oref-color-bg', '--oref-color-surface', '--oref-color-surface-inset'];

/** What the stylesheet actually draws on what, and what each pair has to reach. */
const INKS: readonly { readonly name: string; readonly required: number }[] = [
  { name: '--oref-color-fg', required: AA_TEXT },
  { name: '--oref-color-fg-secondary', required: AA_TEXT },
  { name: '--oref-color-fg-muted', required: AA_TEXT },
  { name: '--oref-color-accent-link', required: AA_TEXT },
  { name: '--oref-color-accent-spec', required: AA_TEXT },
];

describe('colour arithmetic', () => {
  it('should give black on white the ratio WCAG defines', () => {
    // Given, When, Then. The check has to be checkable, or it is a formula nobody read.
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(ratio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });
});

describe('what telltale draws on what', () => {
  for (const mode of ['light', 'dark'] as const) {
    for (const ink of INKS) {
      for (const surface of SURFACES) {
        it(`should clear ${String(ink.required)}:1 for ${ink.name} on ${surface} in ${mode}`, () => {
          // Given
          const foreground = token(ink.name, mode);
          const background = token(surface, mode);

          // When
          const measured = ratio(foreground, background);

          // Then
          expect(
            measured,
            `${foreground} on ${background} is ${measured.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(ink.required);
        });
      }
    }
  }

  it('should clear the large text threshold for every method badge, which carries inverse ink', () => {
    // Given, a method badge is a solid colour with `--oref-color-fg-inverse` on it, at 10 px in
    // capitals, which is where a badge is least forgiving.
    const methods = [
      '--oref-color-method-get',
      '--oref-color-method-post',
      '--oref-color-method-put',
      '--oref-color-method-patch',
      '--oref-color-method-delete',
      '--oref-color-method-event',
      '--oref-color-method-sse',
    ];

    for (const mode of ['light', 'dark'] as const) {
      const inverse = token('--oref-color-fg-inverse', mode);

      // When, Then
      for (const method of methods) {
        const measured = ratio(inverse, token(method, mode));
        expect(measured, `${method} in ${mode} is ${measured.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          AA_LARGE,
        );
      }
    }
  });

  it('should keep the provenance ink readable on its own background, in both modes', () => {
    // Given, this is the mark the whole design rests on: three letters that say where a fact came
    // from. It is drawn on its own tinted background rather than on the surface.
    for (const mode of ['light', 'dark'] as const) {
      for (const level of ['declared', 'derived', 'inferred']) {
        // When
        const measured = ratio(
          token(`--oref-prov-${level}-fg`, mode),
          token(`--oref-prov-${level}-bg`, mode),
        );

        // Then
        expect(measured, `${level} in ${mode} is ${measured.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          AA_TEXT,
        );
      }
    }
  });

  it('should keep the three drift severities readable on their own backgrounds', () => {
    // Given, severity is readable without colour by the border style, which is the rule. That does
    // not excuse the colour from being legible for the readers who do see it.
    for (const mode of ['light', 'dark'] as const) {
      for (const severity of ['crit', 'warn', 'note']) {
        // When
        const measured = ratio(
          token(`--oref-drift-${severity}-fg`, mode),
          token(`--oref-drift-${severity}-bg`, mode),
        );

        // Then
        expect(
          measured,
          `${severity} in ${mode} is ${measured.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it('should clear the threshold the handoff recorded as failing, which is why this file exists', () => {
    // Given, the handoff measured `--oref-color-fg-muted` at 4.24 on the light background and 3.82
    // on the dark surface. Both were under 4.5 and both were named at handoff.
    // When
    const light = ratio(token('--oref-color-fg-muted', 'light'), token('--oref-color-bg', 'light'));
    const dark = ratio(
      token('--oref-color-fg-muted', 'dark'),
      token('--oref-color-surface', 'dark'),
    );

    // Then
    expect(light).toBeGreaterThanOrEqual(AA_TEXT);
    expect(dark).toBeGreaterThanOrEqual(AA_TEXT);
    expect(light).toBeGreaterThan(4.24);
    expect(dark).toBeGreaterThan(3.82);
  });
});

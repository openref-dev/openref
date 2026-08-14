import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTRACT_TOKEN_NAMES, THEME_SPECIFIC_TOKENS } from '../mocks/contract-tokens';

/**
 * The token stylesheet this theme ships, against the contract it answers.
 *
 * WHAT IS CHECKED IS WHETHER A NAME RESOLVES IN EACH MODE, NOT WHETHER IT IS DECLARED TWICE.
 * `ai-docs/design/CONTRACT.md` was amended on 2026-08-10 for exactly this: a token declared in the
 * light block and not overridden in the dark one does have a value in dark mode, because that is
 * what the cascade is for, and the requirement is on the resolved value. So this file applies the
 * cascade rather than counting declarations, and the two cases a declaration count would pass and
 * a resolution check fails, an empty value and a `var()` chain with no terminal, are cases here.
 *
 * WHAT THIS CANNOT SEE, SAID OUT LOUD. A value nothing can use, `--x: notacolor`, resolves to
 * `notacolor` and passes both. No generic check can catch it: a custom property has no declared
 * type. `contrast.spec.ts` is what catches it for the colours that matter, by parsing them.
 */

const CSS = readFileSync(
  join(import.meta.dirname, '..', '..', 'src', 'styles', 'tokens.css'),
  'utf8',
);

/** One block of the stylesheet: its selector text and the declarations it makes. */
interface Block {
  readonly selector: string;
  readonly values: ReadonlyMap<string, string>;
}

function blocks(css: string): readonly Block[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: Block[] = [];

  for (const match of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const values = new Map<string, string>();
    for (const declaration of (match[2] ?? '').matchAll(/(--oref-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      values.set(declaration[1] ?? '', (declaration[2] ?? '').trim());
    }
    if (values.size > 0) {
      found.push({ selector: (match[1] ?? '').replace(/\s+/g, ' ').trim(), values });
    }
  }

  return found;
}

const BLOCKS = blocks(CSS);

/**
 * What a name resolves to in one mode, with the cascade applied in source order.
 *
 * @param mode - Which colour scheme is in force
 * @returns Every token that has a value, and what it is
 */
function resolved(mode: 'light' | 'dark'): ReadonlyMap<string, string> {
  const applied = new Map<string, string>();

  for (const block of BLOCKS) {
    // The reduced motion block names every selector it has to beat, which is what makes it the one
    // block carrying both scheme attributes, and it is orthogonal to the scheme.
    const reduced =
      block.selector.includes("[data-oref-color-scheme='light']") &&
      block.selector.includes("[data-oref-color-scheme='dark']");
    if (reduced) continue;

    const dark = block.selector.startsWith(':root:not') || block.selector.startsWith('[data-oref');

    // THE LIGHT BLOCK APPLIES IN DARK MODE TOO, which is the whole reason the dark blocks may
    // declare only what changes. A resolution that skipped it would report every unchanged token
    // as unresolved in dark, which is a wrong answer that looks like a strict one.
    if (mode === 'light' && dark) continue;

    for (const [name, value] of block.values) applied.set(name, value);
  }

  return applied;
}

/** Follows a `var()` chain to the value that is not one, or the empty string when there is none. */
function terminal(
  name: string,
  values: ReadonlyMap<string, string>,
  seen = new Set<string>(),
): string {
  if (seen.has(name)) return '';
  seen.add(name);

  const value = values.get(name);
  if (value === undefined) return '';

  const alias = /^var\((--oref-[a-z0-9-]+)\)$/.exec(value.trim());
  return alias === null ? value.trim() : terminal(alias[1] ?? '', values, seen);
}

describe('the token stylesheet telltale ships', () => {
  it('should resolve all 122 core names with the light mode in force', () => {
    // Given
    const values = resolved('light');

    // When
    const unresolved = CONTRACT_TOKEN_NAMES.filter((name) => terminal(name, values) === '');

    // Then
    expect(unresolved).toEqual([]);
    expect(CONTRACT_TOKEN_NAMES).toHaveLength(122);
  });

  it('should resolve all 122 core names with the dark mode in force', () => {
    // Given, this is the half a declaration count in one block cannot answer: a theme that names
    // 109 in light and 80 in dark has 29 names that resolve to nothing for half its readers, and
    // it looks complete in whichever mode its author works in.
    const values = resolved('dark');

    // When
    const unresolved = CONTRACT_TOKEN_NAMES.filter((name) => terminal(name, values) === '');

    // Then
    expect(unresolved).toEqual([]);
  });

  it('should resolve this theme own six in both modes as well', () => {
    // Given, the contract allows a theme its own tokens on top of the core set. What it does not
    // allow is one that exists in a single mode, for the same reason.
    // When, Then
    for (const mode of ['light', 'dark'] as const) {
      const values = resolved(mode);
      const unresolved = THEME_SPECIFIC_TOKENS.filter((name) => terminal(name, values) === '');
      expect(unresolved, `unresolved in ${mode}`).toEqual([]);
    }
  });

  it('should declare nothing outside the core set and this theme own six', () => {
    // Given, a token this theme invented and did not record would be a name no other theme has and
    // nothing says so, which is how a contract stops being one.
    const known = new Set([...CONTRACT_TOKEN_NAMES, ...THEME_SPECIFIC_TOKENS]);

    // When
    const declared = new Set(BLOCKS.flatMap((block) => [...block.values.keys()]));
    const stray = [...declared].filter((name) => !known.has(name));

    // Then
    expect(stray).toEqual([]);
  });

  it('should carry `--oref-color-accent-signal`, which the contract gives this theme alone', () => {
    // Given, `ai-docs/design/CONTRACT.md` says it is telltale's own and must not appear in vernier
    // or forge. This theme has one accent where vernier has two, so `accent-spec` and
    // `accent-runtime` are the same value here, deliberately, and the separation is carried by
    // position and by the provenance mark instead.
    const values = resolved('light');

    // When, Then
    expect(terminal('--oref-color-accent-signal', values)).not.toBe('');
    expect(terminal('--oref-color-accent-spec', values)).toBe(
      terminal('--oref-color-accent-runtime', values),
    );
  });

  it('should let the system preference apply the dark values with no attribute set', () => {
    // Given, this is the correction this package made against its own handoff, which wrote the
    // dark values under `[data-oref-color-scheme='dark']` alone and said so. A reader who has told
    // their operating system they want a dark interface has answered the question.
    // When, Then
    expect(CSS).toContain('@media (prefers-color-scheme: dark)');
    expect(CSS).toContain(":root:not([data-oref-color-scheme='light'])");
  });

  it('should let an explicit attribute beat the system preference, by coming after it', () => {
    // Given, source order decides between two rules of equal specificity, so the attribute block
    // has to come last rather than merely exist.
    // When
    const media = CSS.indexOf('@media (prefers-color-scheme: dark)');
    const attribute = CSS.indexOf("[data-oref-color-scheme='dark'] {");

    // Then
    expect(media).toBeGreaterThan(-1);
    expect(attribute).toBeGreaterThan(media);
  });

  it('should collapse every duration onto the zero token under reduced motion', () => {
    // Given, motion is a token group so that a theme reduces motion in the token layer and a
    // checker can read whether it did. A theme answering `prefers-reduced-motion` in its own
    // rules answers where nothing can see it.
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}\s*$/.exec(CSS);

    // When
    const body = reduced?.[1] ?? '';

    // Then both durations alias the zero, and the easing is left alone: a transition of zero
    // duration has no curve to travel.
    expect(body).toContain('--oref-motion-duration-fast: var(--oref-motion-duration-none);');
    expect(body).toContain('--oref-motion-duration-base: var(--oref-motion-duration-none);');
    expect(body).not.toContain('--oref-motion-easing-standard');
  });

  it('should repeat in the reduced motion block every selector it has to beat', () => {
    // Given, coming last only wins on equal specificity. The dark block is two selectors and a
    // plain `:root` is one, so a reader who wants a dark interface and no animation would have
    // kept the animation, and only that reader would ever have found out.
    const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));

    // When, Then
    expect(reduced).toContain(':root,');
    expect(reduced).toContain(":root:not([data-oref-color-scheme='light'])");
    expect(reduced).toContain("[data-oref-color-scheme='light']");
    expect(reduced).toContain("[data-oref-color-scheme='dark']");
  });

  it('should write no dark declaration that repeats its light value', () => {
    // Given, the dark blocks declare only what changes, which is what the cascade is for. A
    // declaration that repeats the light value is bytes the browser parses for nothing, and the
    // measurement that settled this on the default theme was 38,786 parsed against 6,499
    // transferred.
    const light = resolved('light');
    const dark = BLOCKS.filter((block) => block.selector.includes("color-scheme='dark'] {"));

    // When
    const repeated = dark.flatMap((block) =>
      [...block.values].filter(([name, value]) => light.get(name) === value).map(([name]) => name),
    );

    // Then
    expect(repeated).toEqual([]);
  });
});

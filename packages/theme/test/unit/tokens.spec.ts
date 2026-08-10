import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALL_TOKENS,
  COLOR_SCHEME_ATTRIBUTE,
  DARK_TOKEN_VALUES,
  LIGHT_TOKEN_VALUES,
  MOTION_DURATION_TOKENS,
  MOTION_ZERO_TOKEN,
  renderTokensCss,
  THEME_SPECIFIC_TOKENS,
  THEME_TOKENS,
} from '../../src/index';
import { CONTRACT_TOKEN_NAMES } from '../mocks/contract-tokens';

const TOKENS_CSS = join(import.meta.dirname, '..', '..', 'src', 'styles', 'tokens.css');
const TOKEN_NAME = /^--oref-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Reads the custom property declarations out of a stylesheet, keyed by name.
 *
 * Comparing declarations rather than bytes is deliberate. Prettier reformats this file, and a
 * byte comparison would break on a line wrap while saying nothing about the values. What must
 * not drift is what the file declares.
 *
 * Two normalizations, and both are prettier's doing rather than a convenience. It collapses a
 * wrapped value onto several lines, which is the run of whitespace. It also puts a space after
 * an opening bracket and before a closing one when it wraps a function, so the gradient in
 * `--oref-layout-tick` comes back with brackets the generator did not write. Neither changes
 * what the declaration means, and no value in this file is whitespace sensitive.
 */
function declarations(css: string): Map<string, string>[] {
  const blocks = css.split('}').filter((block) => block.includes('--oref-'));

  return blocks.map((block) => {
    const found = new Map<string, string>();
    for (const match of block.matchAll(/(--oref-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      const value = (match[2] ?? '')
        .replace(/\s+/g, ' ')
        .replace(/\(\s+/g, '(')
        .replace(/\s+\)/g, ')')
        .trim();
      found.set(match[1] ?? '', value);
    }
    return found;
  });
}

describe('the token set', () => {
  it('should name every token --oref-{group}-{name}', () => {
    // Given
    const names = ALL_TOKENS.map((token) => token.name);

    // When
    const malformed = names.filter((name) => !TOKEN_NAME.test(name));

    // Then
    expect(malformed).toEqual([]);
  });

  it('should start every token name with its own group', () => {
    // Given
    const wrong = ALL_TOKENS.filter((token) => !token.name.startsWith(`--oref-${token.group}-`));

    // When
    const names = wrong.map((token) => token.name);

    // Then
    expect(names).toEqual([]);
  });

  it('should declare every token exactly once', () => {
    // Given
    const names = ALL_TOKENS.map((token) => token.name);

    // When
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);

    // Then
    expect(duplicates).toEqual([]);
  });

  it('should describe every token, so an author can override it without guessing', () => {
    // Given
    const undescribed = ALL_TOKENS.filter((token) => token.description.trim() === '');

    // When
    const names = undescribed.map((token) => token.name);

    // Then
    expect(names).toEqual([]);
  });

  it('should hold exactly the 109 names the design contract fixes', () => {
    // Given, the contract list is transcribed in the mock, so a rename shows up as a diff here
    // rather than as a theme that silently stops conforming.
    const declared = THEME_TOKENS.map((token) => token.name).sort((a, b) => a.localeCompare(b));

    // When
    const contract = [...CONTRACT_TOKEN_NAMES].sort((a, b) => a.localeCompare(b));

    // Then
    expect(declared).toEqual(contract);
    expect(THEME_TOKENS).toHaveLength(109);
  });

  it('should group the core set the way the contract groups it', () => {
    // Given
    const required = [
      'color',
      'font',
      'space',
      'radius',
      'border',
      'shadow',
      'focus',
      'layout',
      'prov',
      'state',
      'drift',
      'motion',
      'scrim',
    ];

    // When
    const groups = new Set(THEME_TOKENS.map((token) => token.group));

    // Then
    expect([...groups].sort((a, b) => a.localeCompare(b))).toEqual(
      [...required].sort((a, b) => a.localeCompare(b)),
    );
  });

  it('should keep this theme own tokens out of the core set', () => {
    // Given, the contract allows a theme its own tokens and names vernier two.
    const names = THEME_SPECIFIC_TOKENS.map((token) => token.name);

    // When
    const leaked = names.filter((name) => CONTRACT_TOKEN_NAMES.includes(name));

    // Then
    expect(leaked).toEqual([]);
    expect(names).toEqual(['--oref-layout-gutter', '--oref-layout-tick', '--oref-layout-nav-row']);
    expect(ALL_TOKENS).toHaveLength(THEME_TOKENS.length + THEME_SPECIFIC_TOKENS.length);
  });

  it('should give the light and dark value maps the same keys', () => {
    // Given, a token present in one scheme and absent in the other would be unset there.
    const light = Object.keys(LIGHT_TOKEN_VALUES).sort((a, b) => a.localeCompare(b));

    // When
    const dark = Object.keys(DARK_TOKEN_VALUES).sort((a, b) => a.localeCompare(b));

    // Then
    expect(dark).toEqual(light);
  });

  it('should fall back to the light value for a token with no dark variant', () => {
    // Given
    const shared = ALL_TOKENS.filter((token) => token.dark === undefined);

    // When
    const differing = shared.filter((token) => DARK_TOKEN_VALUES[token.name] !== token.value);

    // Then
    expect(differing.map((token) => token.name)).toEqual([]);
  });
});

describe('the generated token stylesheet', () => {
  it('should declare exactly what the token set declares', () => {
    // Given, the committed file is what ships; the generator is what defines it.
    const committed = declarations(readFileSync(TOKENS_CSS, 'utf8'));

    // When
    const generated = declarations(renderTokensCss());

    // Then
    expect(committed).toEqual(generated);
  });

  it('should carry the light values in the root block', () => {
    // Given
    const [root] = declarations(readFileSync(TOKENS_CSS, 'utf8'));

    // When
    const bg = root?.get('--oref-color-bg');

    // Then
    expect(bg).toBe(LIGHT_TOKEN_VALUES['--oref-color-bg']);
  });

  it('should let an explicit scheme attribute override the system preference', () => {
    // Given, the attribute block comes last, so it wins on equal specificity.
    const css = readFileSync(TOKENS_CSS, 'utf8');

    // When
    const mediaAt = css.indexOf('@media (prefers-color-scheme: dark)');
    const attributeAt = css.indexOf(`[${COLOR_SCHEME_ATTRIBUTE}='dark']`);

    // Then
    expect(mediaAt).toBeGreaterThan(0);
    expect(attributeAt).toBeGreaterThan(mediaAt);
  });

  it('should give both colour schemes the identical name list', () => {
    // Given, the contract requires it, and a block that declares only what changes means
    // something different when it is read on its own: in a theme editor, in a conformance
    // checker, or copied into a shadow root.
    const blocks = declarations(readFileSync(TOKENS_CSS, 'utf8'));
    const [light, media, attribute] = blocks;

    // When
    const names = (block: Map<string, string> | undefined): string[] =>
      [...(block?.keys() ?? [])].sort((a, b) => a.localeCompare(b));

    // Then, four blocks: the three scheme blocks carry the identical name list, and the fourth
    // is the reduced motion block, which deliberately carries the durations and nothing else.
    expect(blocks).toHaveLength(4);
    expect(names(media)).toEqual(names(light));
    expect(names(attribute)).toEqual(names(light));
    expect(names(light)).toHaveLength(ALL_TOKENS.length);
  });

  it('should carry the dark values in both dark blocks', () => {
    // Given
    const [, media, attribute] = declarations(readFileSync(TOKENS_CSS, 'utf8'));

    // When
    const bg = DARK_TOKEN_VALUES['--oref-color-bg'];

    // Then
    expect(media?.get('--oref-color-bg')).toBe(bg);
    expect(attribute?.get('--oref-color-bg')).toBe(bg);
  });

  it('should collapse every duration to zero under prefers-reduced-motion', () => {
    // Given, this is why motion is a token group at all. A theme that answers reduced motion in
    // its own stylesheet answers it somewhere nothing can read, and three themes then disagree
    // silently. Answered in the token layer, it is one declaration a checker can find.
    const blocks = declarations(readFileSync(TOKENS_CSS, 'utf8'));
    const reduced = blocks.at(-1);
    const zero = LIGHT_TOKEN_VALUES[MOTION_ZERO_TOKEN];

    // When
    const durations = MOTION_DURATION_TOKENS.filter((name) => name !== MOTION_ZERO_TOKEN);
    const unreduced = durations.filter(
      (name) => reduced?.get(name) !== `var(${MOTION_ZERO_TOKEN})`,
    );

    // Then
    expect(zero).toBe('0s');
    expect(unreduced).toEqual([]);
    expect([...(reduced?.keys() ?? [])]).toEqual(durations);
  });

  it('should put the reduced motion block after every block it has to beat', () => {
    // Given
    const css = readFileSync(TOKENS_CSS, 'utf8');

    // When
    const reducedAt = css.indexOf('@media (prefers-reduced-motion: reduce)');
    const attributeAt = css.indexOf(`[${COLOR_SCHEME_ATTRIBUTE}='dark'] {`);

    // Then
    expect(reducedAt).toBeGreaterThan(attributeAt);
    for (const selector of [':root', `[${COLOR_SCHEME_ATTRIBUTE}='light']`]) {
      expect(css.slice(reducedAt)).toContain(selector);
    }
  });

  it('should repeat the dark selector, which coming last is not enough to beat', () => {
    // Given, coming last only wins on EQUAL specificity. The dark block is
    // `:root:not([data-oref-color-scheme='light'])`, which is two, and a plain `:root` is one:
    // without this selector a reader who wants a dark interface and no animation keeps the
    // animation, silently, and only that reader ever finds out. Measured on the committed file:
    // removing this one line makes the theme-motion gate report both durations still running.
    const css = readFileSync(TOKENS_CSS, 'utf8');

    // When
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));

    // Then
    expect(reduced).toContain(`:root:not([${COLOR_SCHEME_ATTRIBUTE}='light'])`);
  });

  it('should leave the easing curve alone, since a zero duration has none to run', () => {
    // Given, reducing motion means not moving, not moving differently.
    const reduced = declarations(readFileSync(TOKENS_CSS, 'utf8')).at(-1);

    // When
    const ease = reduced?.get('--oref-motion-easing-standard');

    // Then
    expect(ease).toBeUndefined();
    expect(LIGHT_TOKEN_VALUES['--oref-motion-easing-standard']).toBe(
      'cubic-bezier(0.2, 0, 0.13, 1)',
    );
  });

  it('should follow the system preference without an attribute', () => {
    // Given, a reader who told the operating system they want a dark interface has already
    // answered; the attribute exists to force a scheme, not to be the only way to reach one.
    const css = readFileSync(TOKENS_CSS, 'utf8');

    // When
    const query = css.includes('@media (prefers-color-scheme: dark)');

    // Then
    expect(query).toBe(true);
    expect(css).toContain(`:root:not([${COLOR_SCHEME_ATTRIBUTE}='light'])`);
  });
});

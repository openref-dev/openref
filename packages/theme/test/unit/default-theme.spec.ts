import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DARK_TOKEN_VALUES,
  DEFAULT_THEME_NAME,
  DEFAULT_THEME_STYLESHEETS,
  defaultDarkTheme,
  defaultTheme,
  LIGHT_TOKEN_VALUES,
  PACKAGE_NAME,
} from '../../src/index';
import { ALL_TOKENS } from '../../src/index';

const SRC = join(import.meta.dirname, '..', '..', 'src');
const THEME_CSS = join(SRC, 'styles', 'theme.css');

describe('@openref/theme', () => {
  it('should keep its own name', () => {
    // Given
    const expected = '@openref/theme';

    // When
    const actual = PACKAGE_NAME;

    // Then
    expect(actual).toBe(expected);
  });

  it('should import no workspace package and no framework, per STANDARDS 3.5', () => {
    // Given, the graph linter checks this too. Doing it here as well means the property is
    // stated where the reason for it lives, and it fails in the suite rather than only in CI.
    const sources = [
      'index.ts',
      'tokens/domain/tokens.ts',
      'tokens/domain/css.ts',
      'tokens/domain/color.ts',
      'theme/api/default-theme.ts',
    ];

    // When
    const offending = sources.filter((file) => {
      const source = readFileSync(join(SRC, file), 'utf8');
      return /from\s+'(?:@openref\/|vue|@nestjs\/)/.test(source);
    });

    // Then
    expect(offending).toEqual([]);
  });
});

describe('the default theme', () => {
  it('should carry the light token values by default', () => {
    // Given
    const expected = LIGHT_TOKEN_VALUES;

    // When
    const actual = defaultTheme.tokens;

    // Then
    expect(actual).toEqual(expected);
    expect(defaultTheme.name).toBe(DEFAULT_THEME_NAME);
  });

  it('should offer a variant whose defaults are the dark values', () => {
    // Given
    const expected = DARK_TOKEN_VALUES;

    // When
    const actual = defaultDarkTheme.tokens;

    // Then
    expect(actual).toEqual(expected);
    expect(defaultDarkTheme.name).toBe(DEFAULT_THEME_NAME);
  });

  it('should list tokens before the theme stylesheet, since the second reads the first', () => {
    // Given
    const expected = [
      '@openref/theme/fonts.css',
      '@openref/theme/tokens.css',
      '@openref/theme/theme.css',
    ];

    // When
    const actual = [...DEFAULT_THEME_STYLESHEETS];

    // Then
    expect(actual).toEqual(expected);
    expect(defaultTheme.assets.css).toEqual(expected);
  });

  it('should resolve every stylesheet it names through the package exports', () => {
    // Given
    const exports = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };

    // When
    const unresolvable = DEFAULT_THEME_STYLESHEETS.filter(
      (specifier) => exports.exports[specifier.replace('@openref/theme', '.')] === undefined,
    );

    // Then
    expect(unresolvable).toEqual([]);
  });
});

describe('the default stylesheet', () => {
  it('should use only tokens that the token set declares', () => {
    // Given
    const css = readFileSync(THEME_CSS, 'utf8');
    const declared = new Set(ALL_TOKENS.map((token) => token.name));

    // When
    const used = [...css.matchAll(/var\((--oref-[a-z0-9-]+)/g)].map((match) => match[1] ?? '');
    const unknown = [...new Set(used)].filter((name) => !declared.has(name));

    // Then
    expect(unknown).toEqual([]);
  });

  it('should prefix every class it styles with oref-', () => {
    // Given, comments are stripped first: a file name in prose has a dot in it and would
    // otherwise be read as a class selector.
    const css = readFileSync(THEME_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

    // When
    const classes = [...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => match[1] ?? '');
    const unprefixed = [...new Set(classes)].filter((name) => !name.startsWith('oref-'));

    // Then
    expect(unprefixed).toEqual([]);
  });

  it('should time every motion it writes with a motion token', () => {
    // Given, nothing in this file moves today, and the assertion is written for the day
    // something does: a duration is a token like every other value, so a literal one here is a
    // value an L0 consumer cannot reach and a duration a reduced motion reader cannot stop.
    const css = readFileSync(THEME_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

    // When
    const timings = [...css.matchAll(/(?:^|[\s;{])(transition|animation)[a-z-]*\s*:([^;]+);/gm)];
    const untokenized = timings.filter(
      ([, , value]) => !(value ?? '').includes('var(--oref-motion-'),
    );

    // Then
    expect(untokenized.map(([match]) => match.trim())).toEqual([]);
  });

  it('should answer reduced motion in the token layer and not here', () => {
    // Given, the durations collapse to zero in tokens.css, once, for every rule at the same
    // time. A block here would answer the same question in a second place, and a theme that
    // forgot to write one would look exactly like a theme that had nothing to reduce.
    // Comments are stripped: the header says this file carries no such block, and the sentence
    // saying so must not be what satisfies the check.
    const css = readFileSync(THEME_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

    // When
    const answered = css.includes('prefers-reduced-motion');

    // Then
    expect(answered).toBe(false);
  });

  it('should never remove the focus outline, only restyle it', () => {
    // Given
    const css = readFileSync(THEME_CSS, 'utf8');

    // When
    const removed = /outline\s*:\s*(?:none|0)\b/.test(css);

    // Then
    expect(removed).toBe(false);
    expect(css).toContain('outline: var(--oref-focus-width)');
  });
});

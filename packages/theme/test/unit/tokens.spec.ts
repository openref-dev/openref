import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COLOR_SCHEME_ATTRIBUTE,
  DARK_TOKEN_VALUES,
  LIGHT_TOKEN_VALUES,
  renderTokensCss,
  THEME_TOKENS,
} from '../../src/index';

const TOKENS_CSS = join(import.meta.dirname, '..', '..', 'src', 'styles', 'tokens.css');
const TOKEN_NAME = /^--oref-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Reads the custom property declarations out of a stylesheet, keyed by name.
 *
 * Comparing declarations rather than bytes is deliberate. Prettier reformats this file, and a
 * byte comparison would break on a line wrap while saying nothing about the values. What must
 * not drift is what the file declares.
 */
function declarations(css: string): Map<string, string>[] {
  const blocks = css.split('}').filter((block) => block.includes('--oref-'));

  return blocks.map((block) => {
    const found = new Map<string, string>();
    for (const match of block.matchAll(/(--oref-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      found.set(match[1] ?? '', (match[2] ?? '').replace(/\s+/g, ' ').trim());
    }
    return found;
  });
}

describe('the token set', () => {
  it('should name every token --oref-{group}-{name}', () => {
    // Given
    const names = THEME_TOKENS.map((token) => token.name);

    // When
    const malformed = names.filter((name) => !TOKEN_NAME.test(name));

    // Then
    expect(malformed).toEqual([]);
  });

  it('should start every token name with its own group', () => {
    // Given
    const wrong = THEME_TOKENS.filter((token) => !token.name.startsWith(`--oref-${token.group}-`));

    // When
    const names = wrong.map((token) => token.name);

    // Then
    expect(names).toEqual([]);
  });

  it('should declare every token exactly once', () => {
    // Given
    const names = THEME_TOKENS.map((token) => token.name);

    // When
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index);

    // Then
    expect(duplicates).toEqual([]);
  });

  it('should describe every token, so an author can override it without guessing', () => {
    // Given
    const undescribed = THEME_TOKENS.filter((token) => token.description.trim() === '');

    // When
    const names = undescribed.map((token) => token.name);

    // Then
    expect(names).toEqual([]);
  });

  it('should cover colour, spacing, typography, radius and elevation, per T009', () => {
    // Given
    const required = ['color', 'space', 'font', 'radius', 'elevation'];

    // When
    const groups = new Set(THEME_TOKENS.map((token) => token.group));

    // Then
    expect(required.filter((group) => !groups.has(group as never))).toEqual([]);
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
    const shared = THEME_TOKENS.filter((token) => token.dark === undefined);

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

  it('should only emit a dark declaration for a token that actually changes', () => {
    // Given
    const changing = THEME_TOKENS.filter((token) => token.dark !== undefined).length;

    // When
    const blocks = declarations(renderTokensCss());

    // Then
    expect(blocks.at(-1)?.size).toBe(changing);
  });
});

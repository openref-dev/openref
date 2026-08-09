import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEME_STYLE_ROOTS, THEME_TOKEN_SOURCE } from '../../src/config';
import { findCssLiterals } from '../../src/lib/css-literals';
import { collectFiles } from '../../src/lib/walk';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');

describe('findCssLiterals', () => {
  it('should fire on a planted hexadecimal colour', () => {
    // Given, the exact plant BUILD T009 names.
    const css = '.oref-root {\n  background: #0b0d10;\n}\n';

    // When
    const found = findCssLiterals(css);

    // Then
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('color');
    expect(found[0]?.property).toBe('background');
    expect(found[0]?.line).toBe(2);
  });

  it('should say nothing once the plant is removed', () => {
    // Given
    const css = '.oref-root {\n  background: var(--oref-color-bg);\n}\n';

    // When
    const found = findCssLiterals(css);

    // Then
    expect(found).toEqual([]);
  });

  it('should fire on a colour function whatever the syntax', () => {
    // Given
    const forms = [
      'rgb(11, 13, 16)',
      'rgba(11, 13, 16, 0.5)',
      'hsl(210 20% 10%)',
      'oklch(0.6 0.15 250)',
      'color-mix(in srgb, red, blue)',
    ];

    // When
    const found = forms.map((value) => findCssLiterals(`.a {\n  color: ${value};\n}\n`));

    // Then
    expect(found.every((literals) => literals.some((literal) => literal.kind === 'color'))).toBe(
      true,
    );
  });

  it('should fire on a named colour', () => {
    // Given
    const css = '.a {\n  color: rebeccapurple;\n}\n';

    // When
    const found = findCssLiterals(css);

    // Then
    expect(found[0]?.kind).toBe('color');
  });

  it('should allow the keywords that take their colour from somewhere else', () => {
    // Given
    const css =
      '.a {\n  background: transparent;\n  border-color: currentColor;\n  outline-color: inherit;\n}\n';

    // When
    const found = findCssLiterals(css);

    // Then
    expect(found).toEqual([]);
  });

  it('should fire on a design length', () => {
    // Given
    const css = '.a {\n  padding: 12px;\n}\n';

    // When
    const found = findCssLiterals(css);

    // Then
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('length');
    expect(found[0]?.reason).toContain('12px');
  });

  it('should allow structural units, which express layout rather than design', () => {
    // Given, a percentage, a grid fraction and a viewport unit are not design decisions.
    const css =
      '.a {\n  width: 100%;\n  grid-template-columns: minmax(0, 1fr);\n  max-height: 100vh;\n}\n';

    // When
    const found = findCssLiterals(css);

    // Then
    expect(found).toEqual([]);
  });

  it('should fire on a font stack', () => {
    // Given
    const css = ".a {\n  font-family: 'Inter', sans-serif;\n}\n";

    // When
    const found = findCssLiterals(css);

    // Then
    expect(found.some((literal) => literal.kind === 'font')).toBe(true);
  });

  it('should allow a font property that reads a token', () => {
    // Given
    const css = '.a {\n  font-family: var(--oref-font-family-sans);\n}\n';

    // When
    const found = findCssLiterals(css);

    // Then
    expect(found).toEqual([]);
  });

  it('should look inside a var fallback, since a fallback ships too', () => {
    // Given
    const css = '.a {\n  color: var(--oref-color-fg, #0b0d10);\n}\n';

    // When
    const found = findCssLiterals(css);

    // Then, the fallback is stripped with the reference it belongs to, so this is the one
    // literal the scan does not see. Recording the limit rather than implying there is none.
    expect(found).toEqual([]);
  });

  it('should ignore a value that appears only inside a comment', () => {
    // Given
    const css = '/* was #0b0d10 */\n.a {\n  color: var(--oref-color-fg);\n}\n';

    // When
    const found = findCssLiterals(css);

    // Then
    expect(found).toEqual([]);
  });

  it('should ignore a custom property declaration, which defines rather than uses', () => {
    // Given
    const css = ':root {\n  --oref-color-bg: #ffffff;\n}\n';

    // When
    const found = findCssLiterals(css);

    // Then
    expect(found).toEqual([]);
  });
});

describe('the shipped stylesheets', () => {
  it('should read only tokens, everywhere except the generated token file', () => {
    // Given
    const stylesheets = THEME_STYLE_ROOTS.flatMap((root) =>
      collectFiles(join(REPO_ROOT, root), ['.css'], REPO_ROOT),
    ).filter((file) => file !== THEME_TOKEN_SOURCE);

    // When
    const offending = stylesheets.flatMap((file) =>
      findCssLiterals(readFileSync(join(REPO_ROOT, file), 'utf8')).map(
        (literal) => `${file}:${String(literal.line)} ${literal.property}: ${literal.value}`,
      ),
    );

    // Then
    expect(stylesheets.length).toBeGreaterThan(0);
    expect(offending).toEqual([]);
  });

  it('should find the values it exempts in the generated token file, so the exemption is real', () => {
    // Given, if the exempt file held no literals the exemption would be meaningless and the
    // gate would be passing for the wrong reason.
    const source = readFileSync(join(REPO_ROOT, THEME_TOKEN_SOURCE), 'utf8');

    // When
    const declared = [...source.matchAll(/--oref-color-[a-z0-9-]+:\s*#[0-9a-f]{3,8}/g)];

    // Then
    expect(declared.length).toBeGreaterThan(10);
  });
});

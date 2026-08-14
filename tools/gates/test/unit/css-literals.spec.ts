import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEME_STYLE_ROOTS, THEME_TOKEN_SOURCES } from '../../src/config';
import { findCssLiterals, findTokenValueLiterals } from '../../src/lib/css-literals';
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

  it('should catch a literal planted in a var fallback, since a fallback ships too', () => {
    // Given, the fallback is what renders whenever the token is not set. It reads as a safety
    // net rather than as a value, which is exactly why it is the easiest place to hide one.
    const css = '.a {\n  color: var(--oref-color-fg, #0b0d10);\n}\n';

    // When
    const found = findCssLiterals(css);

    // Then
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('color');
    expect(found[0]?.property).toBe('color');
  });

  it('should catch a literal planted in a nested var fallback', () => {
    // Given, nesting is the obvious way round a scan that only looks one level deep.
    const css = '.a {\n  color: var(--oref-color-fg, var(--oref-color-accent, #0b0d10));\n}\n';

    // When
    const found = findCssLiterals(css);

    // Then
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('color');
  });

  it('should catch a literal planted in a var fallback inside a shorthand property', () => {
    // Given
    const css =
      '.a {\n  border: var(--oref-layout-border-width) solid var(--oref-color-border, #0b0d10);\n}\n';

    // When
    const found = findCssLiterals(css);

    // Then
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('color');
    expect(found[0]?.property).toBe('border');
  });

  it('should say nothing once the fallback plants are removed', () => {
    // Given, the same three declarations with the fallbacks taken out.
    const css = [
      '.a {',
      '  color: var(--oref-color-fg);',
      '  background: var(--oref-color-bg, var(--oref-color-bg-subtle));',
      '  border: var(--oref-layout-border-width) solid var(--oref-color-border);',
      '}',
    ].join('\n');

    // When
    const found = findCssLiterals(css);

    // Then, a fallback that is itself a token is an alias, not a hardcoded value.
    expect(found).toEqual([]);
  });

  it('should catch a length and a font stack planted in a fallback, not only a colour', () => {
    // Given
    const css =
      ".a {\n  padding: var(--oref-space-2, 8px);\n  font-family: var(--oref-font-family-sans, 'Inter', sans-serif);\n}\n";

    // When
    const kinds = findCssLiterals(css).map((literal) => literal.kind);

    // Then
    expect(kinds).toContain('length');
    expect(kinds).toContain('font');
  });

  it('should keep the remainder of an unbalanced var, so a typo hides nothing', () => {
    // Given, a missing closing parenthesis is a mistake, not a licence.
    const css = '.a {\n  color: var(--oref-color-fg, #0b0d10;\n}\n';

    // When
    const found = findCssLiterals(css);

    // Then
    expect(found.some((literal) => literal.kind === 'color')).toBe(true);
  });

  it('should not mistake an identifier ending in var for a reference', () => {
    // Given
    const css = '.a {\n  color: myvar(--oref-color-fg, #0b0d10);\n}\n';

    // When
    const found = findCssLiterals(css);

    // Then, nothing was expanded, so the literal is still plainly there.
    expect(found.some((literal) => literal.kind === 'color')).toBe(true);
  });

  it('should read a fallback that carries a function of its own', () => {
    // Given, the commas and the closing parenthesis inside `rgba()` belong to it, not to the
    // reference, so a regular expression that counts neither would end the fallback early.
    const css = '.a {\n  box-shadow: var(--oref-elevation-1, 0 1px 2px rgba(0, 0, 0, 0.2));\n}\n';

    // When
    const kinds = findCssLiterals(css).map((literal) => literal.kind);

    // Then
    expect(kinds).toContain('color');
    expect(kinds).toContain('length');
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
    ).filter((file) => !THEME_TOKEN_SOURCES.includes(file));

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

  it('should let a font-face name the face it defines', () => {
    // Given, naming a self hosted face is the only way to declare one, and the token stack in
    // tokens.css refers to that name.
    const css = [
      '@font-face {',
      "  font-family: 'Space Grotesk';",
      '  font-weight: 400;',
      "  src: url('./SpaceGrotesk-400-latin.woff2') format('woff2');",
      '  unicode-range: U+0000-00FF, U+2C60-2C7F;',
      '}',
      '',
    ].join('\n');

    // When
    const found = findCssLiterals(css);

    // Then
    expect(found).toEqual([]);
  });

  it('should still catch a literal outside the font-face block in the same file', () => {
    // Given, the exemption must cover the block and not the file.
    const css = [
      '@font-face {',
      "  font-family: 'Space Grotesk';",
      '}',
      '',
      '.oref-root {',
      '  color: #0b0d10;',
      '  padding: 4px;',
      '}',
      '',
    ].join('\n');

    // When
    const found = findCssLiterals(css);

    // Then
    expect(found.map((literal) => literal.kind)).toEqual(['color', 'length']);
    expect(found[0]?.line).toBe(6);
  });

  it('should find the values it exempts in every token file, so each exemption is real', () => {
    // Given, an exempt file holding no literals would make its exemption meaningless and the gate
    // would be passing for the wrong reason. It is asked of every exempt file rather than of the
    // first, since T032 made the list plural: an exemption nobody checks is how a second theme
    // would have acquired a place to hide values.
    for (const file of THEME_TOKEN_SOURCES) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8');

      // When
      const declared = [...source.matchAll(/--oref-color-[a-z0-9-]+:\s*#[0-9a-f]{3,8}/g)];

      // Then
      expect(declared.length, file).toBeGreaterThan(10);
    }

    expect(THEME_TOKEN_SOURCES.length).toBe(2);
  });
});

/**
 * T009-R2: a colour written into a composite token value.
 *
 * The plant is the real vernier declaration as it was handed over, hex and all. It is worth
 * being exact about why it survived: `findCssLiterals` skips any property starting with `--`,
 * and the token stylesheet is exempt as a whole, so two independent reasons hid it. Either one
 * alone would have been enough.
 */
describe('findTokenValueLiterals', () => {
  const BROKEN_TICK = [
    ':root {',
    '  --oref-color-line-edge: #bfc9d2;',
    '  --oref-layout-tick: repeating-linear-gradient(',
    '    180deg,',
    '    #bfc9d2 0 1px,',
    '    transparent 1px 8px',
    '  );',
    '}',
    '',
  ].join('\n');

  const FIXED_TICK = BROKEN_TICK.replace(
    '    #bfc9d2 0 1px,',
    '    var(--oref-color-line-edge) 0 1px,',
  );

  it('should see the colour the vernier gradient repeated, across the lines prettier wrapped it onto', () => {
    // Given, the plant is the declaration as handed over.

    // When
    const found = findTokenValueLiterals(BROKEN_TICK);

    // Then
    expect(found).toHaveLength(1);
    expect(found[0]?.property).toBe('--oref-layout-tick');
    expect(found[0]?.literal).toBe('#bfc9d2');
  });

  it('should name the token that already defines the colour, so the copy fails and not the definition', () => {
    // Given
    const [finding] = findTokenValueLiterals(BROKEN_TICK);

    // When
    const named = finding?.definedBy;

    // Then
    expect(named).toBe('--oref-color-line-edge');
    expect(finding?.definedAtLine).toBe(2);
    expect(finding?.line).toBe(3);
    expect(finding?.reason).toContain('var(--oref-color-line-edge)');
  });

  it('should say nothing once the gradient references the token', () => {
    // Given, the fix that was applied to the handover.

    // When
    const found = findTokenValueLiterals(FIXED_TICK);

    // Then
    expect(found).toEqual([]);
  });

  it('should treat a colour that is the whole value as the definition it is', () => {
    // Given
    const css =
      ':root {\n  --oref-color-line-edge: #bfc9d2;\n  --oref-color-bg: rgba(1, 4, 9, 0.7);\n}\n';

    // When
    const found = findTokenValueLiterals(css);

    // Then
    expect(found).toEqual([]);
  });

  it('should not ask two semantic tokens that agree on a colour to alias one another', () => {
    // Given, six tokens in the real palette share #8a5200. Forcing five to reference the sixth
    // would assert a relationship the design does not claim.
    const css = [
      ':root {',
      '  --oref-color-accent-runtime: #8a5200;',
      '  --oref-focus-color: #8a5200;',
      '  --oref-state-warn-fg: #8a5200;',
      '}',
      '',
    ].join('\n');

    // When
    const found = findTokenValueLiterals(css);

    // Then
    expect(found).toEqual([]);
  });

  it('should see a colour inside a shadow, which is the other composite a token holds', () => {
    // Given
    const css = ':root {\n  --oref-shadow-panel: 0 1px 2px rgba(1, 4, 9, 0.6);\n}\n';

    // When
    const found = findTokenValueLiterals(css);

    // Then
    expect(found).toHaveLength(1);
    expect(found[0]?.literal).toBe('rgba(1, 4, 9, 0.6)');
    expect(found[0]?.definedBy).toBeUndefined();
  });

  it('should see a named colour inside a composite value', () => {
    // Given
    const css = ':root {\n  --oref-layout-tick: linear-gradient(180deg, rebeccapurple 0 1px);\n}\n';

    // When
    const found = findTokenValueLiterals(css);

    // Then
    expect(found.map((literal) => literal.literal)).toEqual(['rebeccapurple']);
  });

  it('should keep transparent and currentColor out of it, since neither is a colour of its own', () => {
    // Given
    const css =
      ':root {\n  --oref-layout-tick: linear-gradient(180deg, currentColor 0 1px, transparent 1px 8px);\n}\n';

    // When
    const found = findTokenValueLiterals(css);

    // Then
    expect(found).toEqual([]);
  });

  it('should see a literal hiding in a fallback inside a composite value', () => {
    // Given
    const css =
      ':root {\n  --oref-layout-tick: linear-gradient(180deg, var(--oref-color-line-edge, #bfc9d2) 0 1px);\n}\n';

    // When
    const found = findTokenValueLiterals(css);

    // Then
    expect(found.map((literal) => literal.literal)).toEqual(['#bfc9d2']);
  });

  it('should look up the definition within one block, not across the colour schemes', () => {
    // Given, the same token holds a different colour in each block, so a match from the wrong
    // block would name a definition that is not in force where the copy sits.
    const css = [
      ':root {',
      '  --oref-color-line-edge: #bfc9d2;',
      '}',
      "[data-oref-color-scheme='dark'] {",
      '  --oref-color-line-edge: #22303c;',
      '  --oref-layout-tick: linear-gradient(180deg, #22303c 0 1px);',
      '}',
      '',
    ].join('\n');

    // When
    const found = findTokenValueLiterals(css);

    // Then
    expect(found).toHaveLength(1);
    expect(found[0]?.definedBy).toBe('--oref-color-line-edge');
    expect(found[0]?.definedAtLine).toBe(5);
  });

  it('should stay silent on every token stylesheet a shipped theme carries', () => {
    // Given, the check earns its place only if the real files pass it, and there are two of them.
    for (const file of THEME_TOKEN_SOURCES) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8');

      // When
      const found = findTokenValueLiterals(source).map(
        (literal) => `${file}:${String(literal.line)} ${literal.property}: ${literal.literal}`,
      );

      // Then
      expect(found).toEqual([]);
    }
  });

  it('should find something to say about the shipped file when a copy is planted in it', () => {
    // Given, silence above must be the file being right, not the scan finding nothing anywhere.
    const source = readFileSync(join(REPO_ROOT, THEME_TOKEN_SOURCES[0] ?? ''), 'utf8');
    const planted = source.replace('var(--oref-color-line-edge) 0 1px', '#bfc9d2 0 1px');

    // When
    const found = findTokenValueLiterals(planted);

    // Then
    expect(planted).not.toBe(source);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.definedBy).toBe('--oref-color-line-edge');
  });
});

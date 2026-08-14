import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTRACT_TOKEN_NAMES, THEME_SPECIFIC_TOKENS } from '../mocks/contract-tokens';

/**
 * The stylesheet against the two rules that make it a theme rather than a skin.
 *
 * EVERY VALUE READS A TOKEN. That is what L0 theming means in practice: a consumer who sets a
 * custom property gets the change, and one literal that escaped is a value they cannot reach. The
 * `theme-tokens` gate asks this from outside over both themes; this file asks it where the theme
 * is written, and it asks the second half the gate cannot: that every token this stylesheet reads
 * is one this theme actually declares.
 *
 * A `var()` NAMING A TOKEN NOBODY DECLARES IS THE FAILURE THAT LOOKS LIKE NOTHING. It resolves to
 * the empty string, the property is dropped, and the element renders with whatever it inherited.
 * Nothing throws and nothing logs. It is the same shape as the eighth SPEC 0 class one layer down.
 */

const THEME_CSS = readFileSync(
  join(import.meta.dirname, '..', '..', 'src', 'styles', 'theme.css'),
  'utf8',
);

/** Strips comments, so a token named in prose is never counted as a use. */
const RULES = THEME_CSS.replace(/\/\*[\s\S]*?\*\//g, '');

describe('the stylesheet telltale ships', () => {
  it('should read only tokens this theme declares', () => {
    // Given
    const declared = new Set([...CONTRACT_TOKEN_NAMES, ...THEME_SPECIFIC_TOKENS]);

    // When
    const used = new Set([...RULES.matchAll(/var\((--oref-[a-z0-9-]+)/g)].map((m) => m[1] ?? ''));
    const undeclared = [...used].filter((name) => !declared.has(name));

    // Then
    expect(undeclared).toEqual([]);
    expect(used.size, 'a stylesheet that reads no token proves nothing').toBeGreaterThan(40);
  });

  it('should give no `var()` a literal fallback, which is a hardcoded value with a soft name', () => {
    // Given, a fallback reads as a safety net and is what actually ships whenever the token is not
    // set. Aliasing one token to another is fine; anything else is the value.
    // When
    const fallbacks = [...RULES.matchAll(/var\(--oref-[a-z0-9-]+\s*,\s*([^)]+)\)/g)].map(
      (match) => match[1] ?? '',
    );
    const literal = fallbacks.filter((value) => !value.trim().startsWith('var('));

    // Then
    expect(literal).toEqual([]);
  });

  it('should carry no hexadecimal colour and no named colour', () => {
    // Given, When
    const hex = RULES.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    const named = RULES.match(/:\s*(?:red|blue|green|black|white|gray|grey)\s*[;}]/gi) ?? [];

    // Then
    expect(hex).toEqual([]);
    expect(named).toEqual([]);
  });

  it('should carry no design length outside a token', () => {
    // Given, the units that express a design decision. `%`, `fr` and `vh` are absent on purpose: a
    // percentage expresses structure and a viewport unit expresses the viewport, and a theme forced
    // to invent tokens for those would be inventing them for things a design system does not own.
    // When
    const lengths = [...RULES.matchAll(/(?<![\w#-])-?(?:\d+\.?\d*|\.\d+)(px|rem|em|pt|ch|ex)\b/gi)];

    // Then
    expect(lengths.map((match) => match[0])).toEqual([]);
  });

  it('should name a family only through a token', () => {
    // Given, When
    const families = [...RULES.matchAll(/font-family:\s*([^;]+);/g)].map((match) => match[1] ?? '');

    // Then
    for (const value of families)
      expect(value.trim()).toMatch(/^var\(--oref-font-family-[a-z]+\)$/);
  });

  it('should put every varying value on a class rather than in a style attribute', () => {
    // Given, a CSP nonce can never authorize an inline `style` attribute, only a `<style>` element,
    // and working under `style-src 'self' 'nonce-...'` without `unsafe-inline` is a declared
    // competitive advantage of this project. So the depth of a tree row is a class and not a
    // padding computed in the component.
    const components = readFileSync(
      join(import.meta.dirname, '..', '..', 'src', 'components', 'SchemaTree.ts'),
      'utf8',
    );

    // When, Then the depth classes exist in both the component and the stylesheet
    expect(components).toContain('tt-tree-depth-');
    expect(RULES).toContain('.tt-tree-depth-1');
    expect(RULES).toContain('.tt-tree-depth-6');
  });

  it('should transition only through the motion tokens, so reduced motion reaches it', () => {
    // Given, the reduced motion block collapses the durations in the token layer. A transition
    // written with a literal duration would keep running for a reader who asked for none, and
    // nothing in the token layer could tell.
    // When
    const transitions = [...RULES.matchAll(/transition:\s*([^;]+);/g)].map(
      (match) => match[1] ?? '',
    );

    // Then
    expect(transitions.length).toBeGreaterThan(0);
    for (const value of transitions) {
      expect(value).toContain('var(--oref-motion-duration-');
      expect(value).toContain('var(--oref-motion-easing-standard)');
    }
  });
});

describe('the markup telltale writes', () => {
  it('should carry no inline style attribute and no inline script anywhere in the source', () => {
    // Given every component file this theme ships. The `csp` gate scans built output; this reads
    // the source, so an author meets the rule where they broke it.
    const directory = join(import.meta.dirname, '..', '..', 'src');
    const files = [
      'Layout.ts',
      'theme.ts',
      'index.ts',
      'links.ts',
      ...[
        'AuthPanel',
        'CodeSample',
        'CommandPalette',
        'DocumentOverview',
        'DriftCard',
        'HealthScore',
        'NavTree',
        'OperationHeader',
        'ParamTable',
        'ProvenanceTag',
        'ResponseList',
        'ResponseView',
        'RuntimePanel',
        'SchemaPage',
        'SchemaTree',
        'SendButton',
        'ServerSelect',
        'ShapeForm',
        'StateNotice',
        'StreamLog',
        'TelltaleBudgetMeter',
        'TelltaleSectionIndex',
        'TelltaleStatusBar',
        'media',
      ].map((name) => join('components', `${name}.ts`)),
    ];

    // When
    const offending = files.filter((file) => {
      const source = readFileSync(join(directory, file), 'utf8');
      return /\bstyle:\s*\{/.test(source) || source.includes("h('script'");
    });

    // Then
    expect(offending).toEqual([]);
    expect(files.length, 'the sweep found no files, so it proves nothing').toBe(28);
  });
});

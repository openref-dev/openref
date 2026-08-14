import { assertTheme, checkTheme } from '@openref/theme-kit';
import { SLOT_NAMES } from '@openref/vue';
import { describe, expect, it } from 'vitest';
import telltale from '../../src/theme';
import { TELLTALE_STYLESHEETS, THEME_NAME } from '../../src/index';

/**
 * This theme against the contract it claims, judged by the checker a theme author runs.
 *
 * IT USES `@openref/theme-kit` RATHER THAN COUNTING KEYS. The checker is what an author is given
 * to answer "is the contract satisfied", and a theme that checked itself with its own arithmetic
 * would be proving that its arithmetic agrees with itself. What this file adds on top is the two
 * things the checker deliberately does not do: it does not render, and it does not know that this
 * theme means to be L2.
 */

describe('telltale against the L2 contract', () => {
  it('should satisfy the level 2 contract, by the checker an author runs', () => {
    // Given
    // When
    const report = checkTheme(telltale, { level: 'L2' });

    // Then
    expect(report.problems).toEqual([]);
    expect(report.missingSlots).toEqual([]);
    expect(report.unknownSlots).toEqual([]);
    expect(report.conforms).toBe(true);
  });

  it('should not throw when asserted, which is the form a build step uses', () => {
    // Given, When, Then
    expect(() => assertTheme(telltale, { level: 'L2' })).not.toThrow();
  });

  it('should fill all 21 positions, counting the shell it writes as a layout', () => {
    // Given, `layout` and `components.AppShell` are one position by two names, and this theme
    // writes the first. The count has to include it or it would read as twenty.
    const filled = new Set(Object.keys(telltale.components ?? {}));
    if (telltale.layout !== undefined) filled.add('AppShell');

    // When
    const missing = SLOT_NAMES.filter((name) => !filled.has(name));

    // Then
    expect(missing).toEqual([]);
    expect(filled.size).toBe(SLOT_NAMES.length);
  });

  it('should declare its page shell once and never twice', () => {
    // Given, a theme that declares both is refused by `resolveTheme`, and the checker names it
    // rather than leaving the author to meet it at load time.
    // When, Then
    expect(telltale.layout).toBeTypeOf('function');
    expect(telltale.components?.AppShell).toBeUndefined();
  });

  it('should name every stylesheet through this package exports rather than by relative path', () => {
    // Given, a relative path would resolve against whoever imported the theme, and this theme is
    // consumed from another package by construction.
    // When, Then
    for (const sheet of TELLTALE_STYLESHEETS) {
      expect(sheet.startsWith('@openref/theme-telltale/')).toBe(true);
    }

    expect(telltale.assets?.css).toEqual(TELLTALE_STYLESHEETS);
  });

  it('should load the faces before the tokens and the tokens before the rules', () => {
    // Given, the order is load bearing: a face declared after the rule that asks for it still
    // applies and is fetched later than it needed to be, and everything else reads the tokens.
    // When, Then
    expect(TELLTALE_STYLESHEETS).toEqual([
      '@openref/theme-telltale/fonts.css',
      '@openref/theme-telltale/tokens.css',
      '@openref/theme-telltale/theme.css',
    ]);
  });

  it('should carry the name the package and the design are both called', () => {
    // Given, the name becomes a package name and a class name fragment, so it is lowercase words
    // joined by hyphens or the checker refuses it.
    // When, Then
    expect(telltale.name).toBe(THEME_NAME);
    expect(telltale.name).toBe('telltale');
  });

  it('should declare no token defaults, because an L2 theme ships a stylesheet instead', () => {
    // Given, `tokens` on a definition is the L0 surface: a flat record with no cascade in it, so a
    // theme that declared its 109 there would declare them once and lose the dark mode.
    // When, Then
    expect(telltale.tokens).toBeUndefined();
  });
});

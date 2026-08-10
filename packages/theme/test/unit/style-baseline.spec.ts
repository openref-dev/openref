import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DARK_TOKEN_VALUES, LIGHT_TOKEN_VALUES } from '../../src/index';

const THEME_CSS = join(import.meta.dirname, '..', '..', 'src', 'styles', 'theme.css');
const BASELINES = join(import.meta.dirname, '..', 'baselines');

/**
 * The baseline BUILD T010 asks for, in the form this repository can actually produce.
 *
 * The task says visual regression baselines, regenerated and reviewed rather than blindly
 * accepted. There is no visual regression harness in this project yet: SPEC 21 lists one and
 * nothing has built it, and standing up a browser and a screenshot differ is a task of its own,
 * not a clause of this one. Claiming a pixel baseline while diffing nothing would be worse than
 * having none.
 *
 * What is here instead is the stylesheet with every token resolved, once per colour scheme.
 * It is not a picture, and it does not catch a layout that overlaps or a line that wraps. It
 * does catch every change to what this theme paints: a colour that moved, a step of the scale
 * that changed, a rule that lost its ink. That is the class of change a design handover
 * produces, and it is reviewable as a diff by a person, which a screenshot is not.
 *
 * Regenerate with `pnpm test -u`, then read the diff. A baseline accepted without reading it
 * is a baseline that records whatever happened, which is the failure mode the task names.
 */

/** Substitutes every `var(--oref-*)` with the token value, recursively. */
function resolve(value: string, tokens: Readonly<Record<string, string>>, depth = 0): string {
  if (depth > 8 || !value.includes('var(')) return value;

  const substituted = value.replace(
    /var\(\s*(--oref-[a-z0-9-]+)\s*(?:,([^)]*))?\)/g,
    (whole, name: string, fallback: string | undefined) => {
      const token = tokens[name];
      if (token !== undefined) return token;
      // A token the set does not carry: keep the reference visible rather than emptying it, so a
      // missing token reads as a missing token in the baseline instead of as a missing value.
      return fallback === undefined ? whole : fallback.trim();
    },
  );

  return substituted === value ? value : resolve(substituted, tokens, depth + 1);
}

/** The stylesheet with comments dropped, whitespace regular, and every token substituted. */
function resolved(tokens: Readonly<Record<string, string>>): string {
  const css = readFileSync(THEME_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => {
    const selector = (match[1] ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .join(',\n');

    const declarations = (match[2] ?? '')
      .split(';')
      .map((declaration) => declaration.replace(/\s+/g, ' ').trim())
      .filter((declaration) => declaration !== '')
      .map((declaration) => `  ${resolve(declaration, tokens)};`)
      .join('\n');

    return `${selector} {\n${declarations}\n}`;
  });

  return `${blocks.join('\n\n')}\n`;
}

describe('the resolved style baseline', () => {
  it('should match the reviewed baseline in the light scheme', async () => {
    // Given
    const tokens = LIGHT_TOKEN_VALUES;

    // When
    const css = resolved(tokens);

    // Then
    await expect(css).toMatchFileSnapshot(join(BASELINES, 'vernier-light.css'));
  });

  it('should match the reviewed baseline in the dark scheme', async () => {
    // Given
    const tokens = DARK_TOKEN_VALUES;

    // When
    const css = resolved(tokens);

    // Then
    await expect(css).toMatchFileSnapshot(join(BASELINES, 'vernier-dark.css'));
  });

  it('should leave no unresolved token reference in either baseline', () => {
    // Given, an unresolved reference means the stylesheet reads a token the set does not
    // declare, which renders as nothing at all in a browser and as nothing here.
    const both = resolved(LIGHT_TOKEN_VALUES) + resolved(DARK_TOKEN_VALUES);

    // When
    const unresolved = [...both.matchAll(/var\((--oref-[a-z0-9-]+)/g)].map((match) => match[1]);

    // Then
    expect([...new Set(unresolved)]).toEqual([]);
  });

  it('should differ between the two schemes, so the dark baseline is not a copy', () => {
    // Given, two identical baselines would pass every assertion above and mean the dark values
    // never reach the page.
    const light = resolved(LIGHT_TOKEN_VALUES);

    // When
    const dark = resolved(DARK_TOKEN_VALUES);

    // Then
    expect(dark).not.toBe(light);
  });
});

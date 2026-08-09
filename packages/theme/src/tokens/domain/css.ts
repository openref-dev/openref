import type { ThemeToken } from './token.types';
import { THEME_TOKENS } from './tokens';

/**
 * Rendering the token set as a stylesheet.
 *
 * `styles/tokens.css` is generated from {@link THEME_TOKENS} and committed, because the build
 * ships CSS and a build step that generates it would be one more thing to go wrong. A test
 * compares the committed file against this function, so the two cannot drift and the token
 * array stays the single source.
 */

/** Attribute a host sets to force a colour scheme rather than following the system. */
export const COLOR_SCHEME_ATTRIBUTE = 'data-oref-color-scheme';

function declarations(tokens: readonly ThemeToken[], dark: boolean): string {
  return tokens
    .filter((token) => !dark || token.dark !== undefined)
    .map((token) => `  ${token.name}: ${dark ? (token.dark ?? token.value) : token.value};`)
    .join('\n');
}

/**
 * Renders the token stylesheet.
 *
 * Three blocks, in this order and for this reason: the light values are the defaults, the
 * system preference applies the dark values, and the explicit attribute overrides both, so a
 * host that forces a scheme wins over the media query rather than fighting it.
 *
 * @param tokens - The token set
 * @returns The stylesheet text
 *
 * @example
 * writeFileSync('tokens.css', renderTokensCss());
 */
export function renderTokensCss(tokens: readonly ThemeToken[] = THEME_TOKENS): string {
  const light = declarations(tokens, false);
  const dark = declarations(tokens, true);

  return `/*
 * OPENREF design tokens, per SPEC 10.1 and STANDARDS 4.4.
 *
 * Generated from src/tokens/domain/tokens.ts. Do not edit by hand: tokens.spec.ts compares
 * this file with the generator and fails when they disagree.
 *
 * This is the one file in the theme where a literal colour, length or font stack is allowed.
 * Everywhere else reads var(--oref-*), and a gate fails the build on a literal that escapes.
 */

:root,
[${COLOR_SCHEME_ATTRIBUTE}='light'] {
  color-scheme: light;
${light}
}

@media (prefers-color-scheme: dark) {
  :root:not([${COLOR_SCHEME_ATTRIBUTE}='light']) {
    color-scheme: dark;
${dark
  .split('\n')
  .map((line) => `  ${line}`)
  .join('\n')}
  }
}

[${COLOR_SCHEME_ATTRIBUTE}='dark'] {
  color-scheme: dark;
${dark}
}
`;
}

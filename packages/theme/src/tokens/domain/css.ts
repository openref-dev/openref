import type { ThemeToken } from './token.types';
import { ALL_TOKENS } from './tokens';

/**
 * Rendering the token set as a stylesheet.
 *
 * `styles/tokens.css` is generated from {@link ALL_TOKENS} and committed, because the build
 * ships CSS and a build step that generates it would be one more thing to go wrong. A test
 * compares the committed file against this function, so the two cannot drift and the token
 * arrays stay the single source.
 */

/** Attribute a host sets to force a colour scheme rather than following the system. */
export const COLOR_SCHEME_ATTRIBUTE = 'data-oref-color-scheme';

/**
 * Every token in every block, including the ones whose value does not change between schemes.
 *
 * The design contract requires the two colour schemes to carry an identical name list, and
 * that is stronger than it looks. A block that declares only what changes is correct for a
 * document whose light values are already in force, and wrong for anything that reads one
 * block on its own: a theme editor, a conformance checker, a host that copies the dark block
 * into a shadow root. The repetition costs bytes that gzip removes and buys a block that means
 * the same thing wherever it is read.
 */
function declarations(tokens: readonly ThemeToken[], dark: boolean): string {
  return tokens
    .map((token) => `  ${token.name}: ${dark ? (token.dark ?? token.value) : token.value};`)
    .join('\n');
}

function indent(block: string): string {
  return block
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

/**
 * Renders the token stylesheet.
 *
 * Three blocks, in this order and for this reason: the light values are the defaults, the
 * system preference applies the dark values, and the explicit attribute overrides both, so a
 * host that forces a scheme wins over the media query rather than fighting it.
 *
 * THE SYSTEM PREFERENCE IS HONOURED WITHOUT AN ATTRIBUTE. A reader who has told their
 * operating system they want a dark interface has already answered the question, and a theme
 * that asks again is a theme that ignored the answer. The attribute exists for a host that
 * needs to force one scheme, not as the only way to reach the dark values, which is why
 * `data-oref-color-scheme` and not `data-oref-theme`: the second name collides with the name
 * of the theme itself.
 *
 * @param tokens - The token set
 * @returns The stylesheet text
 *
 * @example
 * writeFileSync('tokens.css', renderTokensCss());
 */
export function renderTokensCss(tokens: readonly ThemeToken[] = ALL_TOKENS): string {
  const light = declarations(tokens, false);
  const dark = declarations(tokens, true);

  return `/*
 * OPENREF design tokens, per SPEC 10.1, STANDARDS 4.4 and ai-docs/design/CONTRACT.md.
 *
 * Generated from src/tokens/domain/tokens.ts. Do not edit by hand: tokens.spec.ts compares
 * this file with the generator and fails when they disagree.
 *
 * Both colour schemes carry the identical name list, which the design contract requires.
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
${indent(dark)}
  }
}

[${COLOR_SCHEME_ATTRIBUTE}='dark'] {
  color-scheme: dark;
${dark}
}
`;
}

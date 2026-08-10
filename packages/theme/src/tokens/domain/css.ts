import type { ThemeToken } from './token.types';
import { ALL_TOKENS, MOTION_DURATION_TOKENS, MOTION_ZERO_TOKEN } from './tokens';

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
 * The light block declares every token. A dark block declares only the ones that change.
 *
 * IT USED TO WRITE ALL OF THEM THREE TIMES, and the reason it stopped is measurement rather
 * than taste. The design contract requires every theme to define all its tokens in both colour
 * modes, and the generator read that as a requirement on the text of each block. The comment
 * that defended the repetition said it "costs bytes that gzip removes". Gzip does remove them;
 * the browser parses the bytes gzip did not remove, and the three stylesheets were 38,786 of
 * those against 6,499 transferred. The decision was made against the wrong quantity, which
 * SPEC 0 now records as a defect class beside may-ship against did-ship.
 *
 * CONTRACT.md is amended to match: the requirement is on the declared surface and is checked on
 * the resolved computed value in both modes, in a browser, not by counting declarations in a
 * stylesheet. A token declared on the light block and not overridden in the dark one does have
 * a value in dark mode, because that is what the cascade is for. The new check is stronger than
 * the count it replaces, since a token declared and then overridden to nothing passes a count
 * and fails a resolution.
 *
 * @param tokens - The token set
 * @param dark - Whether this is a dark scheme block
 * @returns The declarations, one per line, or the empty string when nothing changes
 */
function declarations(tokens: readonly ThemeToken[], dark: boolean): string {
  const declared = dark ? tokens.filter((token) => token.dark !== undefined) : tokens;

  return declared
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
 * The reduced motion block: every duration token aliases the zero token.
 *
 * IT IS GENERATED HERE RATHER THAN LEFT TO EACH THEME, which is the whole reason motion is a
 * token group. A theme that answers `prefers-reduced-motion` in its own stylesheet answers it
 * somewhere nothing can read, and three themes then disagree silently. With the durations in
 * the token layer, a theme reduces motion by declaring the tokens and a checker can see that it
 * did.
 *
 * The alias, rather than a repeated `0s`: the zero is one value with one name, and a component
 * that reads `--oref-motion-duration-fast` gets it without knowing the media query exists.
 *
 * IT REPEATS THE SELECTOR OF EVERY BLOCK IT HAS TO BEAT, and that is not tidiness. Coming last
 * only wins on equal specificity. The dark block is `:root:not([data-oref-color-scheme='light'])`,
 * which is two, and a plain `:root` is one: a reader who wants a dark interface and no animation
 * would have kept the animation, silently, and only that reader would ever have found out. So
 * the same selector appears here, later in the file, where it wins by order.
 *
 * The subtree case is the other half. A host may set the scheme attribute on an element rather
 * than on the document, and a `:root` rule would then lose to the attribute block on that
 * subtree.
 */
function reducedMotion(tokens: readonly ThemeToken[]): string {
  const declared = new Set(tokens.map((token) => token.name));
  const durations = MOTION_DURATION_TOKENS.filter(
    (name) => declared.has(name) && name !== MOTION_ZERO_TOKEN,
  );

  if (durations.length === 0 || !declared.has(MOTION_ZERO_TOKEN)) return '';

  const declarations = durations
    .map((name) => `    ${name}: var(${MOTION_ZERO_TOKEN});`)
    .join('\n');

  return `
@media (prefers-reduced-motion: reduce) {
  :root,
  :root:not([${COLOR_SCHEME_ATTRIBUTE}='light']),
  [${COLOR_SCHEME_ATTRIBUTE}='light'],
  [${COLOR_SCHEME_ATTRIBUTE}='dark'] {
${declarations}
  }
}
`;
}

/**
 * Renders the token stylesheet.
 *
 * Four blocks, in this order and for this reason: the light values are the defaults, the
 * system preference applies the dark values, and the explicit attribute overrides both, so a
 * host that forces a scheme wins over the media query rather than fighting it. The reduced
 * motion block comes last because it must win over all three on equal specificity, and because
 * it is orthogonal to the scheme: a reader can want a dark interface and no animation.
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
 * The light block declares every token. A dark block declares only the tokens whose value
 * changes, and the rest resolve through the cascade. The design contract requires all of them
 * to be defined in both modes and checks that on the resolved value in a browser, which is a
 * stronger check than counting declarations here.
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
${reducedMotion(tokens)}`;
}

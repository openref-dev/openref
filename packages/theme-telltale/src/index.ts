/**
 * `@openref/theme-telltale`: the second reference theme, per BUILD T032 and SPEC 10.1.
 *
 * It exists to prove the theme contract is real. `@openref/theme` was written in the same
 * sessions as the renderer it draws through, so a position the renderer could not fill would
 * have been fixed on both sides without anybody noticing there had been a boundary. This one is
 * written against the published `@openref/vue` alone, by a task whose definition of done is an
 * empty diff to every other package.
 *
 * WHAT THE PROOF RETURNED IS IN `THEME-BOUNDARY.md` BESIDE THIS FILE. Twenty one positions are
 * this theme's own and every one of them draws. Seven structural elements on a node page are not
 * positions at all, so this theme styles class names the reference wrote rather than markup it
 * authored, and the theme's own thesis about block order cannot be expressed at all. Neither is
 * worked around here: both are filed against the task that froze the registry.
 */

import telltale from './theme';

export { default as telltale } from './theme';

/** Name of the theme this package ships, which is the name `defineTheme` carries. */
export const THEME_NAME = 'telltale';

/**
 * Stylesheets this theme brings, in the order they must be applied.
 *
 * DERIVED FROM THE DEFINITION SINCE T033, when `assets.css` became consumed: the definition is
 * the one list, and this export is a convenience view of it for a host that wires stylesheets
 * by hand rather than through the `theme` option. Two hand written copies of the same three
 * paths were the finding that got the field consumed.
 */
export const TELLTALE_STYLESHEETS: readonly string[] = telltale.assets?.css ?? [];

/**
 * The two faces this theme's first paint waits for, named here so a budget can read them.
 *
 * The interface is JetBrains Mono and the strip headings are Martian Mono, and both are on
 * screen before a reader touches anything, so the pair is one face from each family rather than
 * the sans and the mono regular that vernier's pair is.
 */
export const TELLTALE_FIRST_PAINT_FACES: readonly string[] = [
  'JetBrainsMono-400-latin.woff2',
  'MartianMono-700-latin.woff2',
];

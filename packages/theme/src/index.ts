/**
 * `@openref/theme`: the default theme, as tokens and stylesheets.
 *
 * It imports no workspace package and no framework. STANDARDS 3.5 gives this package no
 * upstream at all, and the graph linter enforces it, because the default theme has to be
 * readable by the server renderer, by the static build and by the CLI alike. A theme that has
 * to be executed by a framework cannot be read by any of them.
 */

/**
 * Name of this package.
 *
 * Exported so that the dependency graph linter has a real edge to follow and so that
 * diagnostics can report which package produced a value.
 */
export const PACKAGE_NAME = '@openref/theme';

export type {
  ContrastPair,
  ContrastRole,
  ThemeToken,
  TokenGroup,
} from './tokens/domain/token.types';
export {
  ALL_TOKENS,
  CONTRAST_PAIRS,
  DARK_TOKEN_VALUES,
  LIGHT_TOKEN_VALUES,
  MOTION_DURATION_TOKENS,
  MOTION_ZERO_TOKEN,
  THEME_SPECIFIC_TOKENS,
  THEME_TOKENS,
} from './tokens/domain/tokens';
export {
  AA_LARGE_CONTRAST,
  AA_TEXT_CONTRAST,
  contrastRatio,
  hexContrastRatio,
  parseHexColor,
  relativeLuminance,
} from './tokens/domain/color';
export type { Rgb } from './tokens/domain/color';
export { COLOR_SCHEME_ATTRIBUTE, renderTokensCss } from './tokens/domain/css';
export {
  DEFAULT_THEME_NAME,
  DEFAULT_THEME_STYLESHEETS,
  defaultDarkTheme,
  defaultTheme,
} from './theme/api/default-theme';
export type { ThemeDescriptor } from './theme/api/default-theme';

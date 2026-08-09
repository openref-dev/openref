import { DARK_TOKEN_VALUES, LIGHT_TOKEN_VALUES } from '../../tokens/domain/tokens';

/**
 * The default theme, as plain data.
 *
 * It carries no Vue import on purpose. STANDARDS 3.5 gives `theme` no upstream package at all,
 * and the dependency graph linter enforces it. That is not an accident of layout: the default
 * theme has to be readable by the server renderer, by the static build and by the CLI, and a
 * theme that has to be executed by a framework cannot be read by any of them.
 *
 * Its shape matches the `ThemeDefinition` of `@openref/vue` structurally, so whoever wires the
 * application hands this straight to `createDocState`.
 */

/** A theme as this package publishes it: a name, token defaults and stylesheets. */
export interface ThemeDescriptor {
  readonly name: string;
  readonly tokens: Readonly<Record<string, string>>;
  readonly assets: { readonly css: readonly string[] };
}

/** Name of the theme this package ships. */
export const DEFAULT_THEME_NAME = 'openref-default';

/**
 * Stylesheets the default theme brings, in the order they must be applied.
 *
 * Tokens first, because everything else reads them.
 *
 * Written as package specifiers rather than as relative paths. SPEC 10.4 shows a theme naming
 * its own file relative to itself, which is right for a theme that is also the application.
 * The default theme is consumed from another package, so a relative path would resolve against
 * whoever imported it. These resolve through the package's `exports` from anywhere.
 */
export const DEFAULT_THEME_STYLESHEETS: readonly string[] = [
  '@openref/theme/tokens.css',
  '@openref/theme/theme.css',
];

/** The default theme. */
export const defaultTheme: ThemeDescriptor = {
  name: DEFAULT_THEME_NAME,
  tokens: LIGHT_TOKEN_VALUES,
  assets: { css: DEFAULT_THEME_STYLESHEETS },
};

/**
 * The default theme with the dark colour scheme baked into its token defaults.
 *
 * The stylesheet already switches on the system preference and on the scheme attribute, so
 * this exists for a host that renders one scheme and never offers the other, for example a
 * static export embedded in a dark portal.
 */
export const defaultDarkTheme: ThemeDescriptor = {
  name: DEFAULT_THEME_NAME,
  tokens: DARK_TOKEN_VALUES,
  assets: { css: DEFAULT_THEME_STYLESHEETS },
};

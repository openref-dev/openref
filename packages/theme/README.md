# @openref/theme

The default OPENREF theme: a design called vernier, published as token data and three stylesheets.
Its thesis is a double scale. What the specification declares and what the running application does
stand side by side, and the verdict is read from the ruler between them. Flat and rectangular, built
from hairlines and lightness rather than from shadow and rounding.

It imports no workspace package and no framework, which is deliberate rather than incidental: the
server renderer, the static build and the command line all have to be able to read the default theme,
and a theme that has to be executed by a framework can be read by none of them.

## Install

```sh
npm install @openref/theme
```

`@openref/nest` already depends on it and serves it without being asked. Install it directly to read
the token set, to check contrast, or to hand the dark variant to a host that renders one scheme.

## Use

```ts
import { defaultTheme, DEFAULT_THEME_STYLESHEETS } from '@openref/theme';

defaultTheme.name; // 'vernier'
DEFAULT_THEME_STYLESHEETS; // faces, tokens, rules, in the order they must be applied
```

The three stylesheets resolve through this package's `exports` from anywhere, which is why they are
written as specifiers rather than as relative paths:

- `@openref/theme/fonts.css`
- `@openref/theme/tokens.css`
- `@openref/theme/theme.css`

The order is load bearing. Faces come first so that a face is not fetched after the rule that asks
for it, and tokens come second because everything after them reads one. `@openref/theme/styles/*`
and `@openref/theme/fonts/*` are open for a host that needs one file by name.

`defaultTheme` is three members, `name`, `tokens` and `assets`, which is structurally the
`ThemeDefinition` of `@openref/vue`, so whoever wires the application hands it straight to
`createDocState`. `defaultDarkTheme` is the same theme with the dark values baked into its token
defaults, for a host that renders one scheme and never offers the other, such as a static export
embedded in a dark portal.

## Every visual value is a token

`src/tokens/domain/tokens.ts` and `src/styles/tokens.css` are the only two places in this package
where a literal colour, length or font stack may appear. Everywhere else reads `var(--oref-*)`, and a
gate fails the build on a literal that escapes. `tokens.css` is generated from the token arrays by
`renderTokensCss` and compared against the generator by a test, so the two cannot drift and the
arrays stay the one source.

122 names are the design contract, identical in every theme; six more are vernier's own and are kept
in a separate array so a theme's private token can never be mistaken for one of the contract's.
`THEME_TOKENS` is the first list, `THEME_SPECIFIC_TOKENS` the second, and `ALL_TOKENS` is the 128 the
stylesheet declares. `LIGHT_TOKEN_VALUES` and `DARK_TOKEN_VALUES` are the same names as flat maps.

Every name is `--oref-{group}-{name}`, and the group is the segment straight after the prefix.
Fourteen of them:

| Group    | Count | Examples                                                                                                         |
| -------- | ----- | ---------------------------------------------------------------------------------------------------------------- |
| `color`  | 25    | `--oref-color-bg`, `--oref-color-fg`, `--oref-color-line`, `--oref-color-accent-spec`, `--oref-color-method-get` |
| `font`   | 21    | `--oref-font-family-sans`, `--oref-font-size-400`, `--oref-font-weight-medium`, `--oref-font-leading-prose`      |
| `syntax` | 13    | `--oref-syntax-keyword`, `--oref-syntax-string`, `--oref-syntax-added-bg`                                        |
| `prov`   | 12    | `--oref-prov-declared-fg`, `--oref-prov-derived-border-style`, `--oref-prov-inferred-code`                       |
| `drift`  | 12    | `--oref-drift-crit-fg`, `--oref-drift-warn-border-style`, `--oref-drift-note-bg`                                 |
| `state`  | 10    | `--oref-state-ok-fg`, `--oref-state-warn-bg`, `--oref-state-crit-fg`                                             |
| `space`  | 10    | `--oref-space-100` through `--oref-space-1000`, 2 px to 80 px                                                    |
| `radius` | 5     | `--oref-radius-none`, `--oref-radius-md`, `--oref-radius-pill`, all `0px` here                                   |
| `motion` | 4     | `--oref-motion-duration-fast`, `--oref-motion-duration-none`, `--oref-motion-easing-standard`                    |
| `focus`  | 3     | `--oref-focus-color`, `--oref-focus-width`, `--oref-focus-offset`                                                |
| `shadow` | 2     | `--oref-shadow-panel`, `--oref-shadow-overlay`, both `none` here                                                 |
| `layout` | 2     | `--oref-layout-rail`, `--oref-layout-measure`                                                                    |
| `border` | 2     | `--oref-border-hair`, `--oref-border-mark`                                                                       |
| `scrim`  | 1     | `--oref-scrim-blur`                                                                                              |

The provenance and drift groups carry an edge style beside each colour, `solid`, `dashed` and
`dotted`, plus a three letter code, so the level survives monochrome print and a reader who cannot
tell the two hues apart. That is what makes L0 theming real: a consumer restyles the whole reference
by setting custom properties, with no build step and no fork.

Contrast is checkable rather than asserted. `CONTRAST_PAIRS` is the 49 foreground and background
pairs the theme actually draws, emitted for both schemes, and `contrastRatio`, `hexContrastRatio`,
`relativeLuminance` and `parseHexColor` are what holds them against `AA_TEXT_CONTRAST`, 4.5, and
`AA_LARGE_CONTRAST`, 3. A pair whose role is `decorative` claims nothing, and one token is marked
that way rather than being quietly counted: `--oref-color-line-strong` measures 2.31 against the page
in light and 2.19 in dark, so the theme does not draw a control boundary with it.

## Overriding tokens from a host page

The light block declares every token on `:root` and on `[data-oref-color-scheme='light']`; the dark
block declares only the 61 that change, under `@media (prefers-color-scheme: dark)` scoped to
`:root:not([data-oref-color-scheme='light'])`; a third block repeats the dark values under a bare
`[data-oref-color-scheme='dark']`, so an explicit choice wins over the media query in both
directions. The attribute selectors are written without `:root` on purpose, because a host may set
the scheme on a subtree rather than on the document.

So a host overrides a token by declaring it on `:root` in a stylesheet that comes after
`tokens.css`, or on any ancestor of the region it wants to change, since custom properties inherit:

```css
:root {
  --oref-color-accent-spec: #4f46e5;
  --oref-font-family-sans: 'Inter', system-ui, sans-serif;
}
```

`COLOR_SCHEME_ATTRIBUTE` is `data-oref-color-scheme`, exported so nobody spells it twice. It is not
`data-oref-theme`, because that name would collide with the name of the theme itself.

Under `prefers-reduced-motion: reduce` every duration token aliases `MOTION_ZERO_TOKEN`,
`--oref-motion-duration-none`. That block comes last and repeats all four scheme selectors, because
coming last only wins on equal specificity. It happens once, in the token layer, rather than in each
theme's own rules, so a checker can read that it happened.

## Both DOM modes

The stylesheets are plain CSS with no inline style and no inline script anywhere, so they work under
`style-src 'self'` with no `unsafe-inline`. The reference ships as a light DOM build and as a shadow
DOM web component, and the shadow boundary is what changes which of them a theme can lean on: a theme
that depends on the host page's CSS needs `shadow="false"`, which is a first class supported mode.
`DISTRIBUTION.md` in `@openref/nest` is the table of which theme level each output supports.

Nothing in this package writes a `:host` rule. The tokens are declared on `:root`, so inside a shadow
root they arrive by inheritance from the host element rather than by selector, which is worth knowing
before overriding one from inside the boundary.

## Fonts

Space Grotesk for the interface and JetBrains Mono for code, self hosted, no CDN, no external request
of any kind. Five faces, Space Grotesk at 400, 500 and 700 and JetBrains Mono at 400 and 700, each in
two files, latin and latin-ext, chosen by `unicode-range`, and each subset with `pyftsubset` keeping
`kern`, `liga`, `tnum` and `calt` with outlines, metrics and hinting unchanged. The full OFL text of
both families, a `NOTICE.md`, `FONTS.md` and a manifest recording the source, version and sha256 of
every byte ship in `fonts/` inside the tarball.

`fonts.css` is served from `fonts/` rather than built into `dist/`, because a bundler would rewrite
its `url()`s and detach the licence files from the faces they cover.

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

`defaultDarkTheme` is the same theme with the dark values baked into its token defaults, for a host
that renders one scheme and never offers the other.

## Every visual value is a token

`src/tokens/domain/tokens.ts` and `src/styles/tokens.css` are the only two places in this package
where a literal colour, length or font stack may appear. Everywhere else reads `var(--oref-*)`, and a
gate fails the build on a literal that escapes. `tokens.css` is generated from the token arrays and
compared against the generator by a test, so the two cannot drift and the arrays stay the one source.

122 names are the design contract, identical in every theme; six more are vernier's own and are kept
in a separate array so a theme's private token can never be mistaken for one of the contract's. They
fall into fourteen groups: `color`, `font`, `space`, `radius`, `border`, `shadow`, `focus`, `layout`,
`prov`, `state`, `drift`, `syntax`, `motion` and `scrim`, which are the second segment of every token
name. That is what makes L0 theming real: a consumer restyles the
whole reference by setting custom properties, with no build step and no fork.

Contrast is checkable rather than asserted. `CONTRAST_PAIRS`, `contrastRatio`, `hexContrastRatio` and
the two AA thresholds are exported, and the pairs are held against them in both colour schemes.

## Colour scheme and motion

The light block declares every token; the dark block declares only the ones that change and the rest
resolve through the cascade. Dark applies from `prefers-color-scheme` with nothing set. A host that
has to force one sets `data-oref-color-scheme="light"` or `"dark"` on the document or on a subtree,
and `COLOR_SCHEME_ATTRIBUTE` is that attribute name, exported so nobody spells it twice.

Under `prefers-reduced-motion: reduce` every duration token aliases the zero token. That happens once,
in the token layer, rather than in each theme's own rules, so a checker can read that it happened.

## Both DOM modes

The stylesheets are plain CSS with no inline style and no inline script anywhere, so they work under
`style-src 'self'` with no `unsafe-inline`. The reference ships as a light DOM build and as a shadow
DOM web component, and the shadow boundary is what changes which of them a theme can lean on: a theme
that depends on the host page's CSS needs `shadow="false"`, which is a first class supported mode.
`DISTRIBUTION.md` in `@openref/nest` is the table of which theme level each output supports.

## Fonts

Space Grotesk for the interface and JetBrains Mono for code, self hosted, no CDN, no external request
of any kind. Each face is two files, latin and latin-ext, chosen by `unicode-range`. The full OFL text
of both families, a `NOTICE.md` and a manifest recording the source and digest of every byte ship in
`fonts/` inside the tarball.

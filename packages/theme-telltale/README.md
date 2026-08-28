# @openref/theme-telltale

The second reference theme for OPENREF: an instrument rather than a document.

Everything is monospace. Every row sits on a 21 px grid. Provenance is a three letter code, `DCL`,
`DRV` or `INF`, with an edge style behind it, so where a fact came from survives a monochrome print
and reaches a screen reader as text. A bench line across the bottom says what the page weighs.

It is a level 2 theme, per SPEC 10.1: its own layout, all 21 positions of the frozen registry, all
109 tokens of the design contract in both colour modes, and its own faces. It reads `@openref/vue`
and nothing else of this project: the four IR types the contract's props are declared in came onto
that surface with `T031-R1`, and the `@openref/core` dependency this package used to carry for them
came off.

## Install

```sh
npm install @openref/theme-telltale @openref/vue
```

## Use

```ts
import { telltale, TELLTALE_STYLESHEETS } from '@openref/theme-telltale';

// The stylesheets, in the order they must be applied: faces, tokens, rules.
TELLTALE_STYLESHEETS;

// The theme itself, as data.
telltale;
```

The three stylesheets resolve through this package's `exports` from anywhere:

- `@openref/theme-telltale/fonts.css`
- `@openref/theme-telltale/tokens.css`
- `@openref/theme-telltale/theme.css`

## Colour scheme

The dark values apply from `prefers-color-scheme` with nothing set, because a reader who has told
their operating system they want a dark interface has answered the question. A host that has to
force one sets `data-oref-color-scheme="light"` or `"dark"` on the document or on a subtree; that
comes last in the stylesheet, so it wins on equal specificity rather than fighting the media query.

Under `prefers-reduced-motion: reduce` both durations collapse onto the zero token. That happens in
the token layer rather than in this theme's rules, so a checker can read that it happened.

## Fonts

JetBrains Mono for the interface at 400 and 700, Martian Mono for strip headings and the bench line
at 700. Self hosted, no CDN, no external request of any kind. Each face is two files, latin and
latin-ext, chosen by `unicode-range`. The complete OFL text of both families, a `NOTICE.md` and a
manifest recording the source and digest of every byte travel in `fonts/` inside the tarball.

## What this package is for

It is the proof that the theme contract is real, and what that proof returned, including the parts
that came back negative, is in `THEME-BOUNDARY.md` beside this file. Read it before writing a theme
of your own: it is the list of things the contract does not yet carry.

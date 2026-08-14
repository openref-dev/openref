# Distribution builds and DOM modes

The four ways the reference client ships, per SPEC 10.3, and what each one is for. The table
is the specification's, with the artefact that answers each row.

| Output | Artefact | Shadow DOM | Theme compatibility |
| --- | --- | --- | --- |
| ESM library | `@openref/nest/browser-entry` (`mountReference`), `@openref/render/browser` (`hydrateReference`, `defineReferenceElement`) | no | L0-L3: the host composes, so nothing is foreclosed |
| IIFE bundle | `@openref/nest/element.iife` | no | L0-L3, global CSS applies |
| Web Component, `shadow` (default) | `@openref/nest/element`, `<openref-reference href="/docs">` | yes | L0, L1, L2 while the theme is self sufficient in styles; host CSS does not reach in |
| Web Component, `shadow="false"` | the same element | no | L0-L3, the host page's global CSS applies |

`shadow="false"` is a first class supported mode, not a workaround: it is the mode for a theme
that leans on the CSS the host page already has, and the browser suite proves it against an
external stylesheet by computed style, which is the strongest reading of "global CSS applies".

## What the element embeds, and the boundary it keeps

`<openref-reference href="...">` embeds a page this same origin already serves: it fetches the
served page, adopts its markup, its state and its stylesheet links into its root, and hydrates
there. Nothing is normalized or highlighted in the browser, per SPEC 12, and nothing is fetched
across an origin, per SPEC 19.4: `href` is a path by construction, and an absolute URL is
refused in words inside the element. A portal on another origin embeds the static build of M3,
whose files are same origin wherever they are hosted.

In shadow mode the stylesheet links are also appended to the document head, once per href:
`@font-face` registers fonts only at document level, so the copies exist for the font registry
while the shadow boundary keeps every rule out of the host page and the host page's rules out
of the embed.

## Cost shape

The page entry (`./browser`) is split by gesture and served through the asset catalog; its
budgets are per gesture. The element outputs are one file each, deliberately: an embed has no
asset catalog to rewrite chunk names through, so the deferred features are inlined and the
embed pays its whole cost once, bounded by the `client-wc` budgets.

## Themed embeds are the same pair rule as themed pages

An element hydrates with the components compiled into it. The shipped element carries the
reference's own, so it embeds pages served without a theme. Embedding a reference served under
a theme takes an element built with that theme's definition: `defineReferenceElement(options)`
from `@openref/render/browser/element` is the factory, and the theme's entry artefact is the
place to register it, exactly as `@openref/theme-telltale/entry` does for full pages with
`mountReference`.

## Where the composition surface resolves

`@openref/nest/browser-entry` carries only the `source` condition and resolves where themes are
built today, inside this workspace. A built form would either name `@openref/render` bare,
which no browser resolves, or pre-bundle Vue, which hands a theme's build a second instance.
Whether a third party theme author gets a resolvable form is the `@openref/render` publication
question, owned by the T064 amendment.

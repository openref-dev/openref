# @openref/render

The server render pipeline: the page models a document is projected into, the Vue 3 components that
draw them, the HTML shell around the application, the asset catalog and the render cache. It sits
above `@openref/core` and `@openref/vue` and below every host: `buildPageModel` turns a normalized
document into what a page reads, `renderPage` turns that into markup, and the 21 default components
of the frozen slot registry are each exported so a level 1 theme can replace one of them rather
than all of them.

It also holds everything that must not reach the browser: the markdown parser, the sanitizer and
the syntax highlighter. What the browser gets is `@openref/render/browser`, which imports none of
the three, because descriptions arrive as HTML the server already sanitized and code arrives
already tokenized.

## Not published

This package is not on npm. It is architecturally separate, it has its own tests, and it ships
bundled inside the packages that use it: `@openref/nest` inlines it into the module a host
installs, and the `openref` CLI inlines it into the binary. `@openref/static` and `@openref/nuxt`
build on it too, and both are themselves unpublished.

## The eight page kinds

`renderPage` takes a `PageKind`, and the union has eight members. `overview`, `health` and `states`
are one page per document; `node` is one per node, `bench` one per operation, `schema` and `shapes`
one per named schema, and `service` one per federated service, which is none at all on an unmerged
document. `states` is a theme author's page rather than a reader's: it draws one specimen of every
`StateNotice` kind side by side, so a theme's styling of the degraded states can be read without
producing each degradation by hand, and it enters no tab bar and no navigation.

The bar the shell draws carries six tab kinds, `node`, `schema`, `shapes`, `bench`, `health` and
`states`. `overview` and `service` are reached from the rail and the navigation's service groups
instead, which is why the tab union is six where the page union is eight.

`renderAllPages` walks every one of them for a document, and the static build's
`PAGE_KIND_CARDINALITY` is a total record over the same union, so a ninth kind does not compile
until somebody has written down how many pages it produces.

## The registry, and the hole in the import graph

A bundler splits on the import graph and on nothing else, so the deferral of the try-it console,
the schema tree, the command palette and the shapes form is a hole in that graph rather than a
flag. `DeferrableComponents` is the contract, and the two entry points fill it: `EAGER_COMPONENTS`
resolves all nineteen positions at import time, which is what a server render needs, and
`browser/deferred.ts` fills the same shape with async components whose loader is the gate. An
async component whose loader has not resolved is left alone by hydration, so the server's markup
stays in the document, nothing is fetched and nothing is compiled until the reader touches the
region. `components/eager.ts` is therefore the one module the client bundle must not reach, and a
marker in the built file is what proves it.

The server resolved positions of the slot contract resolve in `EAGER_COMPONENTS` and nowhere else.
`SERVER_RESOLVED_SLOTS` names the eight: `DocumentOverview`, `OperationHeader`, `RuntimePanel`,
`ProvenanceTag`, `DriftCard`, `ParamTable`, `ResponseList` and `HealthScore`. The browser fills
each of those with a childless element that adopts the markup it was handed, so a theme's component
is never drawn over markup it is supposed to leave alone, and none of them ride the first paint.

## No inline styles, ever

Working under `style-src 'self' 'nonce-...'` with no `unsafe-inline` is a declared advantage of
this project, and a CSP nonce can never authorize an inline `style` attribute: only `<style>` and
`<script>` elements. So a dynamic value goes through a CSS custom property set on a class, never
through `:style`. The `csp` gate scans built output for an inline style attribute and for an
unnonced script, and either one is fatal.

Every asset the shell writes is external, per SPEC 19.2. The only element with content in it is the
state block, which is data rather than code, and it carries the nonce whenever one exists. The
nonce is applied on the way out of the cache rather than on the way in, because a nonce is per
response: cached, it would either be handed to a second response, which is what a nonce exists to
prevent, or be stale, which breaks every script and style on the page.

`buildContentSecurityPolicy` returns the policy as a string and this package sets no header. It
opens `default-src 'none'` rather than `'self'`, so every directive under it is one the reference
actually uses, and neither `script-src` nor `style-src` carries `unsafe-inline` or `unsafe-eval`.
Whether to serve it is the host's decision; `connect-src` is the one directive a host has to widen,
because the authorization code flow's token exchange is a browser `fetch` to the authorization
server, and the function takes those extra origins as its second argument.

## What a host changes, and where

Nothing here is configured directly. A Nest host reaches every input through the options of
`OpenRefModule.setup(route, app, options)` and of each entry of
`OpenRefModule.forRoot({ documents: [...] })`, which carry the same members so neither form can
gain an option the other quietly lacks:

- `theme`, a `{ definition, bundle? }` pair. The definition is what the render resolves slot
  overrides against; the bundle is required the moment the definition carries a `layout` or any
  `components`, because a page rendered with an override and hydrated by the default entry is a
  silent hydration mismatch on that position. `forRoot({ theme })` is the default every mount
  inherits, and a `documents` entry naming its own overrides it for that mount alone.
- `stylesheets` and `clientBundle`, the hrefs the shell links, each defaulting to the theme's
  `assets.css` and to this package's entry. `assetPlan` supplies the same files as bytes, and then
  nothing is read from disk and the other two are ignored.
- `cache`, an `IRenderCache`, defaulting to the bounded in memory one.
- `highlight`, on by default. Off means fenced blocks and examples render untokenized.
- `lang` and `colorScheme`, the `lang` attribute and a forced scheme instead of the reader's own
  system preference.
- `nonce`, where the CSP nonce for one response is found, tried before `res.locals.cspNonce` on
  Express and `reply.cspNonce.script` on Fastify.
- `proxy`, whose `enabled` writes the proxy endpoint into the page model so the browser's runner
  factory chooses the proxy transport.

Two more inputs exist and no host writes them: `directTarget` and `staticProxy` are set by the
static build and by nothing else, and they carry the direct mode warning and the generated rules a
built page's console addresses.

Each of those lands in `renderCacheKey`, beside `IRDocument.hash`, the base path, the node, the
schema, the service and the three version numbers of the IR, the page model and the markup. A cache
that outlived a deployment and answered with markup the current code would not produce is worse
than no cache, because nothing about it looks wrong.

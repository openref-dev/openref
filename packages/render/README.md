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
server.

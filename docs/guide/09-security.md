## Security posture

<!-- gen: count:sections -->Six<!-- /gen --> properties, each one checkable rather than promised.

### Zero external requests

A rendered page fetches nothing from any origin but the one that served it. No CDN, no font
host, no analytics, no error reporter, no "check for updates". Fonts, the client bundle, the
theme's stylesheets and the search index are served by your application, under names carrying
the digest of their own bytes.

This is proved in a real browser with the network intercepted, and proved twice: once by
watching a planted external stylesheet be seen, and once by watching the real page ask for
nothing. A check that cannot see a request it should see is a check that reports zero for the
wrong reason.

### Output a strict CSP accepts, and a header you have to set

This module never writes a `Content-Security-Policy` header. That is deliberate and it is
recorded in the specification: a library that set a policy on your responses would be
overwriting whatever your application already sends. So the guarantee is about the output, and
the header is yours.

What is guaranteed: the served markup carries no inline `style` attribute, no executable inline
script, and takes a nonce on the two elements that need one. A CI check scans built output for
inline `style=` attributes, inline scripts and dynamic code evaluation, and a browser under the
policy below counts violations and requires zero.

What you have to do: send the header. The host sets the policy; the reference makes its output
compatible with one and writes no `Content-Security-Policy` header of its own. This is the policy
the output is built for, and `buildContentSecurityPolicy` returns exactly it for the nonce and the
origins you hand it, so a host does not have to transcribe it. A committed case holds the block
below against what that function returns, so the two cannot drift apart again. It is exported
from `@openref/nest`, which is the package a Nest host installs. A Nuxt host transcribes the
block below for now, and the reason is written down rather than glossed: `@openref/nuxt` is not
published, so there is no package a Nuxt application can install that exports the builder. The
policy is this:

```
default-src 'none';
script-src 'self' 'nonce-<per response>';
style-src 'self' 'nonce-<per response>';
font-src 'self';
img-src 'self' data:;
connect-src 'self' <your authorization server origin>;
base-uri 'none';
form-action 'none';
frame-ancestors 'none'
```

`connect-src` is the one directive with two origins in it, and the second one is yours to supply.
The try-it console sends to your own application, which `'self'` covers. Signing in does not:
exchanging an authorization code for a token is a browser `fetch` from the page to the
authorization server, a third origin, and under a bare `connect-src 'self'` the browser refuses
that request before it is made and reports it nowhere but the developer console. A reference
served under `connect-src 'self'` alone cannot sign in at all. So the builder takes those origins
rather than defaulting them, and the block above is what it returns when you pass one:

```ts
import { buildContentSecurityPolicy } from '@openref/nest';

const policyFor = (nonce: string): string =>
  buildContentSecurityPolicy(nonce, ['https://login.example.com']);
```

Pass nothing and drop the second token if no security scheme in your document declares an
`authorizationCode` flow. Pass the authorization server's origin, and only that origin, if one
does. Both halves run in a real browser: with the origin named the exchange completes and the
console says it signed in, and with the bare form the browser blocks the exchange on `connect-src`
and it does not.

Note what is not in it: `unsafe-inline`. That is the distinction the whole design turns on. A
nonce can authorize a `<style>` element and can never authorize a `style="..."` attribute, so a
renderer that emits inline style attributes forces `unsafe-inline` into your policy and no
amount of nonce plumbing changes it. For a regulated deployment that is an admission condition
rather than a detail, which is why it is the output rather than the header that is guaranteed:
a guarantee about a header you did not send would be worth nothing.

### The console sends through your own origin

Pressing Send does not send from the page to an arbitrary host. Turn the proxy on and the
request goes to `<route>/_proxy` on your own application, which forwards it:

```ts
OpenRefModule.setup('/docs', app, {
  document,
  proxy: { enabled: true, timeoutMs: 30_000, maxResponseBytes: 10 * 1024 * 1024 },
});
```

Off by default, and off means the page sends directly, which is the honest default for a
capability that turns your application into a forwarder. Switched on, the proxy forwards only to
hosts the document's own `servers` declare, and everything else is refused. It is fail closed by
policy: an address it cannot resolve to an allowed host is a refusal, never a best effort. That
covers the obvious SSRF shapes, including redirects that leave the allowlist and addresses that
decode into something else after parsing.

The body ceiling is checked before the body is read, so a request that is going to be refused
cannot spend the ceiling first.

### Descriptions are sanitized, not escaped

A `description` in a specification is markdown and may contain HTML, and specifications are
frequently not written by you. The renderer renders the markdown and then sanitizes the result,
in that order, because a markdown renderer passes raw HTML through by design and its output is
therefore untrusted no matter how trusted the input looked.

Escaping instead of sanitizing would have been simpler and would have broken every document
that legitimately writes a `<table>` in a description.

### No telemetry, of any kind

No usage reporting, no version check, no install time call home. Two packages in the wider
dependency graph run analytics on install; both are refused a postinstall script by name in the
workspace configuration, with the reason written next to them. Refusing a postinstall does not
remove a package, it removes the call home.

### Closing the reference

```ts
OpenRefModule.setup('/docs', app, {
  document,
  visibility: 'internal',
  guard: AdminDocsGuard,
});
```

`visibility` says who the reference is for and `guard` is what enforces it. They travel
together, and a list of guards is a conjunction, exactly as `@UseGuards` reads. An empty list is
refused, because it reads as "there is a guard" and means "there is no guard".

An operation marked `@ApiAudience('internal')` is withheld from the agent surfaces as well as
from the page, in one place both surfaces call, so the JSON-RPC endpoint cannot answer with what
the page withheld.

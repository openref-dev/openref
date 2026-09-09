# @openref/static

The static build: one normalized document in, a directory of files out. One HTML page per node with
its own URL, the navigation payload, the search index, hashed assets, a sitemap, `llms.txt`, and,
for a target that needs them, the rewrite rules that put the request console's proxy in front of the
API. It stands on `@openref/core`, `@openref/render`, `@openref/samples` and `@openref/search`, and
it cannot see `@openref/nest` per the dependency rule. The one artefact that lives on that side, the
browser bundle, arrives as bytes a caller read off disk.

## Not published

This package is not on npm. It is architecturally separate, it has its own tests, and it ships
bundled inside the `openref` CLI, which is where `openref build` runs it. `@openref/nuxt` calls the
same build so that `nuxt generate` writes the same site, and that package is itself unpublished.

## The flags that reach it

`openref build` is the whole configuration surface. Exactly one source flag is required, and naming
two is a usage error rather than a precedence rule:

- `--spec <path>`, a specification document on disk.
- `--config <path>`, a configuration file naming one.
- `--from-nest <path>`, a Nest application booted for the runtime pass, so the document carries the
  facts a specification file cannot state.

`--out <dir>` is required and has no default, because a build has no defensible default directory
and picking one would mean writing files somewhere the caller never named. `--base` is a path such
as `/docs`, or an absolute url when the site has an origin. `--target` generates the proxy
configuration; absent means nothing is generated at all, because a proxy is a standing gateway and
never appears unasked.

## The targets

`BUILD_TARGETS` is the accepted set and it is three groups. `PROXY_CONFIG_TARGETS` can rewrite a
route, so each gets a generated configuration; `DIRECT_TARGETS` cannot, so their pages carry the
direct mode warning instead and requests go straight from the reader to the API; `none` is the
explicit nothing.

| Target             | Kind   | What it emits                                |
| ------------------ | ------ | -------------------------------------------- |
| `netlify`          | config | `_redirects`                                 |
| `vercel`           | config | `vercel.json`                                |
| `nginx`            | config | `openref-proxy.nginx.conf`                   |
| `caddy`            | config | `openref-proxy.caddy`                        |
| `nitro`            | config | `server/routes<base>/_proxy/[...].ts`        |
| `cloudflare-pages` | config | `functions<base>/_proxy/[[path]].js`         |
| `s3-cloudfront`    | config | `openref-proxy.cloudfront.json`              |
| `github-pages`     | direct | nothing; pages carry the direct mode warning |
| `gitlab-pages`     | direct | nothing; pages carry the direct mode warning |
| `s3`               | direct | nothing; pages carry the direct mode warning |
| `none`             | none   | nothing                                      |

`--target auto` reads `NETLIFY`, `VERCEL` and `CF_PAGES` from the environment, and exactly those
three: `GITHUB_ACTIONS` and `GITLAB_CI` say where the build runs rather than where the site is
deployed, and a Netlify site is routinely built on GitHub Actions. Seeing none of the three, or
seeing more than one, falls back to `none` with a warning that names what was seen.

Every upstream is a literal in the generated output and the client contributes a path suffix only:
no rule reads a host, a header, a query parameter or a body to decide where to send. The two
executable artefacts, the Nitro route and the Cloudflare Pages function, keep the property the same
way, with a table of literals indexed by a `u<N>` segment and a 403 for anything else. A document
declaring no absolute http or https server pins nothing, and the build says so rather than writing
an empty rule set. `vercel.json` is the one file that cannot carry the gateway comment, because the
platform validates it strictly and admits neither a comment nor an unknown member, so the build
prints that sentence beside the file it wrote.

## What an absolute `--base` unlocks

Three head level artefacts need an absolute address with a scheme and a host: `sitemap.xml`, whose
`<loc>` is defined as an absolute url, the canonical link, and `og:url`. A base of `/docs` has
neither, and inventing one would be a guess. So a base carrying an origin produces those three, and
a base that does not produces the rest of the head and prints `NO_ORIGIN_NOTICE`, which names the
flag that would publish them. The sitemap carries no `lastmod`, deliberately: the only timestamp
available is the moment of the build, which would tell a crawler something false on every unchanged
page and make the file differ between two builds of one document.

A base path is parsed rather than interpolated, and refused when the parser would change it. It is
letters, digits and `-._~%` separated by `/`, an allowlist rather than a denylist of route syntax,
and any percent escape that changes the path is refused outright: `%2F` is a slash, and a base
spelling the site root in escapes would walk past the one refusal a deployment cannot recover from.

## What is always written

Independent of every flag: one directory with an `index.html` per page, every asset under `_assets`
named by the digest of its bytes, the navigation payload at `_navigation/<documentHash>`, the
serialized search index at `_search-index`, and `llms.txt`. The last takes the same audience the
mounted file takes, so a node marked `x-openref-audience: internal` is not listed, and a machine
crawlable file therefore takes the conservative audience while the operation's own page is written
as before.

The build also writes `.openref-build-manifest.json`, and the next build reads it.

## Determinism

The same input produces the same bytes. That is the property this build sells, and the design is
arranged around keeping it.

The build is sequential and runs in one process. `renderToString` is deterministic in one process,
and a worker pool would put the ordering of an unordered merge between the input and the output. It
is affordable: SPEC 20 allows 60 seconds for 1000 nodes on 4 cores, and 1000 nodes is 2103 pages
rendered in 2.2 seconds on the workstation recorded beside the figure in the build budget suite.

Hashing goes through `canonicalize` and never `JSON.stringify`. A page key is taken over the two
things that can change one page's bytes: the node itself, and the frame, which is the document with
its nodes and its hash removed, so that a change to the title, the servers, the navigation or the
health report rebuilds every page and a change to one operation rebuilds its own. A `Map` iterates
in insertion order, so any restructuring of the document would otherwise shuffle the bytes and
invalidate every key for no reason.

The manifest is what makes a rebuild honest. A directory listing says which files exist and nothing
about why, so it cannot tell a page this build wrote from a file the deployer dropped in beside it.
Every page records the digest of the bytes that build actually wrote, so a rebuild compares against
fact rather than intent; the manifest also carries the base, the site url, the direct target and the
generated rules, so a build under different flags does not carry pages forward from a build under
the old ones. A missing or unreadable manifest means a full build, which is the only safe reading of
"nothing is known about this directory", and only files the previous manifest claimed are ever
removed.

Zero outbound requests, by construction. Nothing here opens a socket: the document arrives already
normalized and the assets arrive as bytes a caller read. The proof installs a global network trap,
and it asserts the trap sees the calls it would report before asserting the build made none, since
a trap that watched nothing would report zero for the wrong reason.

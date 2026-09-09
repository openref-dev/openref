# @openref/nuxt

The Nuxt module. It is a wrapper, and that is its whole definition: `nuxt generate` writes the site
`openref build` writes, byte for byte, because it calls the same build, and Nitro answers the
addresses that site holds, because the same package produces both. What lives here is the mounting:
which hook, which route, which directory, which prerender ignore pattern, and how the generated
proxy route is written into the Nitro config. It stands on `@openref/core`, `@openref/render`,
`@openref/search` and `@openref/static`.

It does not see `@openref/nest`, and a Nuxt application does not install NestJS. The runtime facts
come from a running Nest application, so a reference built from a specification file carries what
that file says and nothing more. A host that wants the runtime pass runs `openref build --from-nest`
and points this module at what it produced, which is the same document by the time it reaches here.

## Not published, and why

This package is not on npm and it is not bundled into anything either, which makes it different
from the other internal packages. It has a consumer who cannot reach it any other way, so it would
be published but for one named reason, and it stays private until that reason is gone.

A resolved peer dependency belongs to the production licence zone; that was confirmed on 2026-09-04
and the rule does not move. This package's `nuxt` peer therefore drags its whole closure into that
zone, and the closure carries six packages under licences the zone forbids: `argparse` under
Python-2.0, `caniuse-lite` under CC-BY-4.0, `lightningcss` and `lightningcss-darwin-arm64` under
MPL-2.0, `@speed-highlight/core` under CC0-1.0 with no data-only reading, and `mdn-data` as a merged
two-version entry no reading matches. Measured on this tree the same day: the production zone goes
from 121 packages and no violation to 658 packages and six.

It is expected in a release after 1.0. Until then a Nuxt host builds with `openref build` and serves
the output directory, which is the same site this module would have generated.

The absence is reconciled in both directions rather than left to look like an oversight: the
`publish-list` gate holds this package's name against the held-back list, and additionally requires
it to be a workspace package, to be `private`, to be absent from the published list, and to be
absent from what `pnpm publish --dry-run` would emit.

## How it will be registered

Once it ships, one entry in `nuxt.config` and one options block under the `openref` key, which is
the module's declared `configKey`. Inline options beside the module override the ones written under
that key.

Two options are required. `spec` is the path of the OpenAPI or AsyncAPI document relative to the
project root, a path rather than an object because the module reads it once at build time and embeds
the text it read into the server build, and because a path is what `openref build` takes, which is
what makes the two builds comparable at all. `base` is where the reference is mounted, `/docs` or an
absolute url when the site has an origin, and it is never the site root: a Nuxt application
prerenders its own `index.html` there and so does the reference's overview, so one of the two would
silently win.

The rest are optional. `target` is the proxy target, and absent generates nothing at all, which is
the security posture rather than a default. `forwardCookies` is false unless explicitly turned on.
`lang` and `colorScheme` are the `lang` attribute and a forced scheme. `generate` is `true`, `false`
or `auto`, defaulting to `auto`, and it decides which half of the module runs: `auto` reads Nitro's
own `static` flag, which is true under `nuxt generate` and absent under `nuxt build`. It is one
option rather than two because the two halves must never both write. A static deployment has no
server, so the build writes every page; a server deployment renders them, so writing them too would
put a file in front of the route and the reference would be served by the one nothing measures.

Everything is refused at configuration time, which for a build time module means the build stops
with a sentence rather than the deployment serving something nobody asked for: a missing `spec` or
`base`, a `base` that is the site root, a `target` outside the accepted set, a `generate` or
`colorScheme` that is not one of its values, and a route the application already registers where the
reference would mount, since two handlers at one address means one of them silently wins.

## What each half does

`nitro:config` decides which half runs and declares what answers live. Under a server build it
writes a generated entry, registers two routes and publishes the assets: two, because Nitro's catch
all does not cover the mount itself, measured on Nitro 2.13.4 where `/docs/**` answered
`/docs/get-parcels` and left `/docs` to the application's own renderer, so the overview was the
framework's 404 page. Assets are published under `<base>/_assets` with a year of freshness, which
they can carry because each is addressed by its own digest. The hook also pushes the prerender
ignore pattern for the mount, which is the fork this module exists to prevent: Nitro's prerenderer
crawls the links of the pages it renders, so an application page linking the reference would have it
walk every page and write those files itself, out of the served path.

`nitro:build:public-assets` runs the static build into Nitro's public directory, and only when the
first hook said this build is generating. What lands there is the same set of files `openref build`
writes, under the mount directory taken from `base`: one directory with an `index.html` per page,
the hashed assets, the navigation payload, the search index, `llms.txt`, the sitemap when the base
carried an origin, and the build manifest. The parity suite is what keeps the byte-for-byte claim
honest.

`nitro` is the one target that becomes a route rather than a file, and the reason is that server
source inside a published directory is readable by anyone who asks for it. The generator's bytes are
the same ones `openref build --target nitro` writes; the module registers them as a Nitro handler
and the generation withholds the file. Asking for that target on a static build is a named
degradation rather than a silence: the built pages address `<base>/_proxy/u<N>`, nothing serves it
under `nuxt generate`, and the module says so on stderr.

Generated entries live in a `.openref` directory of the project. Two more obvious homes were tried
first and both failed: `.nuxt` is emptied after modules have run, so the bundler treated the handler
as external and the prerenderer then failed on a path that no longer existed; `node_modules/.cache`
resolved the reference entry and could not compile the proxy route, because the Nitro artefact is
TypeScript and Nitro's transform does not reach inside `node_modules`. Each file name carries a
digest of the base beside the readable part, so a project mounting two references at two bases
writes two files rather than one that the second mount overwrites.

## What is here

The module factory and its option resolution, the generate service and the public-directory output
store, the Nitro proxy route, the specification loader, and the runtime handler that serves an
embedded site.

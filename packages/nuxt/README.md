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

## What is here

The module factory and its option resolution, the generate service and the public-directory output
store, the Nitro proxy route, the specification loader, and the runtime handler that serves an
embedded site. The parity suite is what keeps the byte-for-byte claim above honest.

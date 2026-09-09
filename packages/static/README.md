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

The build writes a manifest of what it did, and the next build reads it. A directory listing says
which files exist and nothing about why, so it cannot tell a page this build wrote from a file the
deployer dropped in beside it. Every page records the digest of the bytes that build actually
wrote, so a rebuild compares against fact rather than intent, and a missing or unreadable manifest
means a full build, which is the only safe reading of "nothing is known about this directory".

Zero outbound requests, by construction. Nothing here opens a socket: the document arrives already
normalized and the assets arrive as bytes a caller read. The proof installs a global network trap,
and it asserts the trap sees the calls it would report before asserting the build made none, since
a trap that watched nothing would report zero for the wrong reason.

# @openref/federation

The merge engine and the remote lifecycle for a federated reference. The merge takes several
normalized documents and returns one: each service's nodes are prefixed and rewritten, name
collisions are allocated rather than silently won, schemas are classified as shared or distinct,
and a `MergeReport` records every rename and deduplication with its reason. The lifecycle around it
fetches each remote's specification document, polls it, caches it and merges what it has. It
reaches `@openref/core` and nothing else.

## Not published

This package is not on npm. It is architecturally separate, it has its own tests, and it ships
bundled inside `@openref/nest`, which is the package a consumer installs to get the federated
mount. A host configures remotes through that module's options and calls nothing here directly.

## When a remote is down

The done-when of this package is that one bad service cannot take down the documentation of the
others, and every mechanism here serves that sentence.

Each remote is fetched and polled on its own schedule, so a slow one delays nobody, and every fetch
is bounded by a timeout the lifecycle enforces itself, ten seconds by default, so a hung one cannot
hold a promise forever. `snapshot()` is a synchronous read of settled state, so serving a page never
waits on a network.

`failureMode` is `degrade` or `fail`, and `degrade` is the default. Under `degrade` the last
successful version keeps being served and is marked as such: a degraded remote that rendered
exactly like a fresh one would be a lie with a cache behind it. `remoteStatusOf` is a total function
over two observable facts, whether a version is being served and how the last completed attempt
ended, giving five statuses: `pending`, `stale`, `fresh`, `degraded` and `failed`. Each remote's
state carries the version being served, where it came from, the last failure and when the next
attempt is due, all as plain serializable data, because a page puts it in front of a reader.

A malformed document is a failure, not a partial merge. The body goes through the fail-closed
normalizer before anything else sees it, so a remote answering 200 with garbage degrades to its
cached version exactly like a remote answering nothing at all. There is no path on which half a
document reaches the merge.

The failure backoff doubles and is capped at eight times the refresh interval, because the point of
polling is to notice recovery and an unbounded doubling reads as a remote that never came back. It
carries no jitter, deliberately: jitter defends a fleet of clients against synchronizing on one
origin, and this is one process asking for one document.

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

## How a host configures it

One `federation` member on `OpenRefModule.forRoot`, mounted beside the documents as one more
reference. `route` and `id` are required, and both are refused at boot when missing: the route
because a mount needs one, the id because it becomes `IRDocument.id` of the merged document and is
what the CLI addresses it by. `title` defaults to the id, since no service's title is the whole,
and `version` defaults to `federated`, which says what it is. `servers` defaults to none, because a
merged document is served from no service's host and filling it with the union would hand the
console an origin chosen by sort order.

What joins the merge is two lists, and at least one of them has to be non empty:

- `remotes`, each `{ id, url, prefix? }`. The url is fetched and polled; `http` and `https` are the
  only two schemes accepted, so a configuration value can never become a local file read.
- `services`, each `{ id, prefix? }`, naming a `documents` entry of this same `forRoot` by id, so
  its augmented document and its runtime facts join the merge. A document mounted later through
  `setup` cannot: the merge already exists by then, and naming one is a boot refusal that says so.

The rest are the polling and merge policies, each with the default it arrives at:

| Option        | Default               | What it decides                                        |
| ------------- | --------------------- | ------------------------------------------------------ |
| `onConflict`  | `namespace`           | `namespace`, `fail` or `first-wins` for a claimed name |
| `refreshMs`   | `60000`               | Poll interval while the last attempt succeeded         |
| `timeoutMs`   | `10000`               | Ceiling on one fetch                                   |
| `failureMode` | `degrade`             | What the route serves when a remote is not fresh       |
| `store`       | this process's memory | Where last successful remote versions are kept         |

A service id is lower case letters, digits and hyphens, at most 64 characters, because it is
prefixed onto every node id and a node id becomes a page address and a file name. A prefix is an
absolute path of RFC 3986 unreserved segments, at most 256 characters. Both are checked by the
merge's own validator before the first request leaves, since a remote is a merge service whose
document has not arrived yet and two rules about one grammar is a defect class this repository
keeps finding.

`refreshMs` and `timeoutMs` are checked against what a platform timer can hold, and `refreshMs`
against a delay eight times its own size, because that is the largest one the backoff will
schedule. A delay past that ceiling does not wait longer, it fires at once: a `refreshMs` of
2 147 484 648 was measured producing 44 fetches in 60 ms instead of one every 24.9 days, and a
`timeoutMs` of the same size cut off an answer that had arrived in 20 ms and recorded that the
remote had not answered inside 2147484648 ms.

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

## What each status looks like on the page

- `pending`: no attempt has completed and there is nothing to serve.
- `stale`: no attempt has completed and a version from the cache driver is being served. It is the
  window right after a restart, which is not `fresh`, because this process has confirmed nothing,
  and not `degraded`, because nothing has failed.
- `fresh`: the last attempt succeeded and the served version is the remote's current document.
- `degraded`: the last attempt failed and an earlier version is still being served.
- `failed`: the last attempt failed and there is no version to serve at all.

The service card draws the status as an empty element rather than as text, and the browser fills
it. A page is cached by document hash and a degrading remote does not change that hash, so a server
drawn status would be right at render time and wrong exactly when it matters. The mark arrives from
`<mount>/_federation`, which answers 200 and `no-store` in both availability states and is the one
request a federated page makes on load. A service with no remote entry is a local document of the
serving process, current by construction, and keeps the neutral mark; a fetch that fails leaves
every mark neutral, which claims nothing.

Above the per remote rows the snapshot carries the one-line answer a banner needs. A ready snapshot
is `httpStatus: 200` with `degraded` true whenever any configured remote is not serving a fresh
version; an unavailable one is `httpStatus: 503` and a `reason` naming the remotes or the merge
failure responsible, which is `failureMode: 'fail'` in effect. The route reads that decision rather
than making one.

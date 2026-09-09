# @openref/search

The search index. It projects a normalized document into a flat list of records, builds a MiniSearch
index over them and serializes it to a single file, together with the loader and query side that
reads it back. It depends on `@openref/core` and MiniSearch and nothing else. The index is a pure
function of the IR, which is what lets the prerender cache key it by `IRDocument.hash` alongside the
rendered HTML.

## Not published

This package is not on npm. It is architecturally separate, it has its own tests, and it ships
bundled inside `@openref/nest`, which serves the index to the command palette, and inside the
`openref` CLI, which writes it into the static build's output directory.

## What is indexed

One record per HTTP operation, per event channel and per named schema, and `SearchDocumentKind` is
those three words. A record carries an id, a kind, a title, and whichever of a summary, a
description, a route, a method, a channel address, a tag list and a deprecation flag apply to it.
`schemaNames` holds the names of every named schema an operation reaches through its use sites, so a
route can be found by its type; it walks the slots rather than the schema bodies, because a slot
either names a schema or it does not.

Eight fields are tokenized and matched against: `title`, `summary`, `description`, `path`, `method`,
`address`, `tags` and `schemaNames`. Seven are stored and returned on a hit without being tokenized:
`id`, `kind`, `title`, `path`, `method`, `address` and `deprecated`. Field names are short on
purpose, because the serialized index has a size budget measured over a thousand records and every
name is repeated once per record.

Matching is prefix and fuzzy, weighted so that a route or a title outranks a mention deep in a
description: `title` and `path` at 4, `tags` and `schemaNames` at 3, `summary`, `method` and
`address` at 2, `description` at 1. A search for `orders` should reach `GET /orders` before an
operation whose prose happens to say the word. Building and loading share one configuration
function, because an index loaded with different field lists silently returns nothing rather than
failing.

## How it reaches the client

`buildSearchIndex` produces one string, and both surfaces write it at the same address. A Nest mount
answers `<mount>/_search-index`; the static build writes the same segment as a file at the root of
its output, taking the constant from the renderer rather than a copy of it that agrees today, since
a palette fetching a 404 falls open to the navigation rows and the full text search is simply gone
with nothing saying so.

The browser does not have it at first paint and is not meant to. The seam is `loadSearch` on the
hydrate options: a closure binds the page's document hash and mount point, fetches that address, and
hands `loadSearchIndex` the bytes. The index loader and MiniSearch live in their own chunk that
arrives on Ctrl-K and on no other gesture, 6,445 bytes gzip and 19,081 raw, measured on the shipped
artefact; until the reader opens the palette, none of it is downloaded, parsed or evaluated. Before
that wiring the palette matched navigation labels and hints and nothing of descriptions, parameters
or schema text.

`loadSearchIndex` checks the format version rather than assuming it, and refuses a mismatch by
throwing `SearchIndexFormatError`. An index is cached by document hash and can outlive the code that
wrote it, and MiniSearch loaded with a mismatched configuration returns nothing rather than failing,
which would look like a document with no content. A hit carries the stored fields and a score, and
`search` returns `DEFAULT_SEARCH_LIMIT` of them, twenty, which fills a result list without paging.

## Size, and why the bytes do not move

Two budgets over one artefact, both measured on a thousand nodes. The transfer cap is 250 KB gzip;
the raw cap is 1 MB, and it is the one that binds, because the gzip row is honest about transfer and
says nothing about the parse. Measured on the same fixture, 946,269 bytes raw against 177,080 gzip,
a ratio of 5.34, so an index sitting at the transfer cap would be about 1.37 MB of JSON for a client
to parse.

The index is serialized as constructed rather than canonicalized. Canonical form is the hash's tool,
and a payload that borrows it inherits a sort nobody asked for. The bytes are identical between two
builds because the records are collected in a deterministic order from a deterministic IR and
MiniSearch keeps insertion order in its structures, and the suite compares two independently built
indexes to say so.

That move away from canonical serialization costs one thing, and `densify` is what pays it.
MiniSearch keeps per field lengths in arrays indexed by field id and leaves a hole where a
configured field appears in no document at all, which `address` does in every HTTP only document.
Canonical serialization refused a hole outright; `JSON.stringify` writes `null` and hands the
loader a field length of null, which is silent. So every array is made dense before serialization,
a hole becoming the `0` those arrays mean, and the round trip through the loader is what checks the
claim that length arrays are the only sparse ones.

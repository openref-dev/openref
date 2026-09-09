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

One record per HTTP operation, per event channel and per named schema. A record carries an id, a
kind, a title, and whichever of a summary, a description, a route, a method, a channel address, a
tag list and a deprecation flag apply to it. `schemaNames` holds the names of every named schema an
operation reaches through its use sites, so a route can be found by its type; it walks the slots
rather than the schema bodies, because a slot either names a schema or it does not.

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

The index is serialized as constructed rather than canonicalized. Canonical form is the hash's tool,
and a payload that borrows it inherits a sort nobody asked for. The bytes are identical between two
builds because the records are collected in a deterministic order from a deterministic IR and
MiniSearch keeps insertion order in its structures, and the suite compares two independently built
indexes to say so. The file carries a format version, so a consumer that does not recognise the
shape refuses it rather than reading it as an empty one.

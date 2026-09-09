# @openref/core

The intermediate representation every other OPENREF package reads, the normalizers that produce it
from an OpenAPI or AsyncAPI document, and the deterministic digest stamped on each one. The
specification describes how the API looks and the running NestJS application knows how it behaves;
this package holds the shape they are joined in, and knows about neither.

Most consumers never install it. `@openref/nest` bundles what it needs and re-exports the IR types
its own signatures name, so a collector author installs one package; the same is true of
`@openref/vue` for a theme author. This one is published for whoever builds on the IR directly.

## Install

```sh
npm install @openref/core
```

No peer dependencies. It brings `@noble/hashes` and `yaml`, and nothing else.

## Use

```ts
import { hashDocument, normalizeSpecification, parseSpecification } from '@openref/core';
import { readFile } from 'node:fs/promises';

const text = await readFile('openapi.yaml', 'utf8');
const document = normalizeSpecification(parseSpecification(text, { source: 'openapi.yaml' }));

document.hash === hashDocument(document); // true
```

`normalizeSpecification` picks the reader the document names itself by, `openapi` or `asyncapi`, and
refuses one that declares both, since that is two specifications and neither reader can be the right
one. What comes back is finalized: stamped with its own digest and frozen at every depth, because a
hash goes on claiming to describe content after somebody has written to it.

## No framework, no DOM

Nothing here imports NestJS, Vue or anything from a browser. That is not an accident of layout: it is
what lets the normalizers run against a corpus of external specifications with no runtime present at
all, and it is checked by the dependency graph linter rather than left to habit. `core` depends on no
other package in this project, and no other package's types leak into its signatures.

The normalizer is fail closed. A specification it cannot read is refused with a `NormalizeError` that
names the problem, never rendered as though it were fine.

## Hashing goes through canonical serialization

`hash` and `hashDocument` canonicalize before they digest, and no path in this package hashes the
output of `JSON.stringify`. JavaScript iterates integer-like keys in numeric order rather than
insertion order, and HTTP status codes are integer-like keys, so a restructuring that changes nothing
a reader sees would otherwise shuffle the serialization and invalidate every cache keyed on the
digest. Canonical form is a recursive key sort by code point, a normalized number representation, and
maps written as sorted arrays of pairs.

`hashDocument` blanks the `hash` field before hashing, so two documents differing only in that field
produce one value, which is what makes the field checkable at all.

`IR_VERSION` moves when the digest of an unchanged document would change. It is at 3, and the last
bump is the one worth knowing about: the IR did not change shape, the serialization rule did, so
nothing a consumer compiles against moved while every stored digest stopped describing what it named.

## A second entry point

`@openref/core/security` carries the address, path and scheme rules: `addressRefusal`,
`isAddressLiteral`, `isHttpUrl`, `isSecureCredentialUrl`, `refusesPathSuffix`, and the scheme and
loopback lists. They sit on their own door because the same origin proxy, the static generator and
the CLI read them and no page's first paint does, and a barrel that the first paint imports
statically carries every module it re-exports.

## Errors

Every error this project raises extends `OpenRefError` and carries an `ErrorCode`. Both are exported
here along with the whole hierarchy: `NormalizeError`, `CollectorError`, `RunnerError`,
`FederationError`, `ThemeError`, `ConfigError` and their leaves. The other packages re-export the
subset they can throw, from here rather than by redeclaring them, so `instanceof` answers true and a
`catch` never needs a second dependency.

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

## Reading a document

```ts
parseSpecification(text: string, options?: ParseSpecificationOptions): unknown
normalizeSpecification(input: unknown, options?: NormalizeSpecificationOptions): IRDocument
```

`parseSpecification` reads JSON with the JSON parser when the text plainly is JSON, and YAML
otherwise. It takes `source`, which appears only in error messages and defaults to
`'specification'`, and `maxLength`, which defaults to `MAX_SPECIFICATION_LENGTH`, 32 MiB counted in
UTF-16 code units. The ceiling exists because YAML intake is superlinear in the number of keys of one
mapping: 0.13 s for 255 KB, 2.1 s for 2 MB, 7.2 s for 4.2 MB, and a 50 MB document that had not
returned after ten minutes. It bounds size and not shape, and it is checked before the parse, because
past that size the parse is the thing that does not come back.

`NormalizeSpecificationOptions` is the intersection of the two readers' own option types, so a member
one of them gains reaches the other by construction. All three members are shared and optional:

| Option              | Type                      | Default                   | What it does                                                            |
| ------------------- | ------------------------- | ------------------------- | ----------------------------------------------------------------------- |
| `documentId`        | `string`                  | a slug of the title       | Identity of the document, and the federation key                        |
| `externalDocuments` | `Record<string, unknown>` | none                      | Documents external references point at, keyed by the URI before the `#` |
| `cycleDepth`        | `number`                  | `DEFAULT_CYCLE_DEPTH`, 12 | Limit on reference chain depth                                          |

`normalizeOpenApiDocument` and `normalizeAsyncApiDocument` are exported too, for a caller that
already knows which it holds. The first supports OpenAPI 3.0, 3.1 and 3.2, and refuses Swagger 2.0 by
name with the advice to convert first; the second supports AsyncAPI 3.0 and 3.1. A 3.0 document and
its hand written 3.1 equivalent produce the same IR: `nullable` becomes a type union with `null`, and
a Schema Object's single `example` becomes `examples`.

Three more ceilings are exported, each a measurement rather than a preference:
`DEFAULT_MAX_SCHEMA_NESTING`, 256, bounds what is written out, against a deepest corpus document of
26 levels; `MAX_NORMALIZE_RECURSION`, 512, bounds the stack, where an `allOf` chain was measured to
exhaust it at around 1200 links; `CANONICAL_MAX_DEPTH`, 1024, bounds the serializer, which before it
left a band of documents that normalized and then could not be hashed.

## The IR type families

| Type             | What it is                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `IRDocument`     | The whole reference: `id`, `kind`, `hash`, `info`, `servers`, `navigation`, `nodes`, `schemas`, `security`, `relationships`, `webhooks`, and the optional `runtime`, `health`, `extensions`, `services`, `unreadKeys` and `readerProblems` |
| `IRNode`         | `IROperation \| IRChannel`, discriminated by `kind`, so exhaustiveness works at every use site                                                                                                                                             |
| `IROperation`    | One HTTP operation: method, path, parameters, request body, responses, security                                                                                                                                                            |
| `IRChannel`      | One event channel: a topic, a queue or a WebSocket path, with its operations and messages                                                                                                                                                  |
| `IRSchema`       | A schema as stored: `normalized` for a JSON Schema compatible dialect, `raw` otherwise                                                                                                                                                     |
| `IRJsonSchema`   | The normalized shape every compatible dialect reduces to; a detected cycle becomes `$cycle`                                                                                                                                                |
| `IRFact<T>`      | `{ value, confidence, collector }`. A bare runtime value with no provenance is not representable                                                                                                                                           |
| `IRConfidence`   | `'declared'`, `'derived'`, `'inferred'`. There is no fourth level                                                                                                                                                                          |
| `IRNodeRuntime`  | The facts attached to one node: source, guards, pipes, scopes, roles, rate limit, errors, streaming, timeout, policies, parameter reads, drift                                                                                             |
| `IRRuntimeMeta`  | Document wide: which collectors ran, which were skipped and why, the source link template                                                                                                                                                  |
| `IRHealthReport` | The score, the operation count, the checks, the drift and what suppression did                                                                                                                                                             |
| `IRDriftIssue`   | One finding, with its rule, classification, edit, basis and assertion                                                                                                                                                                      |
| `IRRelationship` | One edge of the topology; the arrow points where the message goes                                                                                                                                                                          |

`IRDriftRule` is the fifteen rule ids, and `DRIFT_RULE_CODES` maps each to the display code the
health page prints. `IRParameterStyle` is the seven serialization styles and `IRParameterLocation`
the four locations, which is the matrix `@openref/runner` implements.

## No framework, no DOM

Nothing here imports NestJS, Vue or anything from a browser. That is not an accident of layout: it is
what lets the normalizers run against a corpus of external specifications with no runtime present at
all, and it is checked by the dependency graph linter rather than left to habit. `core` depends on no
other package in this project, and no other package's types leak into its signatures.

The normalizer is fail closed. A specification it cannot read is refused with a `NormalizeError` that
names the problem, never rendered as though it were fine. A `$ref` that cannot be resolved is a
`RefResolutionError`, a chain past `cycleDepth` is a `CycleDepthError`, and a dialect outside the
supported set is an `UnsupportedDialectError`.

`finalizeDocument` is what a producer ends with: it stamps the digest and freezes the result in one
step, because those are one claim. `freezeDocument` goes deep and replaces the mutators of every
`Map` and `Set` it meets, so a write throws a `TypeError` rather than succeeding quietly.

## Hashing goes through canonical serialization

`hash` and `hashDocument` canonicalize before they digest, and no path in this package hashes the
output of `JSON.stringify`. JavaScript iterates integer-like keys in numeric order rather than
insertion order, and HTTP status codes are integer-like keys, so a restructuring that changes nothing
a reader sees would otherwise shuffle the serialization and invalidate every cache keyed on the
digest. Canonical form is a recursive key sort by code point, a normalized number representation, and
maps written as sorted arrays of pairs.

There is one exception, and it is the only one: a map whose key order the document itself wrote is
written in that order. `properties`, `examples`, `encoding`, `mapping`, `variables` and the rest of
that list are ordered; `nodes`, `schemas` and `webhooks` are sorted. Without the exception the hash
was not a function of everything a page is drawn from, and a thousand shuffled spellings of one
document produced one hash and two different `llms-full.txt`.

```ts
canonicalize({ b: 1, a: 2 }); // '{"a":2,"b":1}'
canonicalize({ properties: { b: 1, a: 2 } }); // '{"properties":{"b":1,"a":2}}'
canonicalize({ b: 1, a: 2 }, 'raw'); // '{"b":1,"a":2}'
```

The second argument is the member name a value stands for when it has been lifted out of one, so one
value has one canonical form wherever it is hashed. `compareByCodePoint`, `normalizeNumber` and
`quoteString` are exported alongside, and each exists because the built-in was wrong for this: the
default string comparison mis-sorts astral characters, `-0` and `1e3` need one representation, and a
lone surrogate has to be escaped rather than replaced.

`hashDocument` blanks the `hash` field before hashing, so two documents differing only in that field
produce one value, which is what makes the field checkable at all.

`IR_VERSION` moves when the digest of an unchanged document would change. It is at 3, and the last
bump is the one worth knowing about: the IR did not change shape, the serialization rule did, so
nothing a consumer compiles against moved while every stored digest stopped describing what it named.

## A second entry point

`@openref/core/security` carries the address, path and scheme rules: `addressRefusal`,
`isAddressLiteral`, `parseIpv4`, `parseIpv6`, `refusesPathSuffix`, `isHttpUrl`,
`isSecureCredentialUrl`, and the `HTTP_SCHEMES`, `DOCUMENT_LINK_SCHEMES` and `LOOPBACK_HOSTS` lists.
They sit on their own door because the same origin proxy, the static generator and the CLI read them
and no page's first paint does, and a barrel that the first paint imports statically carries every
module it re-exports. Measured at 491 bytes against a budget with 205 to give. Every one of them is
on the main barrel too, so nothing has to be imported twice.

## Errors

Every error this project raises extends `OpenRefError` and carries an `ErrorCode`. Both are exported
here along with the whole hierarchy: `NormalizeError`, `CollectorError`, `RunnerError`,
`FederationError`, `ThemeError`, `ConfigError`, `CliError` and their leaves, twenty-five classes in
all. The other packages re-export the subset they can throw, from here rather than by redeclaring
them, so `instanceof` answers true and a `catch` never needs a second dependency.

`ErrorCode` is a frozen object with a derived union type rather than an `enum`, and the difference is
one a consumer feels. A published `declare enum` is nominal, so a `switch` written over the bare
strings got no narrowing and was told the two types have no overlap, which teaches a consumer to add
a `default`, which is where a code added in a minor version goes to be silently handled as something
else. Both `ErrorCode.NORM_REF_UNRESOLVED` and the literal `'NORM_REF_UNRESOLVED'` type-check. The
thirty codes read `{DOMAIN}_{SPECIFIC}` across seven domains, and a code is part of the observable
output of `doctor`, so renaming one is a major version.

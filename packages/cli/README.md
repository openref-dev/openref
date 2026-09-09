# openref

The command line. It reads a document, or boots a NestJS application and reads both, and then builds
a static reference, reports on documentation health, lints a specification, diffs two of them, or
posts a review comment on a pull request. Everything it renders goes through the same normalizer and
the same renderer that `@openref/nest` serves from, so a built site and a mounted one are the same
pages.

## Install

```sh
npm i -D openref
```

No peer dependencies. `--from-nest` boots a compiled entry point of your application, so for that
one source your own build has to exist first.

## Use

```sh
npx openref build --spec openapi.yaml --out dist-docs --base https://docs.example.com/api
npx openref doctor --from-nest dist/main.js --fail-on=drift
```

## The commands

| Command            | What it does                                                                     |
| ------------------ | -------------------------------------------------------------------------------- |
| `build`            | Writes a static reference from one source: `--spec`, `--config` or `--from-nest` |
| `preview`          | Loads a document from `--spec` and reports what is in it                         |
| `doctor`           | Boots the application and compares it against the specification                  |
| `lint <spec>`      | Structural problems in a document, with no application involved                  |
| `diff <old> <new>` | Breaking and non-breaking changes between two documents or two git refs          |
| `pr`               | Diffs against a base ref and posts the review comment                            |

Exactly one source flag names the document for `build`. `--base` may be a path such as `/docs` or an
absolute url; only an absolute one can produce `sitemap.xml`, the canonical link and `og:url`, which
is why the flag takes both. `--target` generates the rewrite rules for a hosting platform that can
rewrite, and the platforms that cannot get the direct mode warning on the page instead of a
configuration file that would not work.

`preview` parses `--watch` and does not yet act on it. A rebuilding preview server is not built.

Either side of `diff` may be a path, a `<ref>:<path>`, or a bare git ref whose file comes from
`--spec`. `pr` is what the GitHub action in `packages/action` runs; every one of its options also
answers to an environment variable, so a workflow passes them without interpolating anything into a
shell.

## Three exit codes, and they are frozen

| Code | Meaning                                                                                   |
| ---- | ----------------------------------------------------------------------------------------- |
| `0`  | Nothing to report                                                                         |
| `1`  | The command ran and found something: drift, a lint violation, a breaking diff             |
| `2`  | The command could not run: a bad flag, a missing file, an application that would not boot |

`doctor` and `pr` exit 0 by default and only report. `--fail-on=drift|warn|error` and
`--fail-on-breaking` are what turn a finding into exit 1, so the first run of a new pipeline tells you
what it found rather than failing the build.

## The build is deterministic

Two builds of one document write byte identical output, generated files included, and that is pinned
by a test that builds twice and compares two independent outputs rather than one output against
itself. It is what makes a build cacheable, a preview diffable, and a deployment something you can
reproduce from a tag.

Nothing the built site does at runtime reaches the network: no CDN, no telemetry, no version check.
Every asset is written under a name carrying the digest of its own bytes.

## `doctor --fix`

`--fix` writes the findings the report classifies as silence back into the source as new decorators.
It adds and never alters, and it refuses a dirty working tree, so what it wrote is exactly what
`git diff` shows. `--dry-run` prints the same edits and writes nothing. Findings that are not
mechanically fixable are never touched: a rule whose remedy is a judgement is reported and left alone.

## Embedding it

`runCli` never throws and turns everything into an exit code. `loadDocument` and
`loadFromNestApplication` do throw, and the classes they raise, `UsageError`, `NormalizeError`,
`ApplicationBootError` and `ShutdownTimeoutError`, are exported from this package so a `catch` can
tell a bad path from a broken document.

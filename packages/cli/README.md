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

`openref` with no arguments, and `openref --help`, print the whole surface. Every command answers
`--help` and `-h`. A flag a command does not have is a usage error rather than a flag silently
ignored, and `--key=value` and `--key value` are both accepted, the second form only for a flag that
takes a value.

### `build`

```sh
openref build --spec openapi.yaml --out dist-docs --base /docs --target nginx
```

| Flag          | Argument                 | Default   | What it does                                     |
| ------------- | ------------------------ | --------- | ------------------------------------------------ |
| `--spec`      | path to JSON or YAML     | none      | An OpenAPI document on disk                      |
| `--config`    | path to a JSON file      | none      | A file naming `spec` and the other options       |
| `--from-nest` | path to a compiled entry | none      | Boots the application headlessly and closes it   |
| `--out`       | directory                | required  | Where the static build is written                |
| `--base`      | path or absolute url     | site root | Where the site will be served from               |
| `--target`    | hosting target name      | none      | Generates the proxy configuration for a platform |

Exactly one of `--spec`, `--config` and `--from-nest` names the source. `--base` takes both a path
such as `/docs` and an absolute url such as `https://docs.example.com/api`, and only the absolute
form can produce `sitemap.xml`, the canonical link and `og:url`, because the sitemap grammar defines
`<loc>` as an absolute url and a sitemap of paths is not a sitemap. `llms.txt` is written either way.
The report printed at the end says which of the two happened, on its `sitemap` line.

`--target` accepts `nitro`, `nginx`, `caddy`, `netlify`, `vercel`, `cloudflare-pages` and
`s3-cloudfront`, which can rewrite a route and get a generated configuration; `github-pages`,
`gitlab-pages` and `s3`, which cannot, so their pages carry the direct mode warning instead; `none`,
the explicit nothing; and `auto`, which reads the platform environment variables and falls back to
`none` with a warning on stderr. Absent, no proxy configuration is generated at all, because a proxy
is a standing gateway and never appears unasked.

### `preview`

```sh
openref preview --spec openapi.yaml
```

`--spec` is required and is the only source this command accepts. It prints one line naming what was
loaded, the title, the version and the node count, and it is honest about being a load confirmation
and nothing more. `--watch` is parsed and acted on nowhere: a rebuilding preview server is not built,
and the flag is accepted rather than refused because the surface it belongs to is written down.

### `doctor`

```sh
openref doctor --from-nest dist/main.js --fail-on=drift
openref doctor --from-nest dist/main.js --json > health.json
```

| Flag                | Argument                 | Default  | What it does                                                |
| ------------------- | ------------------------ | -------- | ----------------------------------------------------------- |
| `--from-nest`       | path to compiled entry   | required | The application to boot, headlessly, and close when done    |
| `--fail-on`         | `drift`, `warn`, `error` | none     | Which findings exit 1; omitted, this command always exits 0 |
| `--json`            | none                     | off      | The versioned machine readable report instead of the text   |
| `--fix`             | none                     | off      | Writes the silence findings into source as new decorators   |
| `--dry-run`         | none                     | off      | With `--fix`, prints the same edits and writes nothing      |
| `--show-suppressed` | none                     | off      | Prints the findings `runtime.suppress` took out             |

`--from-nest` is required because doctor compares the specification against the running application,
and there is nothing to compare a document on disk against itself. The entry point is loaded and its
own factory calls `NestFactory.create`, so this package never imports `@nestjs/*`; a booted
application is given `DEFAULT_CLOSE_TIMEOUT_MS`, 5000, to close before the run reports that it
would not.

The text report prints the title, the marked health score, the operation count, the checks, and then
the classes `runtime.suppress` removed with their reasons and their match counts. Those classes are
printed with no flag at all, because a report that hides its own filtering is the report the option
exists to stop; `--show-suppressed` adds the findings themselves, which are the volume. Skipped
collectors are printed too, and are not findings.

`--fail-on` is cumulative, loudest to quietest: `error` counts error findings, `warn` adds warnings,
`drift` counts anything at all. Omitted, the command exits 0 whatever it found, so the first run of a
new pipeline tells you what it found rather than failing the build. `--fix` does not change what
`--fail-on` counts: the report is taken before a byte is written.

### `doctor --fix`

`--fix` writes the findings the report classifies as silence back into the source as new decorators.
It adds and never alters, and it refuses a dirty working tree, so what it wrote is exactly what
`git diff` shows. `--dry-run` computes the same edits in the same order and writes nothing, printing
a notice when the tree is dirty rather than refusing.

Only `.ts` files inside the repository root are ever opened, and the only path it resolves is the one
the source collector recorded for a handler, so the specification is never rewritten. A finding is
left alone, with the reason named, when it is a contradiction rather than a silence, when the
classifier sends it to a person, when a guard was observed and no `guardSecuritySchemes` entry names
it, when the edit would have to reach inside a decorator the handler already carries, when nothing
says which file and which handler, and when no mechanical edit can be spelled for it. A value that
cannot be written inside a quoted literal without escaping is refused rather than quoted cleverly.

### `lint`

```sh
openref lint openapi.yaml
```

One positional, the document. It runs the quality rules over a specification with no application, so
every rule that needs a runtime fact is out of scope on every operation. There is no summary banner
and no percentage: it prints findings, and prints nothing at all on a clean run. It has no
`--fail-on`, because its rule set is deliberately the small always-actionable one, so any finding at
all is exit 1.

### `diff`

```sh
openref diff openapi.old.yaml openapi.yaml
openref diff main HEAD --spec openapi.yaml
openref diff v1.2.0:openapi.yaml openapi.yaml
```

Either side may be a path, a `<ref>:<path>`, or a bare git ref. A side that names an existing file is
that file; a bare side is a ref, and the file read under it comes from `--spec` or from whichever
side named a file. A side that cannot be loaded is exit 2, because exit 1 is reserved for the command
having run and found something.

### `pr`

`pr` is what the GitHub action in `packages/action` runs. It diffs the working tree against the pull
request's base ref, builds the preview when asked, and posts the review comment, updating the one it
posted before rather than adding another. A comment is updated only when the identity the token
authenticates as wrote it; an identity neither the user path nor the installation path establishes
posts a new comment rather than overwriting one it cannot prove is its own.

| Flag                   | Environment variable          | What it does                                              |
| ---------------------- | ----------------------------- | --------------------------------------------------------- |
| `--spec <path>`        | `OPENREF_PR_SPEC`             | The document, read at the base ref and on disk. Required  |
| `--base <ref>`         | `OPENREF_PR_BASE`             | The base ref; taken from the event payload otherwise      |
| `--out <dir>`          | `OPENREF_PR_OUT`              | Build the preview here. Absent means no build             |
| `--preview-base <url>` | `OPENREF_PR_PREVIEW_BASE`     | Where the preview is published; `pr-<number>` is appended |
| `--preview-url <url>`  | `OPENREF_PR_PREVIEW_URL`      | An address somebody else already knows, printed as given  |
| `--fail-on-breaking`   | `OPENREF_PR_FAIL_ON_BREAKING` | Exit 1 when the diff is breaking. Omitted, always 0       |
| `--dry-run`            | `OPENREF_PR_DRY_RUN`          | Print the comment instead of posting it                   |
| `--repository <o/n>`   | `OPENREF_PR_REPOSITORY`       | The repository; from `GITHUB_REPOSITORY` otherwise        |
| `--pull-request <n>`   | `OPENREF_PR_NUMBER`           | The pull request number; from the event otherwise         |
| `--target <name>`      | none, on purpose              | Hosting target for the preview build                      |

The flag wins where both are given. The token is the one input with no flag: it arrives only as
`GITHUB_TOKEN`, because a token on a command line is visible in `ps` and in shell history, and
`--token` is refused by name rather than ignored. `GITHUB_EVENT_NAME`, `GITHUB_EVENT_PATH`,
`GITHUB_API_URL`, `GITHUB_OUTPUT` and `GITHUB_STEP_SUMMARY` are read from the workflow with no flag.
`--repository` is parsed into owner and name before any address is built, and anything that is not
exactly two segments is a usage error, as is a `GITHUB_API_URL` that is neither an https origin nor
http on loopback.

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

## Embedding it

```ts
import { EXIT_CODE, loadDocument, runCli, UsageError } from 'openref';

const outcome = await runCli(['doctor', '--from-nest', 'dist/main.js']);
outcome.exitCode === EXIT_CODE.SUCCESS;
```

`runCli` never throws and turns everything into an exit code. `loadDocument` and
`loadFromNestApplication` do throw, and the classes they raise, `UsageError`, `NormalizeError`,
`ApplicationBootError` and `ShutdownTimeoutError`, are exported from this package so a `catch` can
tell a bad path from a broken document. `CliError`, `OpenRefError` and `ErrorCode` come out too, for
catching a whole branch of the hierarchy rather than a leaf.

The `pr` command's own internals are deliberately not exported. A published export surface is frozen
public API, and growing it so a test in another package can reach a name commits this project to
supporting names no consumer asked for.

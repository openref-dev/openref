/** The whole command surface, verbatim from SPEC 17. Printed by `openref` and `openref --help`. */
export const TOP_LEVEL_USAGE = `openref build   [--spec|--config|--from-nest] [--out] [--base] [--target]
openref preview [--spec] [--watch]
openref doctor  [--from-nest] [--fail-on=drift|warn|error] [--json]
openref lint    <spec>
openref diff    <old> <new>
openref pr      [--spec] [--base] [--out] [--preview-base] [--preview-url] [--fail-on-breaking]
`;

export const BUILD_USAGE = `Usage: openref build [--spec <path> | --config <path> | --from-nest <path>] [--out <dir>] [--base <path>] [--target <name>]

Builds a static reference from one document source. Exactly one of --spec, --config or
--from-nest names the source.

  --spec <path>       an OpenAPI document on disk, JSON or YAML
  --config <path>     a JSON file naming "spec" and the other options above
  --from-nest <path>  a compiled NestJS entry point, booted headlessly and closed when done
  --out <dir>         where the static build is written; required
  --base <base>       a path such as /docs, or an absolute url such as
                      https://docs.example.com/api. Only an absolute base can
                      produce sitemap.xml, the canonical link and og:url
  --target <name>     hosting target the proxy configuration of SPEC 16.2 is
                      generated for: nitro, nginx, caddy, netlify, vercel,
                      cloudflare-pages or s3-cloudfront. github-pages,
                      gitlab-pages and s3 cannot rewrite routes, so pages carry
                      the direct mode warning instead. auto detects the platform
                      from its environment variables and falls back to none with
                      a warning. Absent means no proxy is generated at all
  --help              print this message
`;

export const PREVIEW_USAGE = `Usage: openref preview --spec <path> [--watch]

Loads a document and previews it. --spec is required; --from-nest and --config are not
accepted here, per SPEC 17's own command surface.

  --spec <path>  an OpenAPI document on disk, JSON or YAML
  --watch        re-read the document when it changes
  --help         print this message
`;

export const DOCTOR_USAGE = `Usage: openref doctor --from-nest <path> [--fail-on=drift|warn|error] [--json]

Boots a NestJS application and reports on documentation health. --from-nest is required:
doctor compares the specification against the running application, and there is nothing to
compare a document on disk against itself.

  --from-nest <path>  a compiled NestJS entry point, booted headlessly and closed when done
  --fail-on <level>   drift, warn or error; which findings exit 1 rather than 0. Omitted, this
                       command always exits 0 and only reports
  --json              print the versioned machine readable report instead of the text one
  --help              print this message
`;

export const LINT_USAGE = `Usage: openref lint <spec>

Checks a specification for structural problems, independent of any running application.

  <spec>  path to an OpenAPI document, JSON or YAML
  --help  print this message
`;

export const DIFF_USAGE = `Usage: openref diff <old> <new> [--spec <path>]

Compares two specifications and reports breaking and non-breaking changes. Either side may be
a file on disk or a git ref. A side that names an existing file is that file; a side written
<ref>:<path> is read at that ref; a bare side is a ref, and the file under it comes from
--spec or from whichever side named a file.

  <old>          the earlier document: a path, <ref>:<path>, or a bare git ref
  <new>          the later document, read the same three ways
  --spec <path>  the document to read at a bare git ref, relative to this directory
  --help         print this message
`;

export const PR_USAGE = `Usage: openref pr --spec <path> [--base <ref>] [--out <dir>] [--preview-base <url>]
                  [--preview-url <url>] [--target <name>] [--fail-on-breaking] [--dry-run]

Diffs the working tree against the pull request's base ref, builds the preview when asked, and
posts the SPEC 17.2 comment, updating the one it posted before rather than adding another.

A comment is updated only when the identity this token authenticates as wrote it. A user token is
named by GET /user and matched on its login; an installation token, which that endpoint refuses,
is matched on the fields GitHub sets on its own comments. An identity neither path establishes
posts a new comment rather than overwriting one it cannot prove is its own.

Every option also answers to an environment variable, which is how the GitHub action passes it
without interpolating anything into a shell. The token is the exception: it arrives only as
GITHUB_TOKEN and there is deliberately no flag for it. --repository is parsed into owner and
name before any address is built; anything that is not exactly two segments, whitespace and
control characters included, is a usage error, and so is a GITHUB_API_URL that is not an https
origin or http on the loopback address.

Environment, flag first where both are given:

  OPENREF_PR_SPEC            --spec
  OPENREF_PR_BASE            --base
  OPENREF_PR_OUT             --out
  OPENREF_PR_PREVIEW_BASE    --preview-base
  OPENREF_PR_PREVIEW_URL     --preview-url
  OPENREF_PR_FAIL_ON_BREAKING  --fail-on-breaking
  OPENREF_PR_DRY_RUN         --dry-run
  OPENREF_PR_REPOSITORY      --repository
  OPENREF_PR_NUMBER          --pull-request

Read from the workflow itself, with no flag: GITHUB_TOKEN, GITHUB_EVENT_NAME, GITHUB_EVENT_PATH,
GITHUB_REPOSITORY, GITHUB_API_URL, GITHUB_OUTPUT and GITHUB_STEP_SUMMARY. --target has no
environment variable and no action input on purpose: it names a hosting target for the preview
build, per SPEC 16.2, which is a property of where the preview goes rather than of the pull
request.

  --spec <path>          the OpenAPI document, read at the base ref and on disk. Required
  --base <ref>           the base ref; taken from the event payload when a workflow supplies one
  --out <dir>            build the preview into this directory. Absent means no build
  --preview-base <url>   where the preview is published; pr-<number> is appended, and the result
                         is both the build's base and the address printed in the comment
  --preview-url <url>    an address somebody else already knows, printed as it is given
  --target <name>        proxy configuration for the preview build, per SPEC 16.2
  --fail-on-breaking     exit 1 when the diff is breaking. Omitted, this command always exits 0
  --dry-run              print the comment instead of posting it
  --repository <o/n>     the repository; taken from GITHUB_REPOSITORY otherwise
  --pull-request <n>     the pull request number; taken from the event payload otherwise
  --help                 print this message
`;

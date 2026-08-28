/** The whole command surface, verbatim from SPEC 17. Printed by `openref` and `openref --help`. */
export const TOP_LEVEL_USAGE = `openref build   [--spec|--config|--from-nest] [--out] [--base] [--target]
openref preview [--spec] [--watch]
openref doctor  [--from-nest] [--fail-on=drift|warn|error] [--json]
openref lint    <spec>
openref diff    <old> <new>
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

export const DIFF_USAGE = `Usage: openref diff <old> <new>

Compares two specifications and reports breaking and non-breaking changes.

  <old>   path to the earlier OpenAPI document
  <new>   path to the later OpenAPI document
  --help  print this message
`;

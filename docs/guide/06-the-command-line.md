## The command line

```bash
npm i -D openref
```

<!-- gen: count:fence -->Six<!-- /gen --> commands. `build` and `doctor` are the two you will use.

```
openref build   [--spec|--config|--from-nest] [--out] [--base] [--target]
openref preview [--spec] [--watch]
openref doctor  [--from-nest] [--fail-on=drift|warn|error] [--json]
openref lint    <spec>
openref diff    <old> <new>
openref pr      [--spec] [--base] [--out] [--preview-base] [--preview-url] [--fail-on-breaking]
```

### `build`: the reference as a directory of files

```bash
openref build --spec openapi.yaml --out dist-docs --base https://docs.example.com
```

One directory per page with its own `index.html`, plus `sitemap.xml`, `llms.txt`, the search
index, the navigation payload and digest named assets. No server, no runtime, no JavaScript
required to read a page. Two builds of the same document write the same bytes.

The source is exactly one of <!-- gen: count:list -->three<!-- /gen -->:

- `--spec <path>`, an OpenAPI or AsyncAPI document on disk, JSON or YAML
- `--config <path>`, a JSON file naming `spec` and the other options
- `--from-nest <path>`, a compiled NestJS entry point, booted headlessly and closed again, so
  the static build carries the runtime facts a served reference has

`--base` takes a path such as `/docs` or an absolute URL. Only an absolute base can produce
`sitemap.xml`, the canonical link and `og:url`, because those are defined as absolute URLs and
a sitemap of paths is not a sitemap.

### `build --target`: the console still works on a static host

A static page cannot send a cross origin request to your API without the API allowing it. So
the build can generate the proxy configuration for the host it is going to:

```bash
openref build --spec openapi.yaml --out dist-docs --target netlify
```

| Target | What is generated |
| --- | --- |
| `nitro`, `nginx`, `caddy`, `netlify`, `vercel`, `cloudflare-pages`, `s3-cloudfront` | a rewrite rule to the servers the document declares |
| `github-pages`, `gitlab-pages`, `s3` | nothing, because they cannot rewrite; pages carry a warning saying the console sends directly |
| `auto` | reads the platform's environment variables, falls back to none with a warning |

Absent means no proxy configuration is generated at all. A proxy is a standing gateway and
never appears unasked.

### `doctor`: what the application and the document disagree about

```bash
openref doctor --from-nest dist/main.js
```

It boots your application, collects the runtime facts, compares them to the document and
prints the findings with rule codes. `--fail-on drift|warn|error` is what makes it a CI gate;
without it the command always exits 0 and only reports.

`--json` prints a versioned machine readable report. `--fix` writes the findings the report
classifies as silence back into your source as new decorators. It only adds, never alters, and
refuses to run on a dirty working tree.

### `diff`: breaking and non-breaking, told apart

```bash
openref diff v1.2.0 HEAD --spec openapi.yaml
```

Either side is a file, a `<ref>:<path>`, or a bare git ref. The classification is by direction
rather than by presence: a constraint that got tighter and the same constraint loosened are two
different findings, and the line names the keyword and both values.

### `lint`: the document alone

```bash
openref lint openapi.yaml
```

Structural problems, with no application involved.

### `preview` and `pr`

`preview --spec <path> --watch` serves the reference and re-reads the document when it changes.

`pr` produces the comment a pull request gets: what changed, whether anything breaking is in
it, and a link to the preview build. It is what the GitHub Action runs.

### In CI

```yaml
- run: npx openref lint openapi.yaml
- run: npx openref diff origin/main HEAD --spec openapi.yaml
- run: npx openref doctor --from-nest dist/main.js --fail-on error
- run: npx openref build --spec openapi.yaml --out dist-docs --base ${{ env.DOCS_URL }}
```

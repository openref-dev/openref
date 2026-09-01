# The static build, per platform

```bash
pnpm --filter @openref/example-static-build start
```

<!-- gen: count:hosting-targets -->Ten<!-- /gen --> builds of one document, one per hosting target, into `dist/sites/`. Not a server: a static
build has no runtime, so this example builds and exits.

## What differs between them

Every target writes the same pages. What differs is whether the request console can still send
once the site is deployed, because a static page cannot reach your API across origins unless the
API allows it.

| Targets | What the build generates |
| --- | --- |
| `nginx`, `caddy`, `nitro`, `netlify`, `vercel`, `cloudflare-pages`, `s3-cloudfront` | a rewrite to the servers the document declares |
| `github-pages`, `gitlab-pages`, `s3` | nothing, because they cannot rewrite; the pages carry a warning saying the console sends directly |

Compare `dist/sites/nginx/` with `dist/sites/github-pages/`. The <!-- gen: count:direct-targets -->three<!-- /gen --> that generate nothing are
listed rather than omitted: a reader deploying to GitHub Pages needs to know that their API has to
allow the origin, and a list holding only the <!-- gen: count:rewriting-targets -->seven<!-- /gen --> working targets would tell them the opposite
by saying nothing.

Open any `index.html` from the file system. There is no server to start.

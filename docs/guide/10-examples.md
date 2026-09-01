## Examples

<!-- gen: count:table -->Seven<!-- /gen --> directories in the repository, each one small enough to read in a sitting. The
ones that listen are booted by a committed test, which fetches a page from each of them.

| Directory | What it is for |
| --- | --- |
| `examples/nest-minimal` | the first minute: one controller, one line of setup, a page you can send requests from |
| `examples/runtime-intelligence` | a hand written collector, and what a fact with provenance looks like |
| `examples/custom-theme` | an L0 theme: tokens only, no build step, no package |
| `examples/federation` | three services, one reference over all of them |
| `examples/events` | message channels discovered from handlers, rendered as AsyncAPI |
| `examples/static-build` | the static build, and the proxy configuration per hosting platform |
| `examples/nuxt-reference` | the Nuxt module, for a site that is not a NestJS application |

```bash
pnpm demo             # examples/nest-minimal, on http://127.0.0.1:3000/docs
pnpm demo:federation  # examples/federation
```

Each directory has a README saying what to open and what to look at.

## This site

The site you are reading is built by the product it documents. There is no second renderer:

```bash
pnpm docs:build
```

runs `openref build` on a document whose operations are the routes `OpenRefModule.setup` mounts
and whose description is the guide above. The addresses in the navigation are reconciled in both
directions against the route table the module really registers, so a route that appears in the
product and not here is a failing test rather than an out of date page.

<!-- gen: count:list -->Two<!-- /gen --> things it cannot do, said plainly rather than worked around:

- **The guide has no in-page anchors.** Headings inside a description carry no `id`, because
  heading ids are generated from heading text and that would make the same document render
  differently depending on its prose. So this page is scrolled, not linked into.
- **The guide is one page.** The product renders operations, channels and schemas, each with its
  own address. It has no page kind for prose, and inventing one for this site would have been a
  change to a frozen contract made for the convenience of the documentation rather than for a
  reader of the product.

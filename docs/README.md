# The documentation

`guide/` holds the chapters, in reading order. The first minute comes first, the migration note
second, and everything about packages, the model, federation and theme levels comes after both.

```bash
pnpm docs:build
```

builds the site into `docs/dist/`. That command composes one OpenAPI document whose description
is every chapter joined in filename order and whose paths are the routes
`OpenRefModule.setup` mounts, then runs the shipped `openref build` binary over it. There is no
second renderer: the site is the product rendering itself.

## What holds it to the product

| Suite | What it checks |
| --- | --- |
| `tools/docs-site/test/unit/guide.spec.ts` | the guide opens with the install and the one line, before any architecture word |
| `tools/docs-site/test/unit/route-table.spec.ts` | the documented routes are exactly the routes the module registers, both directions |
| `tools/docs-site/test/integration/documentation-examples.spec.ts` | every TypeScript example type checks against the real packages |
| `tools/docs-site/test/integration/example-applications.spec.ts` | every example application boots and serves |
| `tools/browser-budget/test/integration/documentation-site.spec.ts` | the built site under a strict policy in a real browser: zero violations, zero external requests |

## What the product cannot do here, said rather than worked around

- **The guide is one page.** The renderer has page kinds for operations, channels and schemas,
  and none for prose. Adding a ninth for this site would be a change to a frozen contract made
  for the convenience of the documentation.
- **The guide has no in-page anchors.** Headings inside a description carry no `id`, on purpose:
  an id generated from heading text makes one document render differently depending on its
  prose. So the page is scrolled rather than linked into.
- **The `csp` gate cannot see this output.** It walks `packages/<name>/dist`, and the site is
  not there. The browser suite above is the answer, and it is stronger: the gate is a regular
  expression over text, and this site's own theme chapter quotes an inline style attribute in
  its prose.

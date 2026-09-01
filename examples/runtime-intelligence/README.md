# Runtime intelligence

A collector written by hand, and what a fact with provenance looks like on the page.

```bash
pnpm --filter @openref/example-runtime-intelligence start
```

Then open the address it prints, at `/docs`.

## What to look at

| Open | What it shows |
| --- | --- |
| `GET /inventory` | scopes at `derived`, read from a metadata key by `src/ability.collector.ts` |
| `POST /inventory/reserve` | the same field at `declared`, because `@ApiScopes` is a statement somebody wrote |
| `GET /inventory/{sku}` | a guarded route that declares nothing, reported as an absence rather than drawn as a blank |

The whole collector is `src/ability.collector.ts`, and it is the same bytes as the example in
`docs/guide/04-collectors.md`.

Every fact on those pages carries the level it was read at and the name of the collector that
produced it. `AbilityGuard` reaches the page as a class name and nothing more: what it decides is
code, and code is not readable as data at any confidence level.

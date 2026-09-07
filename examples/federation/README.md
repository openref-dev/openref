# Federation

Three services as one reference: one local document and two fetched over HTTP.

```bash
pnpm demo:federation
```

Two processes are started, and both addresses are printed. The gateway serves the federated
reference; the second process serves the two remotes the gateway fetches.

What it serves:

| Address | What it is |
| --- | --- |
| `/docs` | the federated reference, all three services in one navigation |
| `/docs/service/billing` | the card for the local service |
| `/docs/service/orders` | the card for a remote service |
| `/docs/service/payments` | the card for the other remote |
| `/docs/_federation` | the live snapshot of every remote's state, as JSON |
| `/billing-docs` | the billing service's own reference, unfederated |

The second process serves `/orders-docs` and `/payments-docs`, which is where the gateway reads
the two remote documents from.

## What to look at

Each service group in the rail links its card and carries a status dot from `/docs/_federation`.
One search covers all three. Stop this process and restart only the gateway to watch a remote
degrade: the snapshot names the state and the page keeps rendering the services it still has.

The try-it console needs one credential per service, and the three are printed with the addresses
when the demo starts.

## Why this file exists

Every address in the table above is fetched by
`tools/docs-site/test/integration/example-applications.spec.ts`, which until 2026-09-04 asked this
example for `/docs` and nothing else. An example whose subject is service cards and a live snapshot
proves neither by answering with an overview page, so the promise is written down here and the case
is held to it.

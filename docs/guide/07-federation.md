## Federation

One reference over several services, without any of them knowing about the others.

```ts
OpenRefModule.forRoot({
  federation: {
    id: 'platform',
    route: '/docs',
    remotes: [
      { id: 'orders', url: 'http://orders.internal/docs/openapi.json' },
      { id: 'billing', url: 'http://billing.internal/docs/openapi.json', prefix: '/billing' },
    ],
  },
});
```

The gateway fetches each service's own specification, merges them into one document, and serves
one reference with one search index and one navigation. A remote is `{ id, url, prefix? }` and
the url is `http` or `https` only. A document this same `forRoot` mounts itself joins the merge
through `services: [{ id }]`, naming a `documents` entry by id rather than fetching itself over
the network.

### Merging is lossless, and that is enforced rather than intended

Two services can both have a `User` schema, both have `POST /orders`, both have an
`operationId` called `create`. The merge renames rather than drops:

| `onConflict` | What happens |
| --- | --- |
| `namespace`, the default | every service's names move under its own prefix |
| `first-wins` | the lowest service id keeps the plain name, the rest move |
| `fail` | no document is produced at all |

`first-wins` wins the name, not the right to exist. A reference that quietly omitted an
endpoint a service really serves would be a lie about the API, and that is the one outcome the
merge will not produce. Losslessness is proved by inverting the merge: every merged node is put
back into its own service's names using nothing but the rename report, and compared with the
source by hash.

### Ordering does not matter

Services are processed in sorted id order and never in configured order. Six orderings of three
services produce one document hash and one report, byte for byte. A merge that read the
configured order could not give you that, and a reference whose output depends on the order of
a configuration array is a reference you cannot cache or diff.

### Deduplication is by what a schema points at, not by its body

`User` can be byte identical in two services while the `Address` it refers to is not. One hash
of the body would show every reader of the second service the first service's model under the
second service's name. So the signature is computed over the reference closure, refined round
by round until the number of distinct signatures stops growing, which terminates on cycles
rather than recursing forever.

### A service that is down does not take the reference down

Each remote has a status: `pending`, `stale`, `fresh`, `degraded` or `failed`. A fetch that
fails falls back to the last good copy from the cache, and the page says which services are
stale rather than pretending everything is fresh. In strict mode a failed remote is a `503`
with a readable body, and the cache never softens it.

`<route>/_federation` answers with the live snapshot, and the navigation's service dots read
from it.

### Runtime facts belong to local services only

A collector reads the application it runs inside. A specification fetched over HTTP from
another service carries no runtime pass and cannot acquire one, so a federated gateway reports
runtime facts for the services it hosts itself and reports their absence for the rest, rather
than showing a blank that reads as "this route needs no scopes".

`examples/federation` in the repository is a working two application demo. `pnpm demo:federation`
boots it.

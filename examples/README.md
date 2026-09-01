# The OPENREF examples

<!-- gen: count:table -->Seven<!-- /gen --> directories, each small enough to read in a sitting. Every one that listens is booted and
fetched by `tools/docs-site/test/integration/example-applications.spec.ts`, so an example that
stops working is a failing test rather than a surprise for whoever opens it next.

| Directory | Start it with | What it is for |
| --- | --- | --- |
| `nest-minimal` | `pnpm demo` | the first minute, and the application the README quotes |
| `runtime-intelligence` | `pnpm --filter @openref/example-runtime-intelligence start` | a collector written by hand, and provenance on the page |
| `custom-theme` | `pnpm --filter @openref/example-custom-theme start` | an L0 theme: six token values, no bundle |
| `events` | `pnpm --filter @openref/example-events start` | HTTP and message channels from one application |
| `federation` | `pnpm demo:federation` | three services as one reference |
| `static-build` | `pnpm --filter @openref/example-static-build start` | ten static builds, one per hosting target |
| `nuxt-reference` | see its own README | the Nuxt module |

The rest of this file is about `nest-minimal`, which is the one to open first.

## Run it

```bash
pnpm demo
```

From a clean clone. It installs, builds, starts, and prints the address. There is no second step
and no build order to get right.

Then open <http://127.0.0.1:3000/docs>.

## What to look at

The renderer is not the point. These <!-- gen: count:table -->seven<!-- /gen --> are, because each one is a place a reference either
works or quietly gives up:

| Open                     | What it shows                                                          |
| ------------------------ | ---------------------------------------------------------------------- |
| `Create an order`        | a `oneOf` with a discriminator: three payment shapes, each named        |
| `Read the category tree` | a schema that refers to itself, expanded on demand rather than forever  |
| `Read one order`         | four levels of nesting, order to customer to address to coordinates     |
| `List orders`            | nine query parameters and a header, with their serialization rules      |
| `Download the receipt`   | a response that is not JSON, rendered as the text it is                 |
| `List orders by page`    | a generic wrapper, `paginated(OrderDto)`, with no wrapper DTO written   |
| `Watch orders`           | an SSE route whose item type is declared, because nothing can infer it  |

`Create an order` also documents <!-- gen: count:demo-create-responses -->six<!-- /gen --> status codes, each with the body shape it
answers with.

## Try it

Open any operation and press Send. The request goes to this application, at the server the
document declares, with nothing to configure first. `Read one order` takes an order identifier:
`ord_1024` and `ord_1025` both exist.

## What the application knows, not just what the document says

This is the part a specification renderer cannot do, and it grows with M1 in this same
application rather than in a second demo.

| What                    | Where it comes from                                                    |
| ----------------------- | ---------------------------------------------------------------------- |
| the handler's source    | V8 and the source map, as a deep link to the line in this repository    |
| the guard on each route | `@UseGuards(ScopesGuard)`, read as a class name and never as logic      |
| the scopes it requires  | this application's own key on `List orders`, `@ApiScopes` on the paged route |
| the rate limit          | `@Throttle` on `List orders`, reported in milliseconds                  |
| the item type of a stream | `@ApiStream` on `Watch orders`, because reflection cannot recover it  |
| the errors it promises  | `@ApiErrors` on `Read one order` and `Create an order`, in their own group |
| the errors it can answer with anyway | the guard and the rate limit, in a second group nobody wrote |

Each fact is shown with where it came from and how sure it is. <!-- gen: count:demo-unscoped-handlers -->Four<!-- /gen --> of the operations are
guarded and declare no scopes, which is deliberate: that is a policy written in code that will
never be readable, and `doctor` reports it rather than letting it look like a route that needs no
scopes at all.

Error contracts come in three groups that are never one list: what the endpoint promises with
`@ApiErrors`, what follows from what is standing in front of it, and what the whole application can
answer with. `Read one order` promises a 404 and is observed to be able to answer 401 and 403;
`List orders` promises nothing and is observed to be able to answer 429. A reference that merged
those into one list of status codes could not tell you which is which, and that difference is the
product.

The drift report between the specification and the running code arrives in the rest of M1.

## The one line

```ts
OpenRefModule.setup('/docs', app, { document });
```

It takes the OpenAPI document any NestJS application already builds with `@nestjs/swagger`, and
mounts, under `/docs`:

| Path                  | What it answers                                 |
| --------------------- | ----------------------------------------------- |
| `/docs`               | the reference, server rendered                  |
| `/docs/:nodeId`       | one operation                                   |
| `/docs/schema/:id`    | one named schema                                |
| `/docs/openapi.json`  | the specification, canonical key order          |
| `/docs/openapi.yaml`  | the same document as YAML                       |
| `/docs/_assets/:file` | the client bundle, the theme and its fonts      |
| `/docs/_search-index` | the serialized search index                     |
| `/docs/health`        | what is mounted here and what it was built from |

No CDN, no telemetry, no outgoing request of any kind. Every asset is served by this
application, under a name carrying the digest of its bytes.

## Both adapters

```bash
node examples/nest-minimal/dist/serve.js --adapter=fastify --port=3000
```

Express and Fastify are both first class, per SPEC 23. The demo boots on either.

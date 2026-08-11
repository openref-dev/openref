# The OPENREF demo

A real NestJS application with its reference mounted on it. One controller, one line of setup,
and a page you can send requests from.

## Run it

```bash
pnpm demo
```

From a clean clone. It installs, builds, starts, and prints the address. There is no second step
and no build order to get right.

Then open <http://127.0.0.1:3000/docs>.

## What to look at

The renderer is not the point. These five are, because each one is a place a reference either
works or quietly gives up:

| Open                     | What it shows                                                          |
| ------------------------ | ---------------------------------------------------------------------- |
| `Create an order`        | a `oneOf` with a discriminator: three payment shapes, each named        |
| `Read the category tree` | a schema that refers to itself, expanded on demand rather than forever  |
| `Read one order`         | four levels of nesting, order to customer to address to coordinates     |
| `List orders`            | nine query parameters and a header, with their serialization rules      |
| `Download the receipt`   | a response that is not JSON, rendered as the text it is                 |

`Create an order` also documents six status codes, each with the body shape it answers with.

## Try it

Open any operation and press Send. The request goes to this application, at the server the
document declares, with nothing to configure first. `Read one order` takes an order identifier:
`ord_1024` and `ord_1025` both exist.

## What it does not show yet

The four pillars of this project are not in this demo, because the code behind them is M1 and
later. What is here is a well rendered specification, which several tools already do.

Guards and the scopes they require, request limits, error contracts read from the application,
the link to the handler's source, drift between the specification and the running code: all of
that arrives in M1, in this same application. There will not be a second demo.

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

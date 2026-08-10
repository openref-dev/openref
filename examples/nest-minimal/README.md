# nest-minimal

The whole of SPEC 2's first minute, as code that runs.

```bash
pnpm build
pnpm --filter @openref/example-nest-minimal start
```

Then open http://127.0.0.1:3000/docs

## What it is

One controller, one module, and the OpenAPI document any NestJS application already builds
with `@nestjs/swagger`. The reference costs one line:

```ts
OpenRefModule.setup('/docs', app, { document });
```

That mounts, at `/docs`:

| Path                    | What it answers                                      |
| ----------------------- | ---------------------------------------------------- |
| `/docs`                 | the reference, server rendered                       |
| `/docs/:nodeId`         | one operation                                        |
| `/docs/schema/:id`      | one named schema                                     |
| `/docs/openapi.json`    | the specification, canonical key order               |
| `/docs/openapi.yaml`    | the same document as YAML                            |
| `/docs/_assets/:file`   | the client bundle, the theme and its fonts           |
| `/docs/_search-index`   | the serialized search index                          |
| `/docs/health`          | what is mounted here and what it was built from      |

No CDN, no telemetry, no outgoing request of any kind. Every asset is served from this
application, under a name carrying the digest of its bytes.

## Both adapters

```bash
node dist/serve.js --adapter=fastify --port=3000
```

Express and Fastify are both first class, per SPEC 23. The example boots on either.

## Try it

Open an operation and use the console on the right. The request goes to this application, at
the server url the document declares. That is the part that needs `@openref/nest` rather than
the renderer alone: the renderer may not see the request runner, so the browser bundle that
binds the two is built by this package.

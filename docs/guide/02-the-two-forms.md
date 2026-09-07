## Install

```bash
npm i @openref/nest
```

That is the only package most applications install. The renderer, the request console and the
search index are bundled inside it. <!-- gen: count:table -->Five<!-- /gen --> more packages exist and you install them only when you
need what they hold:

| Package | Install it when |
| --- | --- |
| `@openref/theme` | you want the default theme's stylesheet on a static build |
| `@openref/theme-telltale` | you want the second reference theme instead of the default |
| `@openref/vue` | you are writing your own theme |
| `@openref/core` | you are building your own tool on the normalized model |
| `openref` | you want the command line: `build`, `diff`, `doctor`, `lint`, `preview` |

## The minimal form

```ts
OpenRefModule.setup('/docs', app, { document });
```

One route, one document, defaults for everything else. This is the form in the first section
and it is the form most applications keep.

## The full form

Everything is optional and every default is stated:

```ts
OpenRefModule.forRoot({
  documents: [
    { id: 'public', route: '/docs', document, proxy: { enabled: true, timeoutMs: 30_000 } },
    { id: 'events', route: '/docs/events', kind: 'events' },
    { id: 'admin', route: '/docs/admin', document, guard: AdminDocsGuard, visibility: 'internal' },
  ],
  theme: { definition, bundle },
  runtime: {
    collectors: [],
    sourceLink: 'https://github.com/org/repo/blob/{ref}/{file}#L{line}',
    guardSecuritySchemes: { JwtAuthGuard: 'bearer' },
    health: true,
  },
  agent: { llmsTxt: true, mcp: false },
});
```

`forRootAsync({ useFactory, inject })` exists and takes the same options.

A short list at the root, and no more. Anything that belongs to one mount rather than to all of
them lives on the entry: the proxy, the render cache, the bridge, the guard and the visibility
are per document, because two references mounted by one application are two different things to
publish. `theme` and `agent` are on both, as the default and as the override.

### Why there are two entry points rather than one

`SwaggerModule.createDocument(app, ...)` needs the application, so the document does not exist
until `NestFactory.create` has returned, which is strictly after any module's `imports` array
is read. A `forRoot` that demanded `documents` up front would be unusable for the flow your
application already has.

So the two add up rather than compete. `forRoot` contributes the container, which is the only
place `DiscoveryService` can be injected, and that is the only route to the controller classes
every runtime fact hangs off. `setup` then supplies the document and picks up the runtime pass
`forRoot` registered.

The ordinary shape is therefore both:

```ts
@Module({
  imports: [OpenRefModule.forRoot({ runtime: { collectors: [guardsCollector()] } })],
})
export class AppModule {}
```

```ts
const app = await NestFactory.create(AppModule);
const document = SwaggerModule.createDocument(app, config);
OpenRefModule.setup('/docs', app, { document });
```

### What is refused rather than ignored

Three names from the specification's own sketch of this form are not built: `runner`, `cache`
and `devWatch` at the root. Passing any of them throws at boot, naming the option and where its
capability actually lives, rather than being accepted and doing nothing. `documents[].include`,
which would build a document from a subset of modules, is the same story in the other direction:
it is printed in the specification because the drift rules reason about a document assembled
that way, and it is not implemented.

A documented option that silently does nothing is worse than an option that is not there, which
is why one of those two is a refusal you can see and the other is written down here.

## What mounting gives you

Every address below is registered by the single call above. Reader pages live on bare segments,
machine answers on segments beginning with an underscore, and one address never answers in two
ways depending on a request header:

| Address | What it answers |
| --- | --- |
| `<route>` | the reference, server rendered |
| `<route>/{nodeId}` | one operation or one channel |
| `<route>/schema/{schemaId}` | one named schema |
| `<route>/bench/{nodeId}` | the request console for one operation |
| `<route>/health` | the Documentation Health report as a page |
| `<route>/shapes/{schemaId}` | the shapes showcase for one schema |
| `<route>/states` | the states showcase |
| `<route>/service/{serviceId}` | one federated service card |
| `<route>/openapi.json`, `<route>/openapi.yaml` | the specification, canonical key order |
| `<route>/asyncapi.json`, `<route>/asyncapi.yaml` | the same for an events document |
| `<route>/_assets/*` | the client bundle, the theme and its fonts, digest named |
| `<route>/_search-index` | the serialized search index |
| `<route>/_navigation/{hash}` | the navigation payload for one document hash |
| `<route>/_proxy` | the same origin proxy the console sends through |
| `<route>/_bridge` | the broker bridge, when one is configured |
| `<route>/_oauth/callback` | the return address of an authorization server |
| `<route>/_health` | whether this mount is alive, whether it describes anything, and what it was built from |
| `<route>/_federation` | a live snapshot of remote states |
| `<route>/llms.txt`, `<route>/llms-full.txt` | the reference as text for a language model |
| `<route>/mcp` | a read only JSON-RPC endpoint, off by default |

A surface that is switched off answers by saying so and naming the option that switches it on,
rather than answering `404` as if it never existed. That difference is deliberate: "turned off"
and "not a thing" are different facts and a reader acts on them differently.

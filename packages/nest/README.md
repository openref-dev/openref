# @openref/nest

The package a consumer installs. It mounts an API reference on a running NestJS application, serves
every route of it from that application, and reads what the application knows about its own handlers.
The specification describes how the API looks; the running application knows how it behaves; this is
the package that joins the two.

## Install

```sh
npm i @openref/nest
```

`@nestjs/common` and `@nestjs/core` are peer dependencies, `^10.0.0 || ^11.0.0`, and a NestJS
application already has them. Nothing else is needed: the renderer, the default theme, the request
runner and the search index are bundled in.

## Use

```ts
import { OpenRefModule } from '@openref/nest';

OpenRefModule.setup('/docs', app, { document });
```

`document` is the object `@nestjs/swagger` already builds. `setup` is synchronous on purpose, because
routes have to exist before `app.listen()` and a promise a host forgets to await registers them after
the first requests arrive; everything expensive is built on first use behind the service instead. The
routes go onto the http adapter directly rather than onto a controller, which is how a documentation
route avoids sitting behind whatever guards and interceptors the application applies globally.

## What the line above already gives you

With nothing but a route, an application and a document: the reference pages, the served
specification in JSON and YAML, the search index, the Documentation Health page, the try-it console
in direct mode, `llms.txt` and `llms-full.txt`, and the default theme. Visibility is `public`, no
guard runs, the same origin proxy answers 403, MCP answers 403, and no runtime fact is collected,
because collecting one needs the container and `setup` is not a module. Each addition below buys one
named thing: `forRoot` with collectors puts observed facts beside the declared ones and turns the
drift rules from silence into a comparison, `proxy.enabled` moves the console off the browser's CORS
rules, `guard` with a non public `visibility` closes the reference, and `agent.mcp` opens the MCP
endpoint and refuses to boot without a guard.

## The two entry points, and why there are two

`setup` takes a route, an application and a document, and carries no runtime options at all. That is
a consequence rather than a preference: everything the runtime pass reads needs the controller
classes, the only public route to them is `DiscoveryService`, and a service is injectable only into
something the container instantiates, which `setup` is not. So `forRoot` is the form that collects
facts, and nothing is registered unasked:

```ts
import { guardsCollector, OpenRefModule, scopesCollector, sourceCollector } from '@openref/nest';

OpenRefModule.forRoot({
  runtime: {
    collectors: [
      guardsCollector(),
      scopesCollector({ metadataKey: SCOPES_KEY }),
      sourceCollector(),
    ],
    sourceLink: 'https://github.com/org/repo/blob/{ref}/{file}#L{line}',
  },
});
```

A host that imports it gets those facts on whatever `setup` mounts afterwards, because `setup` asks
the container whether the pass is there. `forRootAsync({ imports, inject, useFactory })` is the same
options built by a factory, for a host whose configuration comes out of a provider.

## Configuration

### `setup(route, app, options)`

Only `document` is required. The same members are what an entry of `forRoot`'s `documents` carries,
plus an `id` and a `route`, so neither form can gain an option the other quietly lacks.

| Option         | Type                              | Default                        | What it changes                                                              |
| -------------- | --------------------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| `document`     | `unknown`                         | required                       | The OpenAPI or AsyncAPI document, as an object or as text                    |
| `theme`        | `OpenRefThemeOptions`             | `@openref/theme`               | The `definition` the server renders with, and the `bundle` built from it     |
| `stylesheets`  | `readonly string[]`               | the theme's `assets.css`       | Specifiers or absolute paths the page links                                  |
| `clientBundle` | `string`                          | this package's                 | Specifier or absolute path of the browser bundle                             |
| `assetPlan`    | `AssetPlan`                       | read from disk                 | Assets as bytes; supplied, `stylesheets` and `clientBundle` are ignored      |
| `cache`        | `IRenderCache`                    | the bounded in memory one      | Where rendered pages are kept                                                |
| `highlight`    | `boolean`                         | `true`                         | Server side syntax highlighting                                              |
| `lang`         | `string`                          | unset                          | The `lang` attribute on the rendered document                                |
| `colorScheme`  | `'light' \| 'dark'`               | the reader's system preference | Forces one scheme instead of following `prefers-color-scheme`                |
| `nonce`        | `NonceReader`                     | the two helmet conventions     | Where the CSP nonce for a response is found                                  |
| `onError`      | `ErrorReporter`                   | nothing                        | Where an unexpected failure inside a documentation route is reported         |
| `proxy`        | `ProxyOptions`                    | off                            | The same origin proxy; off, the route answers 403 rather than 404            |
| `agent`        | `AgentOptions`                    | `llms.txt` on, MCP off         | The two agent switches                                                       |
| `visibility`   | `'public'\|'partner'\|'internal'` | `'public'`                     | Who the reference is for; a non public value requires a guard                |
| `guard`        | `GuardLike \| GuardLike[]`        | none                           | Runs in front of every route of this mount; a list is a conjunction          |
| `bridge`       | `BridgeOptions`                   | off                            | The broker bridge; a `never` on the public arm, so it will not compile there |

`visibility` and `bridge` are one union rather than two independent fields: the public arm types
`bridge` as `never`, so a bridge under public visibility is a compile error and not a review comment.
An empty `guard` list is refused, because it reads as guarded and is not.

`proxy` takes `enabled` (off by default), `forwardCookies` (off), `timeoutMs`, `maxResponseBytes`,
`log`, and the `resolver` and `outbound` injection points. `DEFAULT_PROXY_TIMEOUT_MS` and
`DEFAULT_PROXY_MAX_RESPONSE_BYTES` are exported so a host can read what it is overriding.

### `forRoot(options)`

| Option       | Type                                | Default | What it changes                                          |
| ------------ | ----------------------------------- | ------- | -------------------------------------------------------- |
| `documents`  | `readonly OpenRefDocumentOptions[]` | none    | Documents mounted at bootstrap, for a host that has them |
| `runtime`    | `OpenRefRuntimeOptions`             | none    | The runtime intelligence pass; see below                 |
| `theme`      | `OpenRefThemeOptions`               | none    | The theme every mount defaults to, overridable per entry |
| `agent`      | `AgentOptions`                      | none    | The agent surface every mount defaults to, same relation |
| `federation` | `OpenRefFederationOptions`          | none    | A merged reference mounted beside the documents          |

An entry of `documents` is the `setup` options plus `id` and `route`. An entry written
`{ kind: 'events', id, route }` carries no `document` at all: its channels are read out of the
container from `@MessagePattern`, `@EventPattern`, `@WebSocketGateway` and `@ApiChannel`, and it
takes `title`, `version`, `description`, `servers` and `schemas` instead.

`runner`, `cache` and `devWatch` at the root are refused by name at boot rather than accepted and
ignored, because an option a host writes and that does nothing is worse than one that is missing.

### `runtime`

| Option                 | Type                               | Default | What it changes                                                                                     |
| ---------------------- | ---------------------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `collectors`           | `readonly CollectorRegistration[]` | none    | Which facts are read, in the order they contribute                                                  |
| `sourceLink`           | `string \| OpenRefSourceLink`      | none    | The deep link template: `{ref}`, `{file}`, `{line}`, `{absolutePath}`, `{column}`                   |
| `guardSecuritySchemes` | `Record<string, string>`           | none    | Which security scheme each guard class stands for; without it `security-drift` reports only silence |
| `publicRouteKey`       | `string \| symbol`                 | none    | The metadata key your global guard reads to exempt a route; a marked route answers clean            |
| `suppress`             | `readonly HealthSuppression[]`     | none    | Finding classes this application decided not to fix, each with a reason                             |
| `health`               | `boolean`                          | `true`  | Whether the health route answers                                                                    |

None of these is guessed when it is absent. `guardSecuritySchemes` has no default because
`JwtAuthGuard` is a class name and not a scheme name, and `publicRouteKey` has no candidate list
because a candidate list is the same guess with a longer spelling and it fails by finding somebody
else's key.

`sourceLink` as a string reads the revision from git; the object form `{ template, ref }` is for a
build with no `.git` in the tree. The editor form, `vscode://file/{absolutePath}:{line}:{column}`,
additionally needs `sourceCollector({ absolutePath: true })`, off by default because an absolute path
is a fact about the machine that built the reference rather than about the API.

`suppress` acts on a whole class across the entire document; node level suppression is not
implemented in this version. Three things refuse at boot: an unknown rule id, a missing or empty
reason, and one rule named twice. A class that matches nothing boots and is reported with
`matched: 0`, and while any suppressed class is severity `error` the reference leads with the
unsuppressed percentage.

```ts
runtime: {
  publicRouteKey: IS_PUBLIC_KEY,
  guardSecuritySchemes: { JwtAuthGuard: 'bearerAuth' },
  suppress: [{ rule: 'missing-example', reason: 'examples live in the client SDK repository' }],
}
```

### `agent`

Two booleans, on both entry points. `llmsTxt` defaults to `true` and governs `llms.txt` and
`llms-full.txt` together, because the index names addresses the full text carries; `mcp` defaults to
`false`. A mount that sets `agent: { mcp: true }` and supplies no guard does not boot, and the
refusal names both halves. It is a boot check rather than a type because a `public` reference may
legitimately carry a guard, so the combination cannot be written out of the type without forbidding a
deployment the guard rule allows.

## The routes it mounts

For a mount at `/docs`. Every one exists on every mount, including the ones for a feature that is
off, so that "off" is something a request can be told apart from "no such address".

Pages, all `GET`: the overview at `/docs` and at `/docs/`, one node at `/docs/:nodeId`, one schema at
`/docs/schema/:schemaId`, the Documentation Health page at `/docs/health`, the console on its own
address at `/docs/bench/:nodeId`, the federated service card at `/docs/service/:serviceId`, and the
`/docs/shapes/:schemaId` and `/docs/states` showcases. Documents, also `GET`: `/docs/openapi.json`
and `.yaml`, `/docs/asyncapi.json` and `.yaml`, which answer a 404 with words on a mount describing
no events, and `/docs/_assets/:asset` for the hashed assets.

Machine endpoints: `GET /docs/_search-index`, `GET /docs/_navigation/:documentHash`,
`GET /docs/_health` for liveness, `GET /docs/_federation` for the live snapshot,
`GET /docs/_oauth/callback`, `GET /docs/llms.txt` and `/docs/llms-full.txt`, `GET /docs/_bridge`, and
`POST` and `GET` on both `/docs/_proxy` and `/docs/mcp`. The `GET` on the last two exists so that
opening the address in a browser says what the endpoint takes rather than falling through to the node
page and being told no operation of that name is documented.

Registration order is part of the table, because Express matches in that order and the node page is a
bare parameter that would otherwise swallow every static route after it. `referenceRoutes(basePath)`
returns the whole thing as data, and `normalizeRoute` turns the route a host wrote into the
`basePath` it is built from.

## Collectors

A collector is registered by hand, in `runtime.collectors`, and each is a factory. These need no
third party package:

| Factory                                 | Confidence | What it reports                                                 |
| --------------------------------------- | ---------- | --------------------------------------------------------------- |
| `declarationsCollector()`               | `declared` | This package's own decorators, the only source that may say so  |
| `guardsCollector()`                     | `derived`  | Guard class names and the scope each was registered at          |
| `pipesCollector()`                      | `derived`  | Pipe class names, route, parameter and application scope        |
| `httpCodeCollector()`                   | `derived`  | The explicit `@HttpCode`, and only the explicit one             |
| `streamCollector()`                     | `declared` | What `@ApiStream` says a streaming endpoint streams             |
| `errorsCollector(options?)`             | `declared` | `@ApiErrors` resolved through `catalogs` and `global`           |
| `sourceCollector(options?)`             | `derived`  | Where a handler is written, for the deep link                   |
| `handlerScanCollector()`                | `inferred` | Which declared parameters the handler was seen to read          |
| `scopesCollector({ metadataKey })`      | `derived`  | Scopes under a key your own decorator writes                    |
| `rolesCollector({ metadataKey })`       | `derived`  | Roles, the same way                                             |
| `timeoutCollector({ metadataKey })`     | `derived`  | A timeout in milliseconds, the same way                         |
| `headersCollector({ metadataKey })`     | `derived`  | Required header names, the same way                             |
| `publicRouteCollector({ metadataKey })` | `derived`  | The exemption mark; built for you from `runtime.publicRouteKey` |

The five that take a `metadataKey` have no default for it, and the factory returns a
`SkippedCollector` rather than throwing when the key is unusable. `sourceCollector` also takes
`repositoryRoot`, for a tree copied without `.git`, and `absolutePath`. Eight more are published
separately against the same frozen contract: `@openref/collector-throttler`,
`@openref/collector-casl`, `@openref/collector-access-control`, and the five
`@openref/collector-redisx-*` packages.

## Every runtime fact carries where it came from

A collector returns an `IRNodeRuntime`, and each field of it that holds a value holds it in an
`IRFact` carrying a `confidence` and the `collector` name. There is no overload, no union and no cast
in the contract that admits a bare value. Three levels, and no others: `declared`, a decorator
somebody wrote; `derived`, metadata under a key the host named; `inferred`, a compile time reading
that is best effort and says so.

Nothing is guessed to fill a gap. A guard class is not turned into a security scheme name, the route
exemption key has no default and is never sniffed for, and an endpoint's error list is never derived
from an exception filter, because a filter says how to handle X rather than that this endpoint can
raise X. Where a fact cannot be had, the page says the comparison did not run and `doctor` reports it.

## Collectors fail open

A collector factory whose optional package is absent returns a `SkippedCollector` instead of throwing,
and the registry never calls it. Its name and the reason still reach `IRRuntimeMeta.skipped`, so the
absence reads as "throttler facts are missing because `@nestjs/throttler` is not installed" rather
than as an empty panel. The contract itself is two members, `name` and `collect`, and it is frozen
public API: third parties publish collectors against it, so changing it is a major version.

## Headers, errors, and what this module will not send

It writes no `Content-Security-Policy`. What it guarantees is that its own output is compatible with
a strict one: no inline style, no inline script, a nonce on what needs one, no CDN and no outgoing
request of any kind. `buildContentSecurityPolicy` is re-exported here so the host can build the
header it is the host's job to send. `DISTRIBUTION.md` beside this file covers the four ways the
client ships and which theme levels each DOM mode supports, including the light DOM web component,
which is a supported mode and not a workaround.

`OpenRefError`, `ErrorCode` and every class this package or its bundled internals can raise are
re-exported too: `ConfigError`, `InvalidOptionsError`, `NormalizeError`, `RunnerError`,
`ProxyBlockedError`, `FederationError`, `MergeConflictError` and `RemoteUnavailableError`. They are
`@openref/core`'s own constructors rather than bundled copies, so `instanceof` answers true and a
`catch` needs no second dependency.

## The decorators

Nine, and none of them adds a dependency. Six write metadata this package's own collectors read;
`@ApiAudience` and `@ApiExample` write `x-openref-audience` and `x-openref-examples` straight into
the object `@nestjs/swagger` builds its operation from, and `@ApiSample` writes `x-codeSamples`,
which is the one place this package uses somebody else's spelling on purpose, because that is what
Redoc and several generators already look for. Nothing here validates its argument against the
application, on purpose: the declaration and the observation are compared afterwards, by the drift
engine, and a decorator that refused a disagreement would delete the evidence.

```ts
@ApiScopes('orders:read', 'orders:write')
@ApiErrors(OrderNotFoundError, PaymentDeclinedError)
@ApiAudience('partner')
@ApiSample({ lang: 'bash', label: 'curl', source: 'curl https://api.example.com/orders' })
@ApiExample({ name: 'Success', request: { total: 10 }, response: { id: 'o_1' } })
@ApiPublishes('payment.created')
@Post('orders')
create() {}
```

An event handler carries `@ApiChannel({ protocol: 'amqp' })` and
`@ApiMessage({ payload: OrderCreatedDto })` in the same position, and a streaming one carries
`@ApiStream({ itemType: OrderDto, terminator: '[DONE]' })`.

| Decorator                  | Takes                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `@ApiScopes(...scopes)`    | Scope names as the authorization system spells them                                             |
| `@ApiErrors(...errors)`    | Error classes as the application defines them                                                   |
| `@ApiStream(options?)`     | `itemType`, `kind` (`sse` by default), `terminator`, `heartbeatMs`                              |
| `@ApiAudience(audience)`   | `'public'`, `'partner'` or `'internal'`; it marks and does not hide                             |
| `@ApiSample(sample)`       | `lang`, `source`, `label`; applied more than once, they accumulate                              |
| `@ApiExample(example)`     | `name`, `request`, `response`, `description`; they accumulate too                               |
| `@ApiChannel(channel)`     | `address`, `protocol`, `direction`, `title`, `summary`, `description`, `tags`                   |
| `@ApiMessage(message)`     | `payload`, `headers`, `name`, `title`, `summary`, `description`, `contentType`, `correlationId` |
| `@ApiPublishes(...events)` | Event names; this is the whole of the topology policy, nothing is inferred                      |

`@ApiChannel` overrides rather than replaces: a handler already carrying `@MessagePattern` keeps the
address the framework metadata gave it. A class handed to `@ApiMessage({ payload })` or
`@ApiStream({ itemType })` contributes its name and nothing else, because reflection cannot produce a
shape from a class reference; a name the document has no schema for reaches `doctor` rather than
being invented.

# @openref/collector-redisx-idempotency

Reads `@nestjs-redisx/idempotency` and reports the statuses an idempotent route can answer with. A
route that replays a stored response can refuse a repeated key, and a route that answers something
the document does not mention is exactly the drift this project exists to find, so the statuses go
into the route's runtime derived error contracts rather than into a shape of their own.

## Install

```sh
npm install @openref/collector-redisx-idempotency @openref/nest @nestjs-redisx/idempotency
```

`@openref/core` is a peer as well, for the types the facts are declared in. It arrives with
`@openref/nest`, so there is nothing extra to install for it. `@nestjs-redisx/idempotency` is an
optional peer: without it the factory declines rather than failing to load.

## Use

```ts
import { OpenRefModule } from '@openref/nest';
import { redisxIdempotencyCollector } from '@openref/collector-redisx-idempotency';

OpenRefModule.forRoot({
  runtime: {
    collectors: [redisxIdempotencyCollector()],
  },
});
```

The factory takes nothing a host passes. `RedisxIdempotencyCollectorOptions` has two members and both
are test seams:

| Option           | Type                  | Default                               |
| ---------------- | --------------------- | ------------------------------------- |
| `resolvePackage` | `() => boolean`       | resolves `@nestjs-redisx/idempotency` |
| `metadata`       | `MetadataValueReader` | the global `Reflect`                  |

`MetadataValueReader` is one member, `get(key, target)`. It is the same name and the same shape the
redisx collectors beside this one export, which is the contract holding rather than a collision.

## What it reads

`@Idempotent(options)` is
`applyDecorators(SetMetadata(IDEMPOTENT_OPTIONS, options), UseInterceptors(IdempotencyInterceptor))`,
so the key standing on a target is proof the behaviour is bound to the route. The key is reached as
`Symbol.for('IDEMPOTENT_OPTIONS')`, which yields the same symbol the library's own module yields
without loading it; the package is still resolved first, because a global symbol is available in any
process whether or not the library that names it is present.

The handler and the controller are two different questions here, which is not how the rate limit
collector beside this one works, and the asymmetry is the library's. The interceptor is bound by
whichever target carries the decorator, so either one activates the route; the options are read with
`reflector.get(IDEMPOTENT_OPTIONS, context.getHandler())`, so only the handler's are ever used.
Merging the two would report a ttl nobody applies. Note that the library types `@Idempotent` as a
`MethodDecorator`, so a controller class is not a target its types admit; `applyDecorators` writes the
key there anyway if an application puts it there, which is the case the finding below exists for.

`@Idempotent()` with no argument stores `{}` rather than `undefined`, so a decorated route and an
undecorated one are told apart by the presence of the key and never by its content.

The library's own merged plugin configuration is read once per pass, from the container, under
`Symbol.for('IDEMPOTENCY_PLUGIN_OPTIONS')`. Only `validateFingerprint` out of it changes what a route
reports, and even that decides a status rather than supplying a number.

## A worked example

```ts
// payments.controller.ts
import { Body, Controller, Post } from '@nestjs/common';
import { Idempotent } from '@nestjs-redisx/idempotency';

@Controller('payments')
export class PaymentsController {
  @Post()
  @Idempotent({ ttl: 3600, validateFingerprint: true })
  create(@Body() dto: CreatePaymentDto) {}
}
```

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { IdempotencyPlugin } from '@nestjs-redisx/idempotency';
import { OpenRefModule } from '@openref/nest';
import { redisxIdempotencyCollector } from '@openref/collector-redisx-idempotency';

@Module({
  controllers: [PaymentsController],
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [new IdempotencyPlugin({ defaultTtl: 86_400 })],
    }),
    OpenRefModule.forRoot({ runtime: { collectors: [redisxIdempotencyCollector()] } }),
  ],
})
export class AppModule {}
```

`POST /payments` then carries two error contracts it did not have before: a 409 for a key whose first
attempt is still running past the plugin's `waitTimeout` or whose first attempt failed, and a 422 for
a key reused with a different request. If the specification documents neither, the reference says so
on that operation rather than in a report on another page.

## What the reference page shows

Both statuses land in `IRErrorContracts.runtimeDerived`, which the Responses section draws under the
heading `Error contracts`, in the group `Derived from runtime`, with the subheading
`follows from facts collected about the route`. Each row is the status, its title, its detail and its
own provenance tag:

- 409, `The idempotency key is already in use`
- 422, `The idempotency key was reused for a different request`

A status among them that the specification does not document also appears as a row in the response
list with the note `not in the specification`, and the `error-undocumented` rule records it on the
`Response codes` row of the parity scale.

The provenance tag reads `DRV`, with the tooltip `derived, redisxIdempotencyCollector`. `derived` is
the level for a value read out of metadata under a key this project knows: the 409 follows from the
decorator having been applied, and the 422 from a `validateFingerprint` that was read from the
decorator or from the plugin. Neither is a guess about what the library might do.

## What it refuses to read

Each refusal below is a `problems()` record, and the registry drains those into `openref doctor`,
where one prints as `DRIFT  RT070  PaymentsController.create` with the action on an arrow line under
it. The reason and the detail are in `--json` only, and there the reason arrives prefixed with
`redisxIdempotencyCollector`.

- **A status the application cannot produce.** The library's `IdempotencyExceptionFilter` maps five
  errors to four statuses, and two of those errors are constructed nowhere in its source:
  `IdempotencyKeyRequiredError`, the 400, has no throw site because a request with no key is a plain
  passthrough, and `IdempotencyRecordNotFoundError`, one of the three 409 variants, is guarded by a
  comment in the filter saying it should be unreachable. Only the two reachable ones are reported,
  and nothing is recorded for the others because there is nothing about this route to say.
- **A status it did not read the condition for.** The library resolves fingerprint validation as the
  decorator option, then the plugin option, then `true`. Where nothing answers the plugin options
  token and the decorator states nothing, the 422 is left off rather than taken from that fallback,
  and the action is `declare validateFingerprint on @Idempotent to make the answer a fact about this route`.
- **Interceptor logic.** A `keyExtractor` decides what a request is keyed by and a `skip` decides
  whether the route is idempotent for this request at all. Both are functions under a key and are
  never read. Each is recorded, and each action says there is nothing to fix: the statuses shown hold
  either way, and the record is what says the key is not the header, or that the row does not cover
  every request.
- **Options the library will silently discard.** `@Idempotent({ ttl: 60 })` on a controller binds the
  interceptor to every route on it, and the interceptor then reads its options off the handler, so
  the ttl is dropped without a word. The record names the fields that are not applied and the action
  is `move the options onto the method, where the interceptor reads them`.
- **Options it has no field for.** `ttl`, `fingerprintFields` and `cacheHeaders` are read by nothing
  here. They configure what is stored and how the fingerprint is built, and neither changes which
  statuses a caller can receive, which is what this collector reports.

## When nothing appears

An undecorated route gets no contribution at all, and that is deliberate: a present but empty
`errors` record would claim the route was examined and declares nothing, and this collector cannot
tell a route without the decorator from one in an application that never installed the plugin. So the
`Response codes` cell says which of four situations you are in, and `openref doctor` is the rest:

1. **The collector is not registered.** The cell reads
   `No registered collector reports error contracts. Add errorsCollector or redisxRateLimitCollector or redisxIdempotencyCollector to the collectors option, or write one that does.`
   Nothing about it appears in `doctor`.
2. **`@nestjs-redisx/idempotency` is absent, or the runtime offers no metadata reflection.** The
   factory returns a skip and `doctor` prints it under `Collectors that did not run:`, one line, the
   collector name and the reason.
3. **The collector ran and this route has nothing.** The route carries no `@Idempotent`. The cell
   names a collector that reported error contracts somewhere and says it examined this route and
   found none.
4. **It read something and could not state it.** The route appears in the findings, with the action
   for whichever refusal above applied. The 422 in particular is absent for a readable reason rather
   than for none.

The summary line `Runtime collectors that reported a fact` counts a collector that produced nothing
anywhere, which is the ordinary shape of a plugin the application installed and never used.

## The contract

It implements `IRuntimeCollector`, the public collector contract of `@openref/nest`: a `name`, and
`collect(context)` returning what was read about one node, or `undefined`. `problems()` is read
structurally beside it, so the contract itself stays at two members. It is fail open: when the
library is not installed, or when the runtime offers no metadata reflection, the factory returns a
`SkippedCollector` naming what was missing rather than a collector, nothing runs, the reference
renders without the fact, and the name and the reason still reach `IRRuntimeMeta.skipped`. The
package is resolved and never loaded.

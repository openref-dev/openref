# @openref/collector-redisx-rate-limit

Reads `@nestjs-redisx/rate-limit` and reports the rate limit an endpoint actually enforces, the
`RateLimitGuard` its own decorator bound to the route, and the statuses a limited route can answer
with. A route without the decorator is not left blank either: it is reported as limited by something
unreadable, or as limited by nothing, which are two different answers.

## Install

```sh
npm install @openref/collector-redisx-rate-limit @openref/nest @nestjs-redisx/rate-limit
```

`@openref/core` is a peer as well, for the types the facts are declared in. It arrives with
`@openref/nest`, so there is nothing extra to install for it. `@nestjs-redisx/rate-limit` is an
optional peer: without it the factory declines rather than failing to load.

## Use

```ts
import { OpenRefModule } from '@openref/nest';
import { redisxRateLimitCollector } from '@openref/collector-redisx-rate-limit';

OpenRefModule.forRoot({
  runtime: {
    collectors: [redisxRateLimitCollector()],
  },
});
```

The factory takes nothing a host passes. `RedisxRateLimitCollectorOptions` has two members and both
are test seams:

| Option           | Type                  | Default                              |
| ---------------- | --------------------- | ------------------------------------ |
| `resolvePackage` | `() => boolean`       | resolves `@nestjs-redisx/rate-limit` |
| `metadata`       | `MetadataValueReader` | the global `Reflect`                 |

`MetadataValueReader` is one member, `get(key, target)`, because this collector asks for one key it
knows rather than enumerating a target. It is deliberately not the wider `MetadataReader` of
`@openref/collector-throttler`: the narrower reader takes the narrower name so two published packages
never export one name with two shapes.

## What it reads

`@RateLimit(options)` is `applyDecorators(SetMetadata(RATE_LIMIT_OPTIONS, options), UseGuards(RateLimitGuard))`,
so the key standing on a target is proof the guard stands in front of the route. The key is reached
as `Symbol.for('RATE_LIMIT_OPTIONS')`, which yields the same symbol the library's own module yields
without loading it; the package is still resolved first, because a global symbol is available in any
process and a generic name is one a second library could claim.

The branch is decided by the presence of the key and not by what is under it. `RateLimit(options = {})`
defaults its parameter before calling `SetMetadata`, so `@RateLimit()` with no argument stores `{}`,
and a check that asked for content would call that route undecorated and report that nothing limits
it. The controller's options and the handler's are then merged field by field, because the library's
guard reads both and spreads `{ ...classOptions, ...handlerOptions }`, so a route naming only `points`
inherits the class's `duration`.

`points` and `duration` become an `IRRateLimit`, with `duration` converted from the seconds it is
written in; a string `key` becomes the bucket name. Because the value is read at runtime, a `points`
computed at startup is reported as the integer the application is enforcing rather than as the call
that produced it.

The module's own merged configuration is read once per pass, from the container, under
`Symbol.for('RATE_LIMIT_PLUGIN_OPTIONS')`. Two things come out of it and they fail separately:
`defaultPoints` with `defaultDuration`, which never becomes a route's own limit, and `errorPolicy`,
which decides whether a store failure is a status this route can answer with.

## A worked example

```ts
// auth.controller.ts
import { Body, Controller, Post } from '@nestjs/common';
import { RateLimit } from '@nestjs-redisx/rate-limit';

@Controller('auth')
export class AuthController {
  @Post('login')
  @RateLimit({ key: 'login', points: 5, duration: 300, store: 'redis' })
  login(@Body() dto: LoginDto) {}
}
```

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { RateLimitPlugin } from '@nestjs-redisx/rate-limit';
import { OpenRefModule } from '@openref/nest';
import { redisxRateLimitCollector } from '@openref/collector-redisx-rate-limit';

@Module({
  controllers: [AuthController],
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [
        new RateLimitPlugin({
          defaultPoints: 100,
          defaultDuration: 60,
          errorPolicy: 'fail-closed',
        }),
      ],
    }),
    OpenRefModule.forRoot({ runtime: { collectors: [redisxRateLimitCollector()] } }),
  ],
})
export class AppModule {}
```

`POST /auth/login` then shows a rate limit of `5 / 300 s (login)`, `RateLimitGuard` on the route, and
two error contracts, 429 and 503, the second because the module declared `errorPolicy: 'fail-closed'`.
Every other route of the application shows that it declares no limit of its own, together with the
module's configured budget and the statement that whether it reaches this route is decided in code
that is never read.

## What the reference page shows

`rateLimit` is an `IRFact<IRRateLimit>`, so it lands on the `Rate limit` row: the parity scale of the
default theme, and the `Rate limit` row of the runtime block a theme like telltale draws. The text is
`limit / window`, with `60000` milliseconds written as `minute` and anything without a round name as
seconds, and the bucket key in parentheses after it. The `ratelimit-undocumented` rule compares the
row against the document.

`RateLimitGuard` lands on the `Authentication` row and on the `Guards` row, at `route` scope, with a
`purpose` of `rate-limit` that is carried in the model and drawn nowhere: it exists so
`security-drift` does not read a limiter on a deliberately public route as an undocumented
authorisation decision.

The 429 and the 503 land in `IRErrorContracts.runtimeDerived`, which the Responses section draws
under the heading `Error contracts`, in the group `Derived from runtime`, with the subheading
`follows from facts collected about the route`. Each carries its own title, its detail and its own
provenance tag. A status among them that the specification does not document also appears as a row in
the response list with the note `not in the specification`, and the `error-undocumented` rule records
it on the `Response codes` row.

Every value carries a provenance tag, `DRV` here, whose tooltip reads
`derived, redisxRateLimitCollector`. `derived` is the level for a value read out of metadata under a
key this project knows, the contracts included: they follow from the decorator having been applied
and from a configuration that was read, not from a guess about the library.

## What it refuses to read

Each refusal below is a `problems()` record, and the registry drains those into `openref doctor`,
where one prints as `DRIFT  RT070  AuthController.login` with the action on an arrow line under it.
The reason and the detail are in `--json` only, and there the reason arrives prefixed with
`redisxRateLimitCollector`. Two of the records carry the subject `the application` instead of a
route, because what they say is about the module and is said once per pass.

- **Guard logic.** Whether a globally registered guard limits a given route, and at what budget, is
  written in that guard's own code and is never read. The record on such a route says so, and names
  what stands in front of it.
- **A module wide number as a route's own.** The configured default is read, recorded once against
  `the application` with an action showing the `@RateLimit` that would make it a fact about a route,
  and carried onto a route only as a separately labelled budget on the unreadable case, never as the
  limit the route enforces.
- **A half declared budget.** `points` without `duration`, or the reverse, produces no limit, because
  the rest is completed per request from the module provider. The action is
  `name both points and duration on the decorator`. The statuses still stand: a route whose budget is
  half declared still refuses a request that goes over whatever the module completes it with.
- **A window under an algorithm that has none.** Under `token-bucket`, `points` is a bucket capacity
  and the sustained rate is a refill per second, so no field of the model means it and nothing is
  reported. The action says there is nothing to do unless the route can use a windowed algorithm.
- **A status it cannot tie to something it read.** Where no readable `errorPolicy` stands under the
  plugin token, the 503 is left off rather than taken from the library's own `?? 'fail-closed'`
  fallback, and the record says the token answered nothing. Under `fail-open` the record explains
  that a store failure lets the request through, so 503 is not an answer at all; under `fail-closed`
  nothing is recorded, because the status is already in the contracts.
- **Functions under a key.** A `key` function decides which bucket a request is counted in and a
  `skip` function decides whether it is counted at all. Both are recorded, and a `key` function also
  means the limit is reported with no bucket name rather than with a wrong one.
- **Options it has no field for.** `refillRate`, `message` and `errorFactory` are read by nothing
  here. A `store: 'memory'` route is reported with its number and a record saying the deployment
  allows that number times the instance count, which is runtime state.

## When nothing appears

A route without the decorator reports a reach instead of nothing: `Not rate limited` where no global
guard is registered, and `No limit of its own; governed from outside by <names>` where one is, with a
note carrying the module budget and where it was read. Where even that is missing, the `Rate limit`
cell says which of four situations you are in, and `openref doctor` is the second half of the answer:

1. **The collector is not registered.** The cell reads
   `No registered collector reports rate limits. Add throttlerCollector or redisxRateLimitCollector to the collectors option, or write one that does.`
   Nothing about it appears in `doctor`.
2. **`@nestjs-redisx/rate-limit` is absent, or the runtime offers no metadata reflection.** The
   factory returns a skip and `doctor` prints it under `Collectors that did not run:`, one line, the
   collector name and the reason.
3. **The collector ran and this route has nothing.** The cell names the collector and says it
   examined the route and reported no rate limit for it.
4. **It read something and could not state it.** The route appears in the findings, with the action
   for whichever refusal above applied.

## The contract

It implements `IRuntimeCollector`, the public collector contract of `@openref/nest`: a `name`, and
`collect(context)` returning what was read about one node, or `undefined`. `problems()` is read
structurally beside it, so the contract itself stays at two members. It is fail open: when the
library is not installed, or when the runtime offers no metadata reflection, the factory returns a
`SkippedCollector` naming what was missing rather than a collector, nothing runs, the reference
renders without the fact, and the name and the reason still reach `IRRuntimeMeta.skipped`. The
package is resolved and never loaded.

# @openref/collector-throttler

Reads `@nestjs/throttler` and reports the rate limit an endpoint actually enforces, so the reference
carries the number the running application holds to rather than one nobody wrote down. It also names
`ThrottlerGuard` where that guard was observed standing in front of a route, and says which of two
states a route that declares no throttler of its own is in.

## Install

```sh
npm install @openref/collector-throttler @openref/nest @nestjs/throttler
```

`@openref/core` is a peer as well, for the types the facts are declared in. It arrives with
`@openref/nest`, so there is nothing extra to install for it. `@nestjs/throttler` is an optional
peer: without it the factory declines rather than failing to load.

## Use

```ts
import { OpenRefModule } from '@openref/nest';
import { throttlerCollector } from '@openref/collector-throttler';

OpenRefModule.forRoot({
  runtime: {
    collectors: [throttlerCollector()],
  },
});
```

The factory takes nothing a host passes. `ThrottlerCollectorOptions` has two members and both are
test seams:

| Option           | Type                        | Default                                     |
| ---------------- | --------------------------- | ------------------------------------------- |
| `resolveVersion` | `() => string \| undefined` | reads `@nestjs/throttler/package.json`      |
| `metadata`       | `MetadataReader`            | the global `Reflect`, when it carries a map |

`MetadataReader` is `keys(target)` plus `get(key, target)`, because this collector enumerates the
keys on a target rather than asking for one it knows. Both members exist because the two behaviours
worth pinning, the seconds to milliseconds conversion and the refusal on a version it cannot read,
cannot both be reached with one copy of one package installed. A host that passes either replaces a
reading of its own process with something a test wrote.

## What it reads

`@nestjs/throttler` concatenates the throttler's name into its own metadata key, so there is no fixed
key to ask for. The keys present on the target are enumerated instead, which finds every named
throttler and invents none. `@Throttle({ default: { limit, ttl } })` writes `THROTTLER:LIMITdefault`
and `THROTTLER:TTLdefault`; `@SkipThrottle()` writes `THROTTLER:SKIPdefault` set to `true`, and
`@SkipThrottle({ short: false })` writes `false`, which un-skips, so the value is read and not only
the key. The controller is read before the handler so the handler wins for a throttler of the same
name, which is what NestJS enforces.

The installed version is read too, because `ttl` was seconds before throttler 5.0 and is milliseconds
from 5.0, and `IRRateLimit.ttlMs` is milliseconds. A number whose unit cannot be established is not a
fact, so a copy whose version is unreadable produces no rate limit at all rather than one wrong by a
factor of a thousand. The manifest is read and the package is never loaded.

## A worked example

```ts
// orders.controller.ts
import { Controller, Get, Post } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';

@Controller('orders')
@Throttle({ default: { limit: 100, ttl: 60_000 } })
export class OrdersController {
  @Get() list() {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  place() {}

  @Get('health')
  @SkipThrottle()
  health() {}
}
```

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { OpenRefModule } from '@openref/nest';
import { throttlerCollector } from '@openref/collector-throttler';

@Module({
  controllers: [OrdersController],
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    OpenRefModule.forRoot({ runtime: { collectors: [throttlerCollector()] } }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
```

`POST /orders` then shows a rate limit of `5 / minute (default)`, the handler's declaration having
replaced the controller's. `GET /orders` shows `100 / minute (default)`, inherited from the class.
`GET /orders/health` shows no limit at all, because a route that opted out has none to report, and it
still shows `ThrottlerGuard` as standing in front of it.

## What the reference page shows

`rateLimit` is an `IRFact<IRRateLimit>`, so it lands on the `Rate limit` row: the parity scale of the
default theme, and the `Rate limit` row of the runtime block a theme like telltale draws. The text is
`limit / window`, with `1000`, `60000`, `3600000` and `86400000` milliseconds written as `second`,
`minute`, `hour` and `day` and anything else as seconds, and the throttler's own name in parentheses
after it. The row is compared against the document by the `ratelimit-undocumented` rule, which asks
whether a limited operation documents a 429.

`ThrottlerGuard` lands on the `Authentication` row of the scale, and on the `Guards` and
`Guards, global` rows of the runtime block, once per scope it was seen at. Its `purpose` of
`rate-limit` is carried in the model and drawn nowhere: it exists so `security-drift` does not read a
limiter on a route as an undocumented authorisation decision.

Every value carries a provenance tag beside it, `DRV` here, whose tooltip reads
`derived, throttlerCollector`. `derived` is the level for metadata under a key that is known rather
than guessed, which is what every one of these readings is.

## What it refuses to read

Each refusal below is a `problems()` record, and the registry drains those into `openref doctor`,
where one prints as `DRIFT  RT070  OrdersController.list` with the action on an arrow line under it.
The reason and the detail are in `--json` only, and there the reason arrives prefixed with
`throttlerCollector`. The findings are also counted as `Subjects the discovery could state`.

- **Guard logic.** Which request is counted against which throttler is decided inside
  `ThrottlerGuard`, and that code is never read. Where several complete throttlers apply to one
  route, the reference carries the first and the action says which name it shows, so the page is
  never silently claiming to be the whole policy.
- **Half a throttler.** A `limit` with no `ttl`, or a `ttl` with no `limit`, produces no rate limit;
  the action is `name both limit and ttl on the throttler`. A `Resolvable` half, that is, a function
  of the execution context rather than a number, is read as absent: with one half a number the
  finding above fires, and with both halves functions the throttler yields nothing and no finding.
- **A guard it did not observe.** `@Throttle` writes metadata and applies nothing, so `ThrottlerGuard`
  is named only where it was seen, on the route or in the global registrations, and at both scopes
  when it stands at both.
- **A module default.** `ThrottlerModule.forRoot` holds the application wide budget behind a token
  this package has measured no reachable reading of, so no budget travels from it onto a route and
  the reach fact carries none.
- **Options it has no field for.** `blockDuration`, `getTracker` and `generateKey` are read by
  nothing here: the first is a duration the model has no member for, and the other two are functions
  under a key.

## When nothing appears

A route that wrote no throttler key at all is not left blank. It reports a reach instead, which is
`Not rate limited` where nothing is registered globally, and
`No limit of its own; governed from outside by ThrottlerGuard` where something is, with a note saying
that whether that guard limits this route is decided in code that is never read. Those are two
different answers and used to be one silence.

Where even that is missing, the `Rate limit` cell says which of four situations you are in, and
`openref doctor` is the second half of the same answer:

1. **The collector is not registered.** The cell reads
   `No registered collector reports rate limits. Add throttlerCollector or redisxRateLimitCollector to the collectors option, or write one that does.`
   Nothing about it appears in `doctor`, because a collector nobody registered is not an instrument
   that failed.
2. **`@nestjs/throttler` is absent, or its version cannot be read.** The factory returns a skip and
   `doctor` prints it under `Collectors that did not run:`, one line, the collector name and the
   reason.
3. **The collector ran and this route has nothing.** The cell names the collector and says it
   examined the route and reported no rate limit for it.
4. **It read something and could not state it.** The route appears in the findings, with the action
   for whichever refusal above applied.

The summary also carries `Runtime collectors that reported a fact`, and a collector that reported on
no node in the whole document is the ordinary shape of a package the application does not really use.

## The contract

It implements `IRuntimeCollector`, the public collector contract of `@openref/nest`: a `name`, and
`collect(context)` returning what was read about one node, or `undefined`. `problems()` is read
structurally beside it, so the contract itself stays at two members.

It is fail open. When `@nestjs/throttler` is not installed, when its version cannot be read, or when
the runtime offers no metadata reflection, the factory returns a `SkippedCollector` naming what was
missing rather than a collector. Nothing runs, the reference renders without the fact, and the name
and the reason still reach `IRRuntimeMeta.skipped`.

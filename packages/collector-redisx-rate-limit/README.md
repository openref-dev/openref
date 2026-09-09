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
`@openref/nest`, so there is nothing extra to install for it.

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

The factory takes no options.

## What it reads

`@RateLimit(options)` is `SetMetadata(RATE_LIMIT_OPTIONS, options)` plus
`UseGuards(RateLimitGuard)`, so the key standing on a target is proof the guard stands in front of
the route. The controller's options and the handler's are merged field by field, because that is
what the library's own guard enforces. `points` and `duration` become `IRRateLimit`, in
milliseconds; a string `key` becomes the bucket name. Because the value is read at runtime, a
`points` computed at startup is reported as the integer the application is enforcing rather than as
the call that produced it.

A decorated route answers 429 whenever the budget is spent, and answers 503 as well where the module
declares `errorPolicy: 'fail-closed'`, which is the only place that option can be read. Both go into
`IRErrorContracts.runtimeDerived`, the group the drift engine already compares against the document.

## The contract

It implements `IRuntimeCollector`, the public collector contract of `@openref/nest`: a `name`, and
`collect(context)` returning what was read about one node, or `undefined`.

It is fail open. When `@nestjs-redisx/rate-limit` is not installed, or when the runtime offers no
metadata reflection, the factory returns a skip naming what was missing rather than a collector.
Nothing runs and the reference renders without the fact. The package is resolved and never loaded.

Every fact it emits carries a confidence, `derived` here, and the collector name
`redisxRateLimitCollector`, so a reader can tell an observation of the application from a promise
somebody typed.

What it deliberately never claims:

- Guard logic. Whether a globally registered guard limits a given route, and at what budget, is
  written in that guard's own code and is never read.
- A module wide number as a route's own. The configured default is read, reported once as a
  statement about the application, and carried onto a route only as a separately labelled budget on
  the unreadable case, never as the limit the route enforces.
- A window under an algorithm that has none. A `token-bucket` route declares a capacity and a refill
  rate, which no field of the model means, so nothing is reported for it.
- A status it cannot tie to something it read. Where no readable `errorPolicy` stands under the
  plugin token, the 503 is left off rather than taken from the library's own fallback.

Each of those, and a `key` or `skip` given as a function, is recorded as a finding instead. They
come out of `problems()`, which the collector registry drains into `openref doctor`.

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
`@openref/nest`, so there is nothing extra to install for it.

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

The factory takes no options. It reads what `@Throttle` and `@SkipThrottle` wrote on the controller
and on the handler, and the handler wins for a throttler of the same name, which is what NestJS
enforces.

## What it reads

`@nestjs/throttler` concatenates the throttler's name into its own metadata key, so there is no
fixed key to ask for. The keys present on the target are enumerated instead, which finds every named
throttler and invents none. The installed version is read too, because `ttl` was seconds before
throttler 5.0 and is milliseconds from 5.0. A number whose unit cannot be established is not a fact,
so a copy whose version is unreadable produces no rate limit at all rather than one that is wrong by
a factor of a thousand.

## The contract

It implements `IRuntimeCollector`, the public collector contract of `@openref/nest`: a `name`, and
`collect(context)` returning what was read about one node, or `undefined`.

It is fail open. When `@nestjs/throttler` is not installed, when its version cannot be read, or when
the runtime offers no metadata reflection, the factory returns a skip naming what was missing rather
than a collector. Nothing runs and the reference renders without the fact.

Every fact it emits carries a confidence, `derived` here, and the collector name
`throttlerCollector`, so a reader can tell an observation of the application from a promise somebody
typed.

What it deliberately never claims:

- Guard logic. Which request is counted against which throttler is decided inside `ThrottlerGuard`,
  and that code is never read.
- A guard it did not observe. `@Throttle` writes metadata and applies nothing, so `ThrottlerGuard`
  is named only where it was seen, on the route or in the global registrations, and at both scopes
  when it stands at both.
- A module default. `ThrottlerModule.forRoot` holds the application wide budget behind a token this
  package has measured no reachable reading of, so no budget travels from it onto a route.

Where a fact cannot be obtained it records a finding instead of guessing: a throttler that declares
a limit and no ttl, or several complete throttlers on one route when the model carries one. Those
come out of `problems()`, which the collector registry drains into `openref doctor`.

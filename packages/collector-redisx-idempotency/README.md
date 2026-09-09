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
`@openref/nest`, so there is nothing extra to install for it.

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

The factory takes no options.

## What it reads

`@Idempotent(options)` is `SetMetadata(IDEMPOTENT_OPTIONS, options)` plus
`UseInterceptors(IdempotencyInterceptor)`, so the key standing on the handler or on the controller
is proof the behaviour is bound to the route. The decorator on either target activates it; its
options are read off the handler alone, because that is where the library's own interceptor reads
them.

Such a route always reports 409, for a key whose first attempt is still running past the plugin's
`waitTimeout` or whose first attempt failed. It reports 422 as well where the library compares
request fingerprints, resolved as the decorator option, then the plugin option. Both contracts land
in `IRErrorContracts.runtimeDerived`, the group the drift engine already compares against the
document.

## The contract

It implements `IRuntimeCollector`, the public collector contract of `@openref/nest`: a `name`, and
`collect(context)` returning what was read about one node, or `undefined`.

It is fail open. When `@nestjs-redisx/idempotency` is not installed, or when the runtime offers no
metadata reflection, the factory returns a skip naming what was missing rather than a collector.
Nothing runs and the reference renders without the fact. The package is resolved and never loaded.

Every fact it emits carries a confidence, `derived` here, and the collector name
`redisxIdempotencyCollector`, so a reader can tell an observation of the application from a promise
somebody typed.

What it deliberately never claims:

- A status the application cannot produce. The library's filter maps five errors to four statuses
  and two of those errors are constructed nowhere in its source, so only the two reachable ones are
  reported.
- A status it did not read the condition for. Where nothing answers the plugin options token, the
  422 is left off rather than assumed from the library's own fallback.
- Interceptor logic. A `keyExtractor` decides what a request is keyed by and a `skip` decides
  whether the route is idempotent for this request at all; both are functions under a key and are
  never read.

Each of those, and a `@Idempotent` on a controller whose options the library will silently discard,
is recorded as a finding instead. They come out of `problems()`, which the collector registry drains
into `openref doctor`.

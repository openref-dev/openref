# @openref/collector-redisx-cache

Reads `@nestjs-redisx/cache` and reports what a handler declares about caching its own response: the
window it is served for, the tags it carries, the layers it uses, and which cached reads it drops
when it succeeds. The facts land in `IRNodeRuntime.handlerPolicies` as policies of kind `cache`, and
none of it is anything an OpenAPI field can carry.

## Install

```sh
npm install @openref/collector-redisx-cache @openref/nest @nestjs-redisx/cache
```

`@openref/core` is a peer as well, for the types the facts are declared in. It arrives with
`@openref/nest`, so there is nothing extra to install for it.

## Use

```ts
import { OpenRefModule } from '@openref/nest';
import { redisxCacheCollector } from '@openref/collector-redisx-cache';

OpenRefModule.forRoot({
  runtime: {
    collectors: [redisxCacheCollector()],
  },
});
```

The factory takes no options.

## What it reads

Six decorators, in two families that are not the same fact. `@Cached`, `@InvalidateTags` and
`@InvalidateOn` replace the method with a wrapper the instant they are applied, so their key on the
handler is proof the behaviour is bound to the route, and they are reported at `handler` reach.
`@Cacheable`, `@CachePut` and `@CacheEvict` are bare metadata whose interceptor the library
registers nowhere, so they are reported at `unbound` reach, which says the declaration exists and
that nothing caches because of it. Every one of the six is a method decorator, so only the handler
is read.

`@Cached({ ttl })` is written in seconds and is converted, which is why the setting is named
`ttlMs`: `@WithLock({ ttl })` in the library beside it is milliseconds, and one column cannot hold
two units.

## The contract

It implements `IRuntimeCollector`, the public collector contract of `@openref/nest`: a `name`, and
`collect(context)` returning what was read about one node, or `undefined`.

It is fail open. When `@nestjs-redisx/cache` is not installed, or when the runtime offers no
metadata reflection, the factory returns a skip naming what was missing rather than a collector.
Nothing runs and the reference renders without the fact. The package is resolved and never loaded.

Every policy it emits carries a confidence, `derived` here, its reach, and the collector name
`redisxCacheCollector`, so a reader can tell an observation of the application from a promise
somebody typed.

What it deliberately never claims:

- An error contract. The library contains no exception filter, no `HttpException` and no
  `HttpStatus` anywhere in its source: a miss runs the method and a failure runs it too. There is no
  status to report and one is never invented.
- A module wide default as a route's own. A `@Cached` with no `ttl` falls back to the plugin's
  `defaultTtl`, which is configuration rather than a decision recorded on the route, so no number is
  printed for it.
- Interceptor logic. A tag function, a `condition` or `unless`, and a key that is not a literal
  template all decide at request time what is cached and under what, and are never read.
- A cache declared on a service. The collector is handed route handlers and reads nothing else, so a
  method on a provider cannot be attributed to an endpoint.

Each of those, and every unbound declaration, is recorded as a finding instead. They come out of
`problems()`, which the collector registry drains into `openref doctor`.

# @openref/collector-redisx-locks

Reads `@nestjs-redisx/locks` and reports how a route behaves when two callers arrive at once: what
the concurrent call is serialized per, how long the lock is held, how long a second caller waits,
and what that caller gets when it loses the race. The facts land in `IRNodeRuntime.handlerPolicies`
as a policy of kind `lock`, and none of it is anything an OpenAPI field can carry.

## Install

```sh
npm install @openref/collector-redisx-locks @openref/nest @nestjs-redisx/locks
```

`@openref/core` is a peer as well, for the types the facts are declared in. It arrives with
`@openref/nest`, so there is nothing extra to install for it.

## Use

```ts
import { OpenRefModule } from '@openref/nest';
import { redisxLockCollector } from '@openref/collector-redisx-locks';

OpenRefModule.forRoot({
  runtime: {
    collectors: [redisxLockCollector()],
  },
});
```

The factory takes no options.

## What it reads

`@WithLock(options)` writes its options onto the wrapper function that replaces the method, so the
key standing on the handler is proof the lock wraps the thing NestJS routes to. It is a method
decorator and cannot stand on the controller, so only the handler is read.

A string `key` becomes the lock's name, `ttl` and `waitTimeout` become `ttlMs` and `waitTimeoutMs`
untouched because the library documents both in milliseconds already, and `autoRenew` is carried as
declared. `onFailure` says which of three things a losing caller meets: `throw`, which is the
library's own default, `skip`, or `custom-error` where the route supplied an error factory.

## The contract

It implements `IRuntimeCollector`, the public collector contract of `@openref/nest`: a `name`, and
`collect(context)` returning what was read about one node, or `undefined`.

It is fail open. When `@nestjs-redisx/locks` is not installed, or when the runtime offers no
metadata reflection, the factory returns a skip naming what was missing rather than a collector.
Nothing runs and the reference renders without the fact. The package is resolved and never loaded.

Every policy it emits carries a confidence, `derived` here, its reach, and the collector name
`redisxLockCollector`, so a reader can tell an observation of the application from a promise
somebody typed.

What it deliberately never claims:

- A status. The library contains no exception filter, no `HttpException` and no `HttpStatus`
  anywhere in its source, and `LockAcquisitionError` extends a plain `Error`, so the code a losing
  caller sees is decided by whatever filter the host registered. A 409 or a 503 here would have been
  the cheap home and would have been invented.
- A lock on a service. `@WithLock` wraps a method on any injectable, and most of them in a real
  application sit on services. This collector is handed route handlers and reads nothing else: it
  never walks the container and never reads a provider's prototype, so what it reports is exactly
  the set of locks around a function NestJS routes to.
- A key computed in code. A `key` given as a function decides at call time whether the lock is per
  caller, per tenant or per resource, and a function under a key is never read.

The missing status is itself a finding this package writes, alongside the function key and the empty
response a skipped caller receives. They come out of `problems()`, which the collector registry
drains into `openref doctor`.

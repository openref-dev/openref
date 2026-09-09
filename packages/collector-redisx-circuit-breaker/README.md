# @openref/collector-redisx-circuit-breaker

Reads `@nestjs-redisx/circuit-breaker` and reports what a route does when the thing behind it is
down: how many failures in what window trip the breaker, how long it stays refusing, how it is
probed back open, and what a refused caller meets. The facts land in `IRNodeRuntime.handlerPolicies`
as a policy of kind `circuit-breaker`, and none of it is anything an OpenAPI field can carry.

## Install

```sh
npm install @openref/collector-redisx-circuit-breaker @openref/nest @nestjs-redisx/circuit-breaker
```

`@openref/core` is a peer as well, for the types the facts are declared in. It arrives with
`@openref/nest`, so there is nothing extra to install for it.

## Use

```ts
import { OpenRefModule } from '@openref/nest';
import { redisxCircuitBreakerCollector } from '@openref/collector-redisx-circuit-breaker';

OpenRefModule.forRoot({
  runtime: {
    collectors: [redisxCircuitBreakerCollector()],
  },
});
```

The factory takes no options.

## What it reads

`@WithCircuitBreaker(options)` writes its options onto the wrapper function that replaces the
method, so the key standing on the handler is proof the breaker wraps the thing NestJS routes to. It
is a method decorator and cannot stand on the controller, so only the handler is read.

A string `key` becomes the circuit's name. `failureThreshold`, `windowMs`, `openDurationMs`,
`halfOpenMaxCalls`, `successThreshold` and `probeTimeoutMs` are carried across under their own
names, the four durations already in milliseconds by the library's own definition and the two counts
without a unit. `whenOpen` says what a refused call meets, in the library's own order of precedence:
a `fallback` function wins outright, then `onOpen: 'skip'`, then throwing.

## The contract

It implements `IRuntimeCollector`, the public collector contract of `@openref/nest`: a `name`, and
`collect(context)` returning what was read about one node, or `undefined`.

It is fail open. When `@nestjs-redisx/circuit-breaker` is not installed, or when the runtime offers
no metadata reflection, the factory returns a skip naming what was missing rather than a collector.
Nothing runs and the reference renders without the fact. The package is resolved and never loaded.

Every policy it emits carries a confidence, `derived` here, its reach, and the collector name
`redisxCircuitBreakerCollector`, so a reader can tell an observation of the application from a
promise somebody typed.

What it deliberately never claims:

- A status. The library contains no exception filter, no `HttpException` and no `HttpStatus`
  anywhere in its source, `CircuitBreakerOpenError` extends a plain `Error`, and the plugin's
  `errorFactory` lets a host replace even that. A 503 here would have been the obvious guess and the
  wrong one.
- A module wide threshold as a route's own. Every knob has a default under the plugin options token,
  and reading one would attribute a module figure to one endpoint, so a route that declares only a
  key carries only a key.
- A breaker on a service. `@WithCircuitBreaker` wraps a method on any injectable, and the library's
  own examples put it on a payments service. This collector is handed route handlers and reads
  nothing else, so what it reports is exactly the set of breakers around a function NestJS routes
  to.
- A key or a `skip` computed in code. Both decide at call time what the breaker counts and what it
  sees at all, and a function under a key is never read.

The missing status is itself a finding this package writes, alongside a breaker with no threshold of
its own and a fallback whose body the reference cannot know. They come out of `problems()`, which
the collector registry drains into `openref doctor`.

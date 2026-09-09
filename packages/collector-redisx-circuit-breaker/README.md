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
`@openref/nest`, so there is nothing extra to install for it. `@nestjs-redisx/circuit-breaker` is an
optional peer: without it the factory declines rather than failing to load.

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

The factory takes nothing a host passes. `RedisxCircuitBreakerCollectorOptions` has two members and
both are test seams:

| Option           | Type                  | Default                                   |
| ---------------- | --------------------- | ----------------------------------------- |
| `resolvePackage` | `() => boolean`       | resolves `@nestjs-redisx/circuit-breaker` |
| `metadata`       | `MetadataValueReader` | the global `Reflect`                      |

`MetadataValueReader` is one member, `get(key, target)`. It is the same name and the same shape the
redisx collectors beside this one export, which is the contract holding rather than a collision.

## What it reads

`@WithCircuitBreaker(options)` writes its options onto the wrapper function that replaces the method,
so the key standing on the handler is proof the breaker wraps the thing NestJS routes to. The key is
reached as `Symbol.for('WITH_CIRCUIT_BREAKER_OPTIONS')`, which yields the same symbol the library's
own module yields without loading it; the package is still resolved first, because a global symbol is
available in any process whether or not the library that names it is present. It is a method
decorator and cannot stand on the controller class, so only the handler is read, and it requires its
argument, so there is no bare form and presence of an object is a decorated route.

What the decorator contributes, in the setting names a reader sees:

| Option                                                     | Reported as                          |
| ---------------------------------------------------------- | ------------------------------------ |
| `key`, only when it is a non-empty string                  | the policy key                       |
| `failureThreshold`, `halfOpenMaxCalls`, `successThreshold` | the same names, counts               |
| `windowMs`, `openDurationMs`, `probeTimeoutMs`             | the same names, already milliseconds |
| `fallback` and `onOpen` together                           | `whenOpen`, always reported          |

Only a positive finite number is taken for any of the six numeric knobs, so a zero or a value of
another type is read as absent rather than as a threshold, and the four durations are carried across
untouched because the library documents them in milliseconds already.

`whenOpen` says what a refused call meets, in the library's own order of precedence, read off
`resolveFallback` rather than assumed: a `fallback` function wins outright, then `onOpen: 'skip'`,
then throwing. A decorator carrying both a fallback and `onOpen: 'skip'` is therefore reported as
falling back, which is what the application does.

## A worked example

```ts
// payments.controller.ts
import { Body, Controller, Post } from '@nestjs/common';
import { WithCircuitBreaker } from '@nestjs-redisx/circuit-breaker';

@Controller('payments')
export class PaymentsController {
  @Post('charge')
  @WithCircuitBreaker({
    key: 'stripe',
    failureThreshold: 5,
    windowMs: 10_000,
    openDurationMs: 30_000,
  })
  charge(@Body() dto: ChargeDto) {}
}
```

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { CircuitBreakerPlugin } from '@nestjs-redisx/circuit-breaker';
import { OpenRefModule } from '@openref/nest';
import { redisxCircuitBreakerCollector } from '@openref/collector-redisx-circuit-breaker';

@Module({
  controllers: [PaymentsController],
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [new CircuitBreakerPlugin({ failureThreshold: 5, windowMs: 10_000 })],
    }),
    OpenRefModule.forRoot({ runtime: { collectors: [redisxCircuitBreakerCollector()] } }),
  ],
})
export class AppModule {}
```

`POST /payments/charge` then carries one policy reading `Circuit breaker on stripe`, with
`failureThreshold 5, windowMs 10000, openDurationMs 30000, whenOpen throw` beside it. A client author
reading that page learns that five failures in ten seconds stop the route answering for thirty
seconds, which is behaviour no field of the specification carries.

## What the reference page shows

`handlerPolicies` is a list whose members each carry their own provenance, unlike a single valued
fact. The policy is drawn as one value on the `Handler policies` row of the runtime block, with the
text `Circuit breaker`, followed by ` on <key>` when the decorator gave a literal string key. The
settings follow as a note, each one written as its name, a space and its value, joined with `, `.
There is no humanisation and no unit suffix: the unit lives in the name, which is why `windowMs 10000`
reads correctly and a setting called `window` would not.

Handler policies are not one of the eleven kinds of the parity scale, so the default theme's
operation page has no cell for them today. The fact travels in the page model regardless, and a theme
that draws the labelled runtime rows, as `@openref/theme-telltale` does, shows it under the label
`Handler policies`.

The policy carries a provenance tag, `DRV`, whose tooltip reads
`derived, redisxCircuitBreakerCollector`. `derived` is the level for a value read out of metadata
under a key this project knows. Its reach is always `handler`, because the decorator wrapped the
method itself; this collector never produces an `unbound` policy, since there is no declarative half
of this library to be left unwired.

## What it refuses to read

Each refusal below is a `problems()` record, and the registry drains those into `openref doctor`,
where one prints as `DRIFT  RT070  PaymentsController.charge` with the action on an arrow line under
it. The reason and the detail are in `--json` only, and there the reason arrives prefixed with
`redisxCircuitBreakerCollector`.

- **A status.** The library contains no exception filter, no `HttpException` and no `HttpStatus`
  anywhere in its source, `CircuitBreakerOpenError` extends its own `RedisXError`, which extends a
  plain `Error`, and the plugin's `errorFactory` lets a host replace even that. A 503 here would have
  been the obvious guess and the wrong one. Every breaker route therefore gets one of three records,
  chosen by `whenOpen`: under `throw` the action is
  `declare the status your exception filter maps it to with @ApiErrors on this route`; under `skip`
  it is `document the empty response, or drop onOpen so a refused caller is told the circuit is open`,
  because a skipped call resolves to nothing; under `fallback` it is
  `document the fallback body with @ApiResponse if a client can receive it`, because the fallback's
  return value becomes the response and can be a shape the handler never produces.
- **A module wide threshold as a route's own.** Every knob has a default under
  `Symbol.for('CIRCUIT_BREAKER_PLUGIN_OPTIONS')`, and reading one would attribute a module figure to
  one endpoint, so a route that declares only a key carries only a key. That state is recorded on its
  own, with the action
  `name failureThreshold and windowMs on the decorator to make the figures facts about this route`.
- **A key or a `skip` computed in code.** A `key` function decides what the breaker counts failures
  per, and a `skip` function decides which calls go through the breaker at all. Both are functions
  under a key and are never read. Each is recorded, and a key function also means the policy is
  reported with no key rather than with a wrong one.
- **A breaker on a service.** `@WithCircuitBreaker` wraps a method on any injectable, and the
  library's own examples put it on a payments service. This collector is handed route handlers and
  reads nothing else, so what it reports is exactly the set of breakers around a function NestJS
  routes to. There is nothing to record, because there is nothing about the route to say.

Because the `whenOpen` finding fires on every breaker route, an application that has answered the
question once can name the class in `runtime.suppress` with a reason. Note that suppression acts on a
whole rule across the entire document, so suppressing `discovery-incomplete` hides every finding of
that class and not only these, and `openref doctor` prints the suppressed classes, their reasons and
their counts either way.

## When nothing appears

A handler with no `@WithCircuitBreaker` gets no contribution at all, and that is deliberate: a
present and empty list would claim the route was examined and declares no breaker, and this collector
cannot tell an undecorated route from one in an application that never installed the plugin. A route
with no policies is a row that is simply not drawn, so check three things in this order:

1. **The collector is not registered.** Nothing about it appears in `openref doctor`, because a
   collector nobody registered is not an instrument that failed. Add
   `redisxCircuitBreakerCollector` to the `collectors` option.
2. **`@nestjs-redisx/circuit-breaker` is absent, or the runtime offers no metadata reflection.** The
   factory returns a skip and `doctor` prints it under `Collectors that did not run:`, one line, the
   collector name and the reason.
3. **The breaker is on a service and not on the handler.** This is the common case, since the
   library's own examples put `@WithCircuitBreaker` on a payments service, which is usually the right
   place for it. What this collector reports is exactly the set of breakers around a function NestJS
   routes to, and from the outside it looks like the summary line
   `Runtime collectors that reported a fact` counting a collector that produced nothing anywhere.

## The contract

It implements `IRuntimeCollector`, the public collector contract of `@openref/nest`: a `name`, and
`collect(context)` returning what was read about one node, or `undefined`. `problems()` is read
structurally beside it, so the contract itself stays at two members. It is fail open: when the
library is not installed, or when the runtime offers no metadata reflection, the factory returns a
`SkippedCollector` naming what was missing rather than a collector, nothing runs, the reference
renders without the fact, and the name and the reason still reach `IRRuntimeMeta.skipped`. The
package is resolved and never loaded.

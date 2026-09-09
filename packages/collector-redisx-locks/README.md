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
`@openref/nest`, so there is nothing extra to install for it. `@nestjs-redisx/locks` is an optional
peer: without it the factory declines rather than failing to load.

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

The factory takes nothing a host passes. `RedisxLockCollectorOptions` has two members and both are
test seams:

| Option           | Type                  | Default                         |
| ---------------- | --------------------- | ------------------------------- |
| `resolvePackage` | `() => boolean`       | resolves `@nestjs-redisx/locks` |
| `metadata`       | `MetadataValueReader` | the global `Reflect`            |

`MetadataValueReader` is one member, `get(key, target)`. It is the same name and the same shape the
redisx collectors beside this one export, which is the contract holding rather than a collision.

## What it reads

`@WithLock(options)` writes its options onto the wrapper function that replaces the method, so the
key standing on the handler is proof the lock wraps the thing NestJS routes to. The key is reached as
`Symbol.for('WITH_LOCK_OPTIONS')`, which yields the same symbol the library's own module yields
without loading it; the package is still resolved first, because a global symbol is available in any
process whether or not the library that names it is present. It is a method decorator and cannot
stand on the controller class, so only the handler is read, and it requires its argument, so there is
no bare form and presence of an object is a decorated route.

What the decorator contributes, in the setting names a reader sees:

| Option         | Reported as     | Notes                                                         |
| -------------- | --------------- | ------------------------------------------------------------- |
| `key`          | the policy key  | Only when it is a non-empty string. A function is not a name. |
| `ttl`          | `ttlMs`         | Carried untouched: the library documents it in milliseconds.  |
| `waitTimeout`  | `waitTimeoutMs` | Carried untouched, milliseconds again.                        |
| `autoRenew`    | `autoRenew`     | Carried as declared, when it is a boolean.                    |
| `onLockFailed` | `onFailure`     | Always reported, as one of three words.                       |

The durations are the reason the names carry `Ms`. `@Cached({ ttl })` in the cache library beside
this one is seconds and these are milliseconds, so a member called `ttl` on both would put two
quantities under one word on one page.

`onFailure` says which of three things a losing caller meets. `throw` is the library's own default,
read off `handleLockFailed`, which resolves `options.onLockFailed ?? 'throw'`. `skip` is the other
word the option admits, under which the method does not run and resolves to nothing. `custom-error`
is what an error factory becomes: it is neither of the two words, and what a caller receives under it
is a host error this cannot name, so folding it into `throw` would be saying something that was not
read.

## A worked example

```ts
// orders.controller.ts
import { Body, Controller, Param, Post } from '@nestjs/common';
import { WithLock } from '@nestjs-redisx/locks';

@Controller('orders')
export class OrdersController {
  @Post(':id/settle')
  @WithLock({ key: 'order:{0}', ttl: 10_000, waitTimeout: 5_000, autoRenew: true })
  settle(@Param('id') id: string, @Body() dto: SettleDto) {}
}
```

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { LocksPlugin } from '@nestjs-redisx/locks';
import { OpenRefModule } from '@openref/nest';
import { redisxLockCollector } from '@openref/collector-redisx-locks';

@Module({
  controllers: [OrdersController],
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [new LocksPlugin({ defaultTtl: 30_000 })],
    }),
    OpenRefModule.forRoot({ runtime: { collectors: [redisxLockCollector()] } }),
  ],
})
export class AppModule {}
```

`POST /orders/{id}/settle` then carries one policy reading `Locked on order:{0}`, with
`ttlMs 10000, waitTimeoutMs 5000, autoRenew true, onFailure throw` beside it. A client author reading
that page learns that two settlements of one order are serialized, that a second caller waits five
seconds, and that it is then refused rather than queued.

## What the reference page shows

`handlerPolicies` is a list whose members each carry their own provenance, unlike a single valued
fact. The policy is drawn as one value on the `Handler policies` row of the runtime block, with the
text `Locked`, followed by ` on <key>` when the decorator gave a literal string key. The settings
follow as a note, each one written as its name, a space and its value, joined with `, `. There is no
humanisation and no unit suffix: the unit lives in the name, which is why `ttlMs 10000` reads
correctly and a setting called `ttl` would not.

Handler policies are not one of the eleven kinds of the parity scale, so the default theme's
operation page has no cell for them today. The fact travels in the page model regardless, and a theme
that draws the labelled runtime rows, as `@openref/theme-telltale` does, shows it under the label
`Handler policies`.

The policy carries a provenance tag, `DRV`, whose tooltip reads `derived, redisxLockCollector`.
`derived` is the level for a value read out of metadata under a key this project knows. Its reach is
always `handler`, because the decorator wrapped the method itself; this collector never produces an
`unbound` policy, since there is no declarative half of this library to be left unwired.

## What it refuses to read

Each refusal below is a `problems()` record, and the registry drains those into `openref doctor`,
where one prints as `DRIFT  RT070  OrdersController.settle` with the action on an arrow line under
it. The reason and the detail are in `--json` only, and there the reason arrives prefixed with
`redisxLockCollector`.

- **A status.** The library contains no exception filter, no `HttpException` and no `HttpStatus`
  anywhere in its source, and `LockAcquisitionError` extends its own `RedisXError`, which extends a
  plain `Error`, so the code a losing caller sees is decided by whatever filter the host registered.
  A 409 or a 503 here would have been the cheap home and would have been invented. This is the one
  finding the package exists to write, and every locked route gets one of the two forms of it: under
  `throw` or `custom-error` the action is
  `declare the status your exception filter maps it to with @ApiErrors on this route`, and under
  `skip` it is `document the empty response, or use the default onLockFailed if a caller should be refused`,
  because a skipped caller receives whatever NestJS serializes for an empty handler result.
- **A key computed in code.** A `key` given as a function decides at call time whether the lock is
  per caller, per tenant or per resource, and a function under a key is never read. It is recorded,
  and the policy is reported with no key at all rather than with a wrong one.
- **A lock on a service.** `@WithLock` wraps a method on any injectable, and most of them in a real
  application sit on services. This collector is handed route handlers and reads nothing else: it
  never walks the container and never reads a provider's prototype, so what it reports is exactly the
  set of locks around a function NestJS routes to. There is nothing to record, because there is
  nothing about the route to say.
- **The plugin's own defaults.** A route that names no `ttl` gets no `ttlMs`, because the number the
  library would use comes from `LocksPlugin`, which is configuration of the module rather than a
  decision recorded on this route.

Because the status finding fires on every locked route, an application that has answered the question
once can name the class in `runtime.suppress` with a reason. Note that suppression acts on a whole
rule across the entire document, so suppressing `discovery-incomplete` hides every finding of that
class and not only these, and `openref doctor` prints the suppressed classes, their reasons and their
counts either way.

## When nothing appears

A handler with no `@WithLock` gets no contribution at all, and that is deliberate: a present and
empty list would claim the route was examined and declares no lock, and this collector cannot tell an
undecorated route from one in an application that never installed the plugin. A route with no
policies is a row that is simply not drawn, so check three things in this order:

1. **The collector is not registered.** Nothing about it appears in `openref doctor`, because a
   collector nobody registered is not an instrument that failed. Add `redisxLockCollector` to the
   `collectors` option.
2. **`@nestjs-redisx/locks` is absent, or the runtime offers no metadata reflection.** The factory
   returns a skip and `doctor` prints it under `Collectors that did not run:`, one line, the collector
   name and the reason.
3. **The lock is on a service and not on the handler.** This is the common case, since the library's
   own examples put `@WithLock` on a payment service. What this collector reports is exactly the set
   of locks around a function NestJS routes to, and from the outside it looks like the summary line
   `Runtime collectors that reported a fact` counting a collector that produced nothing anywhere.

## The contract

It implements `IRuntimeCollector`, the public collector contract of `@openref/nest`: a `name`, and
`collect(context)` returning what was read about one node, or `undefined`. `problems()` is read
structurally beside it, so the contract itself stays at two members. It is fail open: when the
library is not installed, or when the runtime offers no metadata reflection, the factory returns a
`SkippedCollector` naming what was missing rather than a collector, nothing runs, the reference
renders without the fact, and the name and the reason still reach `IRRuntimeMeta.skipped`. The
package is resolved and never loaded.

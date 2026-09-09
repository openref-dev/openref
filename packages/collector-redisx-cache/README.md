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
`@openref/nest`, so there is nothing extra to install for it. `@nestjs-redisx/cache` is an optional
peer: without it the factory declines rather than failing to load.

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

The factory takes nothing a host passes. `RedisxCacheCollectorOptions` has two members and both are
test seams:

| Option           | Type                  | Default                         |
| ---------------- | --------------------- | ------------------------------- |
| `resolvePackage` | `() => boolean`       | resolves `@nestjs-redisx/cache` |
| `metadata`       | `MetadataValueReader` | the global `Reflect`            |

`MetadataValueReader` is one member, `get(key, target)`, the same name and shape the redisx
collectors beside this one export.

## What it reads

Six decorators, in two families that are not the same fact.
`@Cached`, `@InvalidateTags` and `@InvalidateOn` replace the method with a wrapper the instant they
are applied and write their options onto that wrapper, so their key on the handler is proof the
behaviour is bound to the route. They are reported at `handler` reach. `@Cacheable`, `@CachePut` and
`@CacheEvict` are bare `SetMetadata` calls whose reader is the interceptor the library exports as
`DeclarativeCacheInterceptor` and registers in no module of its own, so they are reported at
`unbound` reach, which says the declaration exists and that nothing caches because of it. Every one
of the six is a method decorator, so only the handler is read; a controller class carries none of
them.

Five of the six keys are plain strings, `cache:options`, `cache:invalidate:tags`, `cache:cacheable`,
`cache:put` and `cache:evict`, and one is the global symbol `INVALIDATE_ON_OPTIONS`. Every one is
spelled here rather than imported, because a value import of an optional peer at module scope would
make this collector fail to load in the application it is designed to skip in. The package is
resolved and never required. What each decorator contributes, in the setting names a reader sees:

| Decorator         | Settings reported                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `@Cached`         | `ttlMs`, `tags`, `layers`, `staleWhileRevalidateMs`, `staleIfErrorMs`, plus `key` as the scope |
| `@InvalidateTags` | `invalidatesTags`, `invalidatesWhen`                                                           |
| `@InvalidateOn`   | `invalidatesOnEvents`, `invalidatesTags`, `invalidatesKeys`, `publishesInvalidation`           |
| the unbound three | `declaredBy`, naming which decorator made the declaration                                      |

`@Cached({ ttl })` is written in seconds and is converted, which is why the setting is named `ttlMs`:
`@WithLock({ ttl })` in the library beside it is milliseconds, and one column cannot hold two units.
`swr.staleTime` and `staleIfError.window` are seconds too and are converted the same way, and each is
read only when its own block sets `enabled: true`, because `{ enabled: false, staleTime: 30 }` is a
number the library never applies. `layers` carries the `strategy` string, `l1-only`, `l2-only` or
`l1-l2`. The unbound three have their settings deliberately left unread: a ttl on a declaration that
binds nothing is a number a reader would take for a window their responses are served in, and the
whole value of `unbound` is saying the opposite.

## A worked example

```ts
// catalog.controller.ts
import { Controller, Get, Post } from '@nestjs/common';
import { Cached, InvalidateTags } from '@nestjs-redisx/cache';

@Controller('catalog')
export class CatalogController {
  @Get('products')
  @Cached({ key: 'catalog:products', ttl: 300, tags: ['products'], strategy: 'l1-l2' })
  list() {}

  @Post('products')
  @InvalidateTags({ tags: ['products'], when: 'after' })
  create() {}
}
```

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { RedisModule } from '@nestjs-redisx/core';
import { CachePlugin } from '@nestjs-redisx/cache';
import { OpenRefModule } from '@openref/nest';
import { redisxCacheCollector } from '@openref/collector-redisx-cache';

@Module({
  controllers: [CatalogController],
  imports: [
    RedisModule.forRoot({
      clients: { host: 'localhost', port: 6379 },
      plugins: [new CachePlugin({ l1: { maxSize: 1000 }, l2: { defaultTtl: 3600 } })],
    }),
    OpenRefModule.forRoot({ runtime: { collectors: [redisxCacheCollector()] } }),
  ],
})
export class AppModule {}
```

`GET /catalog/products` then carries one policy reading `Cached on catalog:products`, with
`ttlMs 300000, tags products, layers l1-l2` beside it, and `POST /catalog/products` carries one
reading `Cached` with `invalidatesTags products, invalidatesWhen after`. The second is a cache fact
about a route that caches nothing: it says which reads go stale when that write succeeds.

## What the reference page shows

`handlerPolicies` is a list whose members each carry their own provenance, unlike a single valued
fact. Each policy is drawn as one value on the `Handler policies` row of the runtime block, with the
text `Cached` for every kind this collector produces, followed by ` on <key>` when the decorator gave
a literal string key. The settings follow as a note, each written as its name, a space and its value,
joined with `, `, and a list value joined with `, ` in turn. There is no humanisation and no unit
suffix: the unit lives in the name, which is why `ttlMs 300000` reads correctly and a setting called
`ttl` would not. An `unbound` policy carries one extra sentence at the front of that note,
`Declared and bound by nothing here, so this route does not behave this way today.`, and then only
`declaredBy @Cacheable` or its two neighbours.

Handler policies are not one of the eleven kinds of the parity scale, so the default theme's
operation page has no cell for them today. The fact travels in the page model regardless, and a theme
that draws the labelled runtime rows, as `@openref/theme-telltale` does, shows it under the label
`Handler policies`. Each policy carries a provenance tag, `DRV`, whose tooltip reads
`derived, redisxCacheCollector`. `derived` is the level for a value read out of metadata under a key
this project knows. The reach is not a confidence and must not be read as one: an unbound declaration
was read exactly as well as a bound one, and what differs is what the fact is about.

## What it refuses to read

Each refusal below is a `problems()` record, and the registry drains those into `openref doctor`,
where one prints as `DRIFT  RT070  CatalogController.list` with the action on an arrow line under it.
The reason and the detail are in `--json` only, and there the reason arrives prefixed with
`redisxCacheCollector`.

- **An error contract.** The library contains no exception filter, no `HttpException` and no
  `HttpStatus` anywhere in its source: a miss runs the method and a failure runs it too, under its
  own fail open policy. There is no status to report, one is never invented, and nothing is recorded.
- **A declaration nothing binds.** Every `@Cacheable`, `@CachePut` and `@CacheEvict` is recorded, with
  the action `bind CacheInterceptor with @UseInterceptors, or move the route to @Cached, which binds itself`.
  The symbol to import for that is `DeclarativeCacheInterceptor`, the name the library's barrel
  exports the class under.
- **A module wide default as a route's own.** A `@Cached` with no `ttl` falls back to the plugin's
  `defaultTtl`, which is configuration rather than a decision recorded on the route, so no number is
  printed and the record says the window is not known.
- **Interceptor logic.** A `tags` function on `@Cached` or on `@InvalidateTags`, a `condition` or an
  `unless`, and a `key` that is not a literal string all decide at request time what is cached and
  under what. Each is recorded. A `@Cached` with no `key` at all is recorded too, because the library
  then builds `ClassName:methodName:args` and hashes object arguments, which is runtime state.
  `varyBy` and `contextKeys` get their own record, because they name values a `contextProvider`
  resolves per request, so one response per caller is possible.
- **A cache declared on a service.** The collector is handed route handlers and reads nothing else,
  so a method on a provider cannot be attributed to an endpoint, and there is nothing to record.
- **Options it has no field for.** `skipContext` on `@Cached`, the `shouldServe` predicate inside
  `staleIfError`, and the plugin's `contextProvider` and key separator are read by nothing here.

One asymmetry is worth knowing: an `@InvalidateOn` whose `tags` or `keys` are functions yields no
setting and no record, while the same function under `@InvalidateTags` is recorded, as is a
`condition` function on `@InvalidateOn`.

## When nothing appears

A handler carrying none of the six gets no contribution at all, and that is deliberate: a present and
empty list would claim the route was examined and declares no cache, and this collector cannot tell
an undecorated route from one in an application that never installed the plugin. A route with no
policies is a row that is simply not drawn, so check three things in this order:

1. **The collector is not registered.** Nothing about it appears in `openref doctor`, because a
   collector nobody registered is not an instrument that failed. Add `redisxCacheCollector` to the
   `collectors` option.
2. **`@nestjs-redisx/cache` is absent, or the runtime offers no metadata reflection.** The factory
   returns a skip and `doctor` prints it under `Collectors that did not run:`, one line, the collector
   name and the reason.
3. **The decorator is on a service and not on the handler.** This is the common case, since all six
   work on any injectable and the library's own examples put `@Cached` on a service. What this
   collector reports is exactly the set of declarations on a function NestJS routes to, and from the
   outside it looks like the summary line `Runtime collectors that reported a fact` counting a
   collector that produced nothing on any node of the document.

## The contract

It implements `IRuntimeCollector`, the public collector contract of `@openref/nest`: a `name`, and
`collect(context)` returning what was read about one node, or `undefined`. `problems()` is read
structurally beside it, so the contract itself stays at two members. It is fail open: when the
library is not installed, or when the runtime offers no metadata reflection, the factory returns a
`SkippedCollector` naming what was missing rather than a collector, nothing runs, the reference
renders without the fact, and the name and the reason still reach `IRRuntimeMeta.skipped`. The
package is resolved and never loaded.

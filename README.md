# OPENREF

NestJS-native API reference for HTTP, events and runtime contracts.

The specification describes how the API looks.
The NestJS application knows how the API behaves.
OPENREF connects the two.

## Install

```bash
npm i @openref/nest
```

```ts
OpenRefModule.setup('/docs', app, { document });
```

That is the whole of the first minute. What arrives with it:

```
Reference with search and schemas
Try it
Guards and the scopes a route requires
Rate limits
Error contracts, in three groups that are never one list
SSE endpoints
A link to the line the handler is written on
No CDN, no telemetry, strict CSP with no unsafe-inline
```

## What the application knows

This controller is in the demo, in `examples/nest-minimal/src/orders.controller.ts`:

```ts
@ApiTags('orders')
@UseGuards(ScopesGuard)
@Controller('orders')
export class OrdersController {
  @Get()
  @Scopes('orders:read')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(ThrottlerGuard)
  ...
}
```

and this is the runtime block the reference draws for it, read off the served page:

```
GET /orders

Guards                   ScopesGuard, ThrottlerGuard
Scopes                   orders:read
Rate limit               30 / minute (default)
Errors, declared         This handler declares no errors
Errors, runtime-derived  429 Too Many Requests, 401 Unauthorized, 403 Forbidden
Errors, global           500 Internal Server Error
Source                   OrdersController.list()
```

None of that is in the OpenAPI document, and none of it is guessed. Every row carries the level
it was read at, `declared`, `derived` or `inferred`, and the name of the collector that produced
it, so a reader can tell a promise somebody wrote from an observation of the running application.
The 401 and 403 are there because a guard stands in front of the handler; what that guard decides
is written in its own code and is never read.

The block above is not a picture of the product. `readme-reproduction.spec.ts` boots this demo,
fetches that page and fails if a single row disagrees with it, so this README cannot drift from
what the application actually serves.

## Run the demo

```bash
pnpm demo
```

From a clean clone, with no build order to get right. `examples/README.md` says what to open.

## Licence

MIT.

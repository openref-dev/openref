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

and this is the parity scale the reference draws for it, read off the served page. Each row
pairs what the specification declares with what the application does, and the glyph between
them is the drift engine's verdict: `=` where the rule looked and stayed quiet, `≠` where a
finding is recorded, `?` where the comparison did not run:

```
GET /orders

Authentication  ≠  ScopesGuard, ThrottlerGuard
Scopes          ?  orders:read
Rate limit      =  30 / minute (default)
Response codes  ?  This handler declares no errors; 429; 401, 403; 500
Source          ?  OrdersController.list()
```

None of that is in the OpenAPI document, and none of it is guessed. Every value carries the
level it was read at, `declared`, `derived` or `inferred`, and the name of the collector that
produced it, so a reader can tell a promise somebody wrote from an observation of the running
application. The 401 and 403 are there because a guard stands in front of the handler; what
that guard decides is written in its own code and is never read. The `≠` on authentication is
a real finding: a guard protects the route and the document asserts no security, so the row
closes with the exact decorator that fixes it and the rule code `RT010`.

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

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

<!-- gen: claims:bare-mount -->
```
A reference with search, and a page per named schema
Try it, on every operation
SSE endpoints, marked from the document
No CDN and no outgoing request of any kind
Every asset served by your own application, under a name carrying its own digest
Output a strict CSP accepts: no inline style, no inline script, and a nonce on what needs one. Setting the header is yours to do, because this module never writes one
No telemetry, no version check, and no install time call home
Descriptions rendered as markdown and then sanitized, rather than escaped
```
<!-- /gen -->

Those <!-- gen: count:fence-above -->eight<!-- /gen --> are everything the document can say on its own. Register `guardsCollector`,
`scopesCollector` and `sourceCollector` in your root module, which is three more lines, and the
reference stops being a rendering of a file:

<!-- gen: claims:printed-block -->
```
Guards and the scopes a route requires
A link to the line the handler is written on
```
<!-- /gen -->

Nothing is registered unasked, so the last two cost more than a line. Error contracts, in three
groups that are never one list, need `errorsCollector` and a catalogue you declare. Rate limits
need `throttlerCollector` from `@openref/collector-throttler`, a second package, so that
`@openref/nest` never puts a rate limiting library in the closure of an application that does not
rate limit anything. `packages/nest/test/integration/first-minute.spec.ts` boots the exact code
this file prints and holds each list against the served markup.

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

Authentication     ≠  ScopesGuard, ThrottlerGuard
Scopes             ?  orders:read
Rate limit         =  30 / minute (default)
Response codes     ?  This handler declares no errors; 429; 401, 403; 500
Validation         ?  TrimPipe; CurrencyPipe
Timeout            ?  5000 ms
Unread parameters  ≠  4 of 10 seen read
Source             ?  OrdersController.list()
```

None of that is in the OpenAPI document, and none of it is guessed. Every value carries the
level it was read at, `declared`, `derived` or `inferred`, and the name of the collector that
produced it, so a reader can tell a promise somebody wrote from an observation of the running
application. The 401 and 403 are there because a guard stands in front of the handler; what
that guard decides is written in its own code and is never read. The `≠` on authentication is
a real finding: a guard protects the route and the document asserts no security, so the row
closes with the exact decorator that fixes it and the rule code `RT010`. The `≠` on unread
parameters is another: this operation declares ten inputs and the handler binds four, so the
five filters and the header the document promises are read by nothing, and the row closes
with `SP010`. The scan concludes that only where it accounted for every access path, at
`inferred`, and a handler it cannot account for produces no row rather than a guess.

The block above is not a picture of the product. `readme-reproduction.spec.ts` boots this demo,
fetches that page and fails if a single row disagrees with it, so this README cannot drift from
what the application actually serves.

## Coming from `@nestjs/swagger`?

That is the whole audience, and the change is one line. `createDocument` stays where it is, and
so does every `@ApiProperty`, `@ApiResponse` and `@ApiTags` you have already written:

```diff
- SwaggerModule.setup('docs', app, document);
+ OpenRefModule.setup('/docs', app, { document });
```

You can also run both at once, at two routes, and delete the second line when nobody opens it.
`docs/guide/01-coming-from-nestjs-swagger.md` has the rest, including what you lose.

## Run the demo

```bash
pnpm demo
```

From a clean clone, with no build order to get right. `examples/README.md` says what to open.

## Examples

| Directory | What it is for |
| --- | --- |
| `examples/nest-minimal` | the first minute: one controller, one line, a page you can send requests from |
| `examples/runtime-intelligence` | a hand written collector, and what a fact with provenance looks like |
| `examples/custom-theme` | an L0 theme: tokens only, no build step, no package |
| `examples/federation` | three services, one reference over all of them |
| `examples/events` | message channels discovered from handlers, rendered as AsyncAPI |
| `examples/static-build` | the static build, and the proxy configuration per hosting platform |
| `examples/nuxt-reference` | the Nuxt module, for a site that is not a NestJS application |

The ones that listen are booted by a committed test, which fetches a page from each of them.
`static-build` is not in that suite because it builds and exits, so its own case runs the
build and checks every target directory; `nuxt-reference` is excluded from it by name, because it
is a Nuxt project rather than a Nest application, and `packages/nuxt` proves it instead.

## Documentation

The guide is in `docs/guide/`, and `pnpm docs:build` renders it into a site with the product
itself: `openref build` over a document whose description is the guide and whose operations are
the routes `OpenRefModule.setup` mounts. There is no second renderer and no static site
generator, which is the only way a page claiming zero external requests can be checked rather
than believed.

## Licence

MIT.

One install, one line, and your NestJS application has an API reference.

```bash
npm i @openref/nest
```

```ts
OpenRefModule.setup('/docs', app, { document });
```

Open `/docs`. Without configuring anything else, the page already carries:

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

`document` is the object `@nestjs/swagger` already builds for you. Nothing else changes.

## Three more lines, and it stops being a rendering of a file

The <!-- gen: count:fence-above -->eight<!-- /gen --> items above are everything a document can say on its own. These are what your
application knows. Nothing is registered unasked, so each fact costs you the collector that
reads it:

```ts
OpenRefModule.forRoot({
  runtime: {
    collectors: [guardsCollector(), scopesCollector({ metadataKey: SCOPES_KEY }), sourceCollector()],
    sourceLink: 'https://github.com/org/repo/blob/{ref}/{file}#L{line}',
  },
});
```

That block, exactly as printed, adds <!-- gen: count:fence -->two<!-- /gen --> things:

<!-- gen: claims:printed-block -->
```
Guards and the scopes a route requires
A link to the line the handler is written on
```
<!-- /gen -->

The other <!-- gen: count:table -->two<!-- /gen --> cost more than a line each, and here is what each one costs:

| To also get | Add | Which costs |
| --- | --- | --- |
| Error contracts, in three groups that are never one list | `errorsCollector({ catalogs, global })` | one more collector, and the catalogue is yours to declare: nothing derives an endpoint's errors from an exception filter |
| Rate limits | `throttlerCollector()` from `@openref/collector-throttler` | a second package to install, so that `@openref/nest` never puts a rate limiting library in the closure of an application that does not rate limit anything |

Until you add them the reference says so rather than staying blank. With the collectors above
and no error catalogue, the rate limit row reads `not described / no 429 response`, which
is the parity scale reporting that the comparison did not run, not a route with no limit.

`packages/nest/test/integration/first-minute.spec.ts` boots the exact code printed on this page
and asserts which items appear, so this table and that block cannot drift apart.

## The page you are reading is the product

This site was rendered by the same code the install above brings in. It made no network request
while you loaded it, its markup carries no inline style and no inline script so a policy with no
`unsafe-inline` accepts it, and every asset came from its own directory under a name carrying
the digest of its own bytes. Whatever the rest of this page claims, that part you can check in
your browser's network tab right now. Sending the header is the host's job, here as anywhere:
this project never writes one for you.

## What your application knows that the document does not

This controller is real. It is in `examples/nest-minimal/src/orders.controller.ts` in the
repository, and `pnpm demo` serves it:

```
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

This is what the reference draws for it, read off the served page:

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

Each row pairs what the specification declares with what the application does. The glyph
between them is the verdict: `=` where the rule looked and stayed quiet, `≠` where a finding
is recorded, `?` where the comparison did not run.

None of that is in the OpenAPI document, and none of it is guessed. Every value carries the
level it was read at, `declared`, `derived` or `inferred`, and the name of the collector that
produced it, so you can tell a promise somebody wrote from an observation of the running
application.

Two of those rows are real findings on real code. `Authentication` reads `≠` because a guard
stands in front of the route while the document asserts no security. `Unread parameters` reads
`≠` because the operation declares ten inputs and the handler binds four, so five filters and
a header the document promises are read by nothing.

## Where to go next

- **Coming from a plain `@nestjs/swagger` setup?** Read the next section. It is the whole
  audience of this project, and the change is one line.
- **Want to see it before installing it?** `pnpm demo` from a clone boots the application above.
- **Want the reference for what mounting actually gives you?** Every route in the navigation
  on this page is a route `OpenRefModule.setup` mounts. Open one.

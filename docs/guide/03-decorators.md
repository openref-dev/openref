## Decorators

<!-- gen: count:fence -->Nine<!-- /gen --> decorators, and you need none of them to start. Each one exists because the fact it
carries cannot be read from a running application, and inventing it would be a guess presented
as a fact.

```
@ApiScopes('orders:write')
@ApiErrors(NotFoundError, PermissionDeniedError)
@ApiStream({ itemType: ProgressDto, kind: 'sse', terminator: '[DONE]' })
@ApiSample({ lang: 'typescript', label: 'SDK', source: '...' })
@ApiAudience('internal')
@ApiExample({ name: 'Success', request: {}, response: {} })
@ApiChannel({ address: 'orders.created', protocol: 'amqp', direction: 'send' })
@ApiMessage({ payload: OrderCreatedDto, headers: TraceHeadersDto })
@ApiPublishes('payment.created')
```

| Decorator | What it declares |
| --- | --- |
| `@ApiScopes` | the scopes this route requires, at `declared` confidence |
| `@ApiErrors` | the error contracts this endpoint promises, as classes |
| `@ApiStream` | that this route streams, and the type of one item |
| `@ApiSample` | a code sample you wrote, for a language or an SDK |
| `@ApiAudience` | `public`, `partner` or `internal` |
| `@ApiExample` | a named request and response pair |
| `@ApiChannel` | the message channel a handler serves |
| `@ApiMessage` | the payload and headers of that channel's message |
| `@ApiPublishes` | the events this handler emits, by address |

### Why `@ApiStream` has to exist

```ts
@Controller('orders')
export class OrdersController {
  @Sse('watch')
  @ApiStream({ itemType: OrderEventDto, kind: 'sse' })
  watch(): Observable<MessageEvent<OrderEventDto>> {
    return orderEvents;
  }
}
```

`@Sse` alone is enough for the reference to know the route streams: the framework writes its
own metadata key and that is read. What cannot be read is `OrderEventDto`. TypeScript generics
do not survive compilation, so `Observable<MessageEvent<OrderEventDto>>` is `Observable` at
runtime and nothing more. There is no reflection level at which that type comes back.

So the priority is <!-- gen: count:list -->four<!-- /gen --> reads and no guesses:

1. `@ApiStream({ itemType })`, which is `declared` and authoritative
2. `itemSchema` from OpenAPI 3.2 in the document, also `declared`
3. a compile time AST plugin, which is `inferred` and best effort
4. nothing, which produces a `doctor` warning under the rule `stream-unspecified`

Level 4 emits no field at all. An empty schema or `any` in its place would be a guess dressed
as a fact.

### `@ApiErrors` and the three groups

An endpoint's error contracts are never one flat list, because <!-- gen: count:list -->three<!-- /gen --> different things are
being said:

```ts
@Controller('orders')
export class OrdersController {
  @Get(':id')
  @ApiErrors(OrderNotFoundError)
  findOne(@Param('id') id: string): OrderDto {
    return orders.byId(id);
  }
}
```

- **What the endpoint promises.** `@ApiErrors` above: a 404 with a body shape.
- **What follows from what is standing in front of it.** A guard implies 401 and 403. A rate
  limiter implies 429. Nobody wrote those and they are true anyway.
- **What the application can answer with anywhere.** The 500 your global filter renders, which
  the host declares once.

Merging those into one list of status codes destroys the difference, and the difference is the
product. Note also what is not on that list: the full set of errors an endpoint can throw is
not derivable from your exception filters. A filter says "if X happens, render it this way",
never "this endpoint can produce X".

### Generic response wrappers

```ts
@Controller('cats')
export class CatsController {
  @Get()
  @ApiOkResponse(paginated(CatDto))
  list(): unknown {
    return cats.page();
  }
}
```

The synthetic schema is named deterministically, `PaginatedCatDto` and `EnvelopeOrderDto`,
never `PaginatedResponseDto_1`. The pair is cached, so `components.schemas` never holds two
copies. A name collision is a build error naming both sources, not a silent win for whichever
was registered last, because a client SDK generated from a document with two `PaginatedCatDto`
is not debuggable.

The body is merged into your document before normalization, so the specification you serve at
`/docs/openapi.json` and the model the page renders describe one document. A schema added only
to the model would be a schema missing from the file an SDK generator downloads.

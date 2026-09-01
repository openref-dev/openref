## Events

HTTP endpoints and message channels in one reference, from one application.

```ts
OpenRefModule.forRoot({
  documents: [
    {
      id: 'events',
      route: '/docs/events',
      kind: 'events',
      title: 'Orders events',
      servers: [
        { protocol: 'kafka', host: 'kafka.example.com:9092' },
        { protocol: 'amqp', host: 'rabbit.example.com:5672' },
      ],
    },
  ],
  runtime: { collectors: [guardsCollector(), declarationsCollector()] },
});
```

An events document carries no `document` member, because there is nothing to hand it. It is
synthesized from the application: the channels are discovered from your handlers, and the
AsyncAPI 3 document is written from what was found. That is why an events entry lives in
`forRoot` and not in `setup`.

### What is discovered, and what you have to declare

Discovered from the framework's own metadata:

```ts
@Injectable()
export class OrdersProjector {
  @MessagePattern('orders.get', Transport.KAFKA)
  get(): OrderDto {
    return orders.latest();
  }

  @EventPattern('orders.created', Transport.KAFKA)
  created(): void {
    orders.refresh();
  }
}
```

Declared, because nothing about it is readable:

```ts
@Injectable()
export class RefundsProjector {
  @ApiChannel({ address: 'billing.refunded', protocol: 'amqp', summary: 'A refund went out' })
  @ApiMessage({ payload: RefundDto })
  refunded(): void {
    refunds.refresh();
  }
}
```

`@ApiMessage({ payload: RefundDto })` contributes the class name, which resolves against the
schemas you pass on the entry:

```ts
OpenRefModule.forRoot({
  documents: [
    { id: 'events', route: '/docs/events', kind: 'events', schemas: openApiSchemas },
  ],
});
```

That is usually the `components.schemas` your HTTP document already built, so a DTO is
described once and both sides point at the same schema. A payload name nothing answers reaches
`doctor` rather than being invented.

### One graph, not two documents side by side

```ts
@Controller('orders')
export class OrdersController {
  @Post()
  @ApiPublishes('orders.created')
  create(@Body() body: CreateOrderDto): OrderDto {
    return orders.create(body);
  }
}
```

`@ApiPublishes` records that this HTTP endpoint emits that event, so the reference can draw the
edge: this endpoint publishes this channel, and these handlers receive it. Channels an
application only sends to and never receives are drawn as ends outside the estate, and in a
federation a name no document in the federation declares is labelled as exactly that, rather
than left looking like a broken link.

### On the input side

AsyncAPI 3.0 and 3.1 are accepted. AsyncAPI 2.x is not, and that is a stated non-goal.

Multi Format Schema is supported. Avro and Protobuf payloads are carried with their dialect
marked rather than converted to JSON Schema, because converting them would silently change what
the contract says. Traits merge by the specification's own rule.

A document that declares both `openapi` and `asyncapi` at its root is refused naming both
members, rather than being read as one of them and quietly losing the other half.

# Events

HTTP endpoints and message channels in one reference, from one application.

```bash
pnpm --filter @openref/example-events start
```

What it serves:

| Address | What it is |
| --- | --- |
| `/docs` | the HTTP reference |
| `/docs/events` | the events reference, synthesized from this application's handlers |
| `/docs/events/asyncapi.json` | the AsyncAPI 3 document that was synthesized |

## What to look at

`POST /orders` carries `@ApiPublishes('orders.created')`, and `OrdersProjector.onCreated` receives
that channel. That edge is the thing neither document states on its own: the specification
describes shapes, and only the application knows that this endpoint is what puts a message on that
topic.

Both channels here are declared with `@ApiChannel`. A handler carrying
`@MessagePattern('orders.created', Transport.KAFKA)` is discovered from the framework's own
metadata with no decorator of ours, and that form is left out only so this example installs
nothing the others do not. What no form can discover is the payload type, which is why
`@ApiMessage({ payload: OrderDto })` exists.

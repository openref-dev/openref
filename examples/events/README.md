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

Both channels here are declared with `@ApiChannel`, on `OrdersProjector`, which is a plain
`@Injectable()` provider and neither a controller nor a WebSocket gateway. That is the third class
kind SPEC 8.3 reads the decorator on, and until 2026-09-04 it was the one kind the walk did not
reach: this example served `"channels":{}` while this page said otherwise. A handler carrying
`@MessagePattern('orders.created', Transport.KAFKA)` is discovered from the framework's own
metadata with no decorator of ours, and that form is left out only so this example installs
nothing the others do not. What no form can discover is the payload type, which is why
`@ApiMessage({ payload: OrderDto })` exists.

`GET /docs/events/asyncapi.json` answers with both channels on it, `orders.created` on the kafka
server and `orders.shipped` on the amqp one, which is what
`tools/docs-site/test/integration/example-applications.spec.ts` asserts about this example rather
than only that a page comes back.

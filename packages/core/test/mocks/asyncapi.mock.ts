/**
 * One AsyncAPI document written twice, once declaring 3.0 and once declaring 3.1.
 *
 * THE PAIR IS NOT THE SAME KIND OF PAIR AS THE OPENAPI ONE, AND THAT IS A FACT ABOUT THE
 * SPECIFICATIONS RATHER THAN ABOUT THE FIXTURE. OpenAPI 3.0 and 3.1 write the same API with
 * different keywords, so `createOpenApi30` and `createOpenApi31` differ in `nullable` and in
 * `example` and the normalizer earns the equality by uplifting them. AsyncAPI 3.1 is a backwards
 * compatible minor of 3.0 whose whole delta is one more protocol binding, per SPEC 8.1, and a
 * binding is carried verbatim whatever it is called. So the two bodies here are identical and
 * the property the pair proves is the one that is actually available: the version string is read
 * to accept or refuse the document and never reaches the IR.
 *
 * The 3.1 delta itself is covered separately, by a document carrying a `ros2` binding.
 */

/** The body both versions share: two channels, four protocols, two raw dialects. */
function createEventsBody(): Record<string, unknown> {
  return {
    info: {
      title: 'Orders Events',
      version: '1.4.0',
      description: 'Events the orders service publishes and consumes',
      tags: [{ name: 'orders' }, { name: 'shipping' }],
    },
    servers: {
      broker: {
        host: 'kafka.example.com:9092',
        protocol: 'kafka',
        protocolVersion: '3.5',
        description: 'production broker',
        bindings: { kafka: { schemaRegistryUrl: 'https://registry.example.com' } },
      },
      websocket: {
        host: 'ws.example.com',
        pathname: '/events',
        protocol: 'wss',
        variables: { tenant: { default: 'public', enum: ['public', 'private'] } },
      },
    },
    channels: {
      orderPlaced: {
        address: 'orders.placed',
        title: 'Order placed',
        summary: 'An order has been accepted',
        tags: [{ name: 'orders' }],
        servers: [{ $ref: '#/servers/broker' }],
        bindings: { kafka: { topic: 'orders.placed', partitions: 12 } },
        messages: { orderPlaced: { $ref: '#/components/messages/OrderPlaced' } },
        'x-openref-audience': 'partner',
      },
      shipmentDispatched: {
        address: 'shipping/{shipmentId}/dispatched',
        tags: [{ name: 'shipping' }],
        servers: [{ $ref: '#/servers/websocket' }],
        bindings: {
          ws: { method: 'GET' },
          mqtt: { qos: 1, retain: false },
          amqp: { is: 'routingKey', exchange: { name: 'shipping', type: 'topic' } },
        },
        messages: {
          dispatched: {
            name: 'ShipmentDispatched',
            contentType: 'avro/binary',
            payload: {
              schemaFormat: 'application/vnd.apache.avro;version=1.9.0',
              schema: {
                type: 'record',
                name: 'ShipmentDispatched',
                fields: [
                  { name: 'id', type: 'string' },
                  { name: 'carrier', type: ['null', 'string'], default: null },
                ],
              },
            },
          },
          receipt: {
            name: 'ShipmentReceipt',
            payload: {
              schemaFormat: 'application/vnd.google.protobuf;version=3',
              schema: 'message ShipmentReceipt { string id = 1; int32 parcels = 2; }',
            },
          },
        },
      },
    },
    operations: {
      publishOrderPlaced: {
        action: 'send',
        channel: { $ref: '#/channels/orderPlaced' },
        summary: 'Publish an order placed event',
        bindings: { kafka: { groupId: { type: 'string' } } },
        messages: [{ $ref: '#/channels/orderPlaced/messages/orderPlaced' }],
      },
      onShipmentDispatched: {
        action: 'receive',
        channel: { $ref: '#/channels/shipmentDispatched' },
        description: 'Consumed by the notification service',
      },
    },
    components: {
      messages: {
        OrderPlaced: {
          name: 'OrderPlaced',
          title: 'Order placed',
          summary: 'One accepted order',
          contentType: 'application/json',
          correlationId: {
            location: '$message.header#/correlationId',
            description: 'ties an event to the request that caused it',
          },
          headers: {
            type: 'object',
            properties: { 'x-request-id': { type: 'string' } },
          },
          payload: { $ref: '#/components/schemas/Order' },
          bindings: { kafka: { key: { type: 'string' } } },
          examples: [
            {
              name: 'accepted',
              summary: 'a simple order',
              headers: { 'x-request-id': 'a1b2' },
              payload: { id: 'ord_1', total: 42 },
            },
          ],
        },
      },
      schemas: {
        Order: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
            total: { type: 'number' },
            customer: { $ref: '#/components/schemas/Customer' },
          },
        },
        Customer: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string' } },
        },
      },
    },
  };
}

/** The document declaring AsyncAPI 3.0. */
export function createAsyncApi30(): Record<string, unknown> {
  return { asyncapi: '3.0.0', ...createEventsBody() };
}

/** The same document declaring AsyncAPI 3.1. */
export function createAsyncApi31(): Record<string, unknown> {
  return { asyncapi: '3.1.0', ...createEventsBody() };
}

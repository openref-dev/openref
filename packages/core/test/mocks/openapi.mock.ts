/**
 * A pair of documents that describe the same API, one written in OpenAPI 3.0 and one in 3.1, plus
 * a 3.2 document using the fields 3.2 adds.
 *
 * The pair is the fixture for the claim that a version difference is invisible downstream of
 * `core`: both must normalize to the same IR, hash included.
 */

/** OpenAPI 3.0 form: `nullable`, a single `example`, flat tags. */
export function createOpenApi30(): Record<string, unknown> {
  return {
    openapi: '3.0.3',
    info: { title: 'Orders API', version: '1.0.0' },
    tags: [{ name: 'orders' }],
    servers: [{ url: 'https://api.example.com', description: 'production' }],
    paths: {
      '/orders': {
        get: {
          operationId: 'OrdersController_findAll',
          summary: 'List orders',
          tags: ['orders'],
          parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Order' } },
              },
            },
          },
        },
      },
      '/orders/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: {
          operationId: 'OrdersController_findOne',
          tags: ['orders'],
          responses: { '404': { description: 'not found' }, '200': { description: 'ok' } },
        },
      },
    },
    components: {
      schemas: {
        Order: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', nullable: true, example: 'abc' },
            total: { type: 'number' },
          },
        },
      },
    },
  };
}

/** OpenAPI 3.1 form of the same API: a type union with `null`, `examples`. */
export function createOpenApi31(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: { title: 'Orders API', version: '1.0.0' },
    tags: [{ name: 'orders' }],
    servers: [{ url: 'https://api.example.com', description: 'production' }],
    paths: {
      '/orders': {
        get: {
          operationId: 'OrdersController_findAll',
          summary: 'List orders',
          tags: ['orders'],
          parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Order' } },
              },
            },
          },
        },
      },
      '/orders/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: {
          operationId: 'OrdersController_findOne',
          tags: ['orders'],
          responses: { '404': { description: 'not found' }, '200': { description: 'ok' } },
        },
      },
    },
    components: {
      schemas: {
        Order: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: ['string', 'null'], examples: ['abc'] },
            total: { type: 'number' },
          },
        },
      },
    },
  };
}

/** OpenAPI 3.2: `itemSchema`, `additionalOperations`, the `query` method, hierarchical tags. */
export function createOpenApi32(): Record<string, unknown> {
  return {
    openapi: '3.2.0',
    info: { title: 'Events API', version: '2.0.0' },
    tags: [{ name: 'platform' }, { name: 'events', parent: 'platform', summary: 'Event streams' }],
    paths: {
      '/events': {
        get: {
          tags: ['events'],
          responses: {
            '200': {
              description: 'a stream of events',
              itemSchema: { $ref: '#/components/schemas/Event' },
              content: { 'text/event-stream': {} },
            },
          },
        },
        query: {
          tags: ['events'],
          summary: 'Query events',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          responses: { '200': { description: 'ok' } },
        },
        additionalOperations: {
          PURGE: {
            tags: ['events'],
            summary: 'Purge the stream',
            responses: { '204': { description: 'purged' } },
          },
        },
      },
    },
    components: {
      schemas: { Event: { type: 'object', properties: { id: { type: 'string' } } } },
    },
  };
}

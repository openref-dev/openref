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

/**
 * The document the determinism suite could not reach before T016.
 *
 * The 1000 shuffle check was taken over a fixture with no external reference in it, so every id
 * it ever produced came from one id space, and the construction of the other space was never
 * under test. F1 lived from T002 to T016 inside that blind spot. The corpus of SPEC 21 does not
 * close it either: not one of its documents carries an external `$ref`.
 *
 * `common.yaml` hashes to `20b4b690`, which is the digest the forged fixture below imitates.
 */
export function createExternalReferenceSource(): {
  readonly root: Record<string, unknown>;
  readonly externalDocuments: Readonly<Record<string, unknown>>;
} {
  return {
    root: {
      openapi: '3.1.0',
      info: { title: 'Orders API', version: '2.0.0' },
      paths: {
        '/orders': {
          get: {
            operationId: 'listOrders',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: 'common.yaml#/components/schemas/Order' } },
                },
              },
              '404': {
                description: 'gone',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Problem' } },
                },
              },
            },
          },
          post: {
            operationId: 'createOrder',
            requestBody: {
              content: {
                'application/json': { schema: { $ref: 'money.yaml#/components/schemas/Money' } },
              },
            },
            responses: {
              '201': {
                description: 'made',
                content: {
                  'application/json': { schema: { $ref: 'common.yaml#/components/schemas/Order' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Problem: {
            type: 'object',
            properties: { detail: { type: 'string' }, status: { type: 'integer' } },
          },
          Order: {
            type: 'object',
            title: 'the local order',
            properties: { id: { type: 'string' } },
          },
        },
      },
    },
    externalDocuments: {
      'common.yaml': {
        components: {
          schemas: {
            Order: {
              type: 'object',
              title: 'THE REAL ORDER',
              properties: {
                id: { type: 'string' },
                money: { $ref: 'money.yaml#/components/schemas/Money' },
              },
            },
          },
        },
      },
      'money.yaml': {
        components: {
          schemas: {
            Money: { type: 'string', format: 'decimal' },
          },
        },
      },
    },
  };
}

/**
 * The same document, with an internal schema named to look like the external one's id.
 *
 * `~x20b4b690~Order` is exactly the id `common.yaml#/components/schemas/Order` is filed under.
 * Under the old scheme the equivalent name, `Order__20b4b690`, took that id and the registry
 * dropped whichever body arrived second, so the graph and the hash followed the order of two
 * properties. Under SPEC 5.1.1 as amended the name escapes into the internal space and the two
 * coexist, which is what this fixture is for.
 */
export function createForgedExternalIdSource(): {
  readonly root: Record<string, unknown>;
  readonly externalDocuments: Readonly<Record<string, unknown>>;
} {
  const base = createExternalReferenceSource();
  const components = base.root.components as { schemas: Record<string, unknown> };

  return {
    root: {
      ...base.root,
      components: {
        schemas: {
          ...components.schemas,
          '~x20b4b690~Order': { type: 'string', title: 'ATTACKER BODY' },
        },
      },
      paths: {
        ...(base.root.paths as Record<string, unknown>),
        '/forged': {
          get: {
            operationId: 'forged',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/~x20b4b690~Order' },
                  },
                },
              },
            },
          },
        },
      },
    },
    externalDocuments: base.externalDocuments,
  };
}

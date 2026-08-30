/**
 * Documents the agent suite reads, built through the real normalizer.
 *
 * NOTHING HERE HAND BUILDS AN `IRDocument`. Every case in this package is about what a machine
 * reader is told about a real document, and a hand assembled IR would let a case pass over a shape
 * the normalizer never produces: an id that no `pathSegmentOf` would write, a hash nothing
 * computed, a node map in an order no document put it in. `normalizeSpecification` is the one way
 * in, exactly as the served side uses it.
 */

import { normalizeSpecification, type IRDocument, type IRNode } from '@openref/core';

/**
 * The bidirectional override of SPEC 19.1, written as an escape because a literal is refused.
 *
 * The `text-source` gate rejects all twelve bidirectional controls in a source file of this
 * repository, and this file is exactly about proving that the artefact does not carry one, so the
 * escape compiles to the same character and leaves this file readable in the order it is written.
 */
export const OVERRIDE = '\u202E';

/** A C0 control that survives every escaping and means something to a terminal. */
export const ESCAPE_CHARACTER = '\u001B';

/** An OpenAPI document with a safe operation, a mutating one and an internal one. */
export function orderSource(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Orders',
      version: '1.0.0',
      description: 'A very small API.\n\nWith a second paragraph and `code`.',
    },
    servers: [{ url: 'https://api.example.test' }],
    tags: [{ name: 'orders' }],
    paths: {
      '/orders': {
        get: {
          operationId: 'listOrders',
          summary: 'List orders',
          tags: ['orders'],
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }],
          responses: {
            '200': {
              description: 'The orders',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } },
            },
          },
        },
        post: {
          operationId: 'createOrder',
          summary: 'Create an order',
          tags: ['orders'],
          security: [{ bearer: ['orders:write'] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } },
          },
          responses: { '201': { description: 'Created' } },
        },
      },
      // THE INTERNAL OPERATION CARRIES A RESPONSE BODY WITH NO EXAMPLE ON PURPOSE, so the drift
      // engine produces a `missing-example` finding about it. Without one, the case that proves a
      // finding on an internal node does not leak through the health report would be asserting
      // the absence of something that was never there.
      '/admin/impersonate': {
        post: {
          operationId: 'impersonate',
          summary: 'Act as another account',
          'x-openref-audience': 'internal',
          responses: {
            '200': {
              description: 'The impersonated session',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      schemas: {
        Order: {
          type: 'object',
          description: 'One order.',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Identity of the order.' },
            amount: { type: 'integer' },
          },
        },
      },
    },
  };
}

/** The same document, normalized. */
export function orderDocument(): IRDocument {
  return normalizeSpecification(orderSource());
}

/** An AsyncAPI document, so the channel rules have a channel to be about. */
export function channelSource(): Record<string, unknown> {
  return {
    asyncapi: '3.0.0',
    info: { title: 'Order events', version: '2.0.0' },
    channels: {
      orderCreated: {
        address: 'orders.created',
        messages: { created: { $ref: '#/components/messages/OrderCreated' } },
      },
    },
    operations: {
      receiveOrderCreated: {
        action: 'receive',
        channel: { $ref: '#/channels/orderCreated' },
        summary: 'An order was created',
      },
    },
    components: {
      messages: {
        OrderCreated: {
          name: 'OrderCreated',
          contentType: 'application/json',
          payload: { type: 'object', properties: { id: { type: 'string' } } },
        },
      },
    },
  };
}

/** The events document, normalized. */
export function channelDocument(): IRDocument {
  return normalizeSpecification(channelSource());
}

/**
 * The order document with the runtime facts a collector pass would have attached.
 *
 * ATTACHED TO A NORMALIZED DOCUMENT RATHER THAN BUILT BESIDE ONE, which is what `runRuntimePass`
 * in `@openref/nest` does and is the only shape this package ever sees. Every fact carries its
 * confidence and its collector, per SPEC 6.1, because a fact without them is not representable and
 * the file that prints them must be tested against the real shape.
 *
 * @returns The document, with facts on GET /orders and a runtime meta on the document
 */
export function documentWithFacts(): IRDocument {
  const document = orderDocument();
  const node = document.nodes.get('get-orders');
  if (node?.kind !== 'operation') throw new Error('the fixture lost the node');

  const withFacts: IRNode = {
    ...node,
    runtime: {
      scopes: { value: ['orders:read'], confidence: 'declared', collector: 'scopesCollector' },
      roles: { value: ['support'], confidence: 'derived', collector: 'rolesCollector' },
      rateLimit: {
        value: { limit: 10, ttlMs: 60000 },
        confidence: 'derived',
        collector: 'throttlerCollector',
      },
      timeout: { value: { ms: 5000 }, confidence: 'derived', collector: 'timeoutCollector' },
      requiredHeaders: {
        value: ['x-tenant'],
        confidence: 'derived',
        collector: 'headersCollector',
      },
      statusCode: { value: 200, confidence: 'declared', collector: 'declarationsCollector' },
      streaming: {
        value: { transport: 'sse', itemSchema: { kind: 'named', schemaId: 'Order' } },
        confidence: 'declared',
        collector: 'streamCollector',
      },
      guards: [
        {
          name: 'JwtAuthGuard',
          scope: 'route',
          confidence: 'derived',
          collector: 'guardsCollector',
        },
      ],
    },
  };

  return {
    ...document,
    nodes: new Map(
      [...document.nodes.entries()].map(([id, held]) => [id, id === node.id ? withFacts : held]),
    ),
    runtime: { collectors: ['scopesCollector', 'throttlerCollector'] },
  };
}

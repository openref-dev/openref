import { normalizeOpenApiDocument, type IRDocument } from '@openref/core';

/**
 * Documents the render tests work against.
 *
 * They go through the real normalizer rather than being hand written IR. A hand written
 * document would let the renderer be tested against a shape the normalizer never produces,
 * which is exactly the class of bug that survives to production.
 */

/** A small document with prose, a fenced block, parameters, a body and two responses. */
export function smallDocument(): IRDocument {
  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: {
      title: 'Orders API',
      version: '2.1.0',
      description: 'Order management.\n\n```json\n{ "ok": true }\n```\n',
    },
    servers: [{ url: 'https://api.example.com' }],
    tags: [{ name: 'orders', description: 'Everything about orders' }],
    paths: {
      '/orders': {
        get: {
          operationId: 'listOrders',
          summary: 'List orders',
          description: 'Returns **every** order.\n\n```yaml\nlimit: 10\n```\n',
          tags: ['orders'],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              required: false,
              description: 'How many to return.',
              schema: { type: 'integer' },
            },
            { name: 'X-Trace', in: 'header', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'A page of orders',
              content: {
                'application/json': {
                  schema: { type: 'array', items: { $ref: '#/components/schemas/Order' } },
                },
              },
            },
            '404': { description: 'Nothing there' },
          },
        },
        post: {
          operationId: 'createOrder',
          summary: 'Create an order',
          tags: ['orders'],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Order' } },
            },
          },
          responses: { '201': { description: 'Created' } },
          security: [{ apiKey: [] }],
        },
      },
    },
    components: {
      securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'X-Key' } },
      schemas: {
        Order: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            total: { type: 'number' },
          },
        },
      },
    },
  });
}

/** A document whose prose is hostile in every way markdown allows. */
export function hostileDocument(): IRDocument {
  const payload =
    'Careful.\n\n<script>globalThis.pwned = true;</script>\n\n' +
    '<img src=x onerror="globalThis.pwned = true">\n\n' +
    '<div style="position:fixed;inset:0">covered</div>\n\n' +
    '[click](javascript:globalThis.pwned=true)\n\n' +
    '<iframe src="https://evil.example"></iframe>\n\n' +
    '```html\n<script>globalThis.pwned = true;</script>\n```\n';

  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Hostile', version: '1.0.0', description: payload },
    paths: {
      '/x': {
        get: {
          operationId: 'getX',
          description: payload,
          responses: { '200': { description: payload } },
        },
      },
    },
  });
}

/**
 * A document with `count` operations, for the prerender budget.
 *
 * Every operation carries a description and a response body so that the measured work is
 * a real page rather than an empty one.
 *
 * @param count - Number of operations
 * @returns The normalized document
 */
export function largeDocument(count: number): IRDocument {
  const paths: Record<string, unknown> = {};

  for (let index = 0; index < count; index += 1) {
    paths[`/resource-${String(index)}`] = {
      get: {
        operationId: `getResource${String(index)}`,
        summary: `Resource ${String(index)}`,
        description: `Reads resource **${String(index)}**.`,
        tags: [`group-${String(index % 20)}`],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'expand', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Found',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Resource' } },
            },
          },
        },
      },
    };
  }

  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Large', version: '1.0.0' },
    paths,
    components: {
      schemas: {
        Resource: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string' } },
        },
      },
    },
  });
}

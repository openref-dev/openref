import {
  buildHealthReport,
  normalizeOpenApiDocument,
  type IRDocument,
  type IRNode,
  type IRNodeRuntime,
} from '@openref/core';

/**
 * Documents this theme's tests draw.
 *
 * WRITTEN HERE RATHER THAN IMPORTED FROM `@openref/render`'s FIXTURES, and the reason is the same
 * one that makes this package the proof T032 was scheduled for. A theme author has this package's
 * public surface and a normalizer, and nothing else; a test reaching into the renderer's own
 * fixtures would be testing this theme in a place a theme author cannot stand.
 *
 * They go through the real normalizer rather than being hand written IR, because a hand written
 * document lets a component be tested against a shape the normalizer never produces.
 */

/** An operation with parameters, a body, two responses, a scheme and a call sample. */
export function apiDocument(): IRDocument {
  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: {
      title: 'Orders API',
      version: '2.1.0',
      description: 'Order management.\n\n```json\n{ "ok": true }\n```\n',
    },
    servers: [{ url: 'https://api.example.com' }],
    components: {
      securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'X-Key' } },
      schemas: {
        Order: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            total: { type: 'number' },
            lines: { type: 'array', items: { $ref: '#/components/schemas/Line' } },
          },
        },
        Line: {
          type: 'object',
          properties: { sku: { type: 'string' }, quantity: { type: 'integer' } },
        },
      },
    },
    paths: {
      '/orders': {
        get: {
          operationId: 'listOrders',
          summary: 'List orders',
          description: 'Returns **every** order.',
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
          'x-codeSamples': [
            { lang: 'bash', label: 'cURL', source: 'curl https://api.example.com/orders' },
            { lang: 'python', source: 'httpx.get("https://api.example.com/orders")' },
          ],
        },
        post: {
          operationId: 'createOrder',
          summary: 'Create an order',
          security: [{ apiKey: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } },
          },
          responses: { '201': { description: 'Created' } },
        },
      },
    },
  });
}

/** The id of the operation the runtime facts hang on. */
export function nodeId(document: IRDocument = apiDocument()): string {
  const id = [...document.nodes.keys()].find((key) => key.startsWith('get'));
  if (id === undefined) throw new Error('the fixture lost its operation');
  return id;
}

/** The id of the operation that declares a body and a scheme. */
export function postNodeId(document: IRDocument = apiDocument()): string {
  const id = [...document.nodes.keys()].find((key) => key.startsWith('post'));
  if (id === undefined) throw new Error('the fixture lost its operation');
  return id;
}

/**
 * The same document with an application behind it: facts, provenance and a finding.
 *
 * Every fact carries `confidence` and `collector`, per SPEC 6.1, because a fact without
 * provenance is not a fact this product is allowed to draw.
 */
export function runtimeDocument(): IRDocument {
  const document = apiDocument();
  const id = nodeId(document);
  const node = document.nodes.get(id);
  if (node?.kind !== 'operation') throw new Error('the fixture lost its operation');

  const runtime: IRNodeRuntime = {
    guards: [
      { name: 'ApiKeyGuard', scope: 'route', confidence: 'derived', collector: 'guardsCollector' },
    ],
    scopes: { value: ['orders:read'], confidence: 'declared', collector: 'scopesCollector' },
    rateLimit: {
      value: { limit: 20, ttlMs: 60000 },
      confidence: 'derived',
      collector: 'throttlerCollector',
    },
  };

  const withRuntime: IRNode = { ...node, runtime };
  const nodes = new Map(document.nodes);
  nodes.set(id, withRuntime);

  const withNodes: IRDocument = { ...document, nodes };
  return { ...withNodes, health: buildHealthReport(withNodes) };
}

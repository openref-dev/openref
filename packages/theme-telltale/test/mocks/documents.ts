import {
  buildHealthReport,
  normalizeAsyncApiDocument,
  normalizeOpenApiDocument,
  type IRDocument,
  type IRNode,
  type IRNodeRuntime,
  type IRService,
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
        // THE SCHEMA THAT PROVOKES THE READING ROWS NO OTHER FIXTURE REACHES, added by `T054`.
        // `Order` above is a flat object with a plain required list, so the shapes page swept
        // since the pre `T049` slice drew only the ordinary row: five class names of SPEC 11 were
        // emitted by no swept render, were therefore in no list, and were styled by no telltale
        // rule while every check in the tree stayed green. Each member below is here for exactly
        // one of them: `oneOf` for the variant and its selector line, `patternProperties` for the
        // pattern row, and `if`/`then` for the conditional requiredness.
        Payment: {
          type: 'object',
          required: ['method'],
          properties: {
            method: { type: 'string', enum: ['card', 'invoice'] },
            card: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
            labels: { type: 'object', patternProperties: { '^x-': { type: 'string' } } },
            invoiceRef: { type: 'string' },
          },
          if: { properties: { method: { const: 'invoice' } } },
          then: { required: ['invoiceRef'] },
        },
        // AND THE ONE THAT PROVOKES THE ABSENCE, which is a row family of its own: a body a
        // document declared and left with nothing in it draws a sentence rather than a table.
        Empty: {},
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

/** The id the federated fixture registers its one service under. */
export const SERVICE_ID = 'orders';

/**
 * The same document as one service of a federation, per SPEC 15.3.
 *
 * Augmented the way `runtimeDocument` augments, from core types alone: a theme author cannot
 * run the federation merge, but `IRDocument.services` is public IR, and the service page is
 * drawn from it. The service quotes the document's own header, so every fact on the card is a
 * fact the fixture really carries.
 */
export function federatedDocument(): IRDocument {
  const document = apiDocument();
  const service: IRService = {
    id: SERVICE_ID,
    documentId: document.id,
    documentHash: document.hash,
    kind: document.kind,
    info: document.info,
    servers: document.servers,
    prefix: '/orders',
  };
  return { ...document, services: [service] };
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

/**
 * An AsyncAPI 3.1 document with one channel, for the channel page of `T050`.
 *
 * IT IS IN THE SWEEP BECAUSE THE CHANNEL PAGE WOULD OTHERWISE SHIP OUTSIDE IT. A channel is a
 * node, so its page is the `node` kind and the total record over `PageKind` cannot see that a
 * whole family of markup arrived; the two documents already swept as `node` pages are both
 * OpenAPI, so every class name the channel sections emit would have been on no list and styled by
 * no rule. That is the third instance of the failure the record was bound to the union to prevent,
 * and the answer to it is a render rather than a wider record.
 *
 * It writes one of everything the three sections draw: a templated address with its variables, a
 * protocol and a server, bindings, both directions, a reply, a correlation expression, tags, a
 * JSON Schema payload that reads as rows, an Avro payload that reads as source, and a declared
 * example.
 *
 * @returns The document
 */
export function eventsDocument(): IRDocument {
  return normalizeAsyncApiDocument({
    asyncapi: '3.1.0',
    info: { title: 'Orders events', version: '4.2.0', description: 'What orders emit.' },
    defaultContentType: 'application/json',
    servers: {
      broker: {
        host: 'kafka.example.com:9092',
        protocol: 'kafka',
        protocolVersion: '3.7',
        description: 'The production cluster',
      },
    },
    channels: {
      requests: {
        address: 'orders.{tenant}.requests',
        title: 'Costing requests',
        description: 'Where a costing request is placed.',
        tags: [{ name: 'orders' }],
        parameters: {
          tenant: {
            description: 'Which tenant the topic belongs to.',
            enum: ['acme', 'globex'],
            default: 'acme',
            examples: ['acme'],
            location: '$message.header#/TENANT',
          },
        },
        bindings: { kafka: { partitions: 3 } },
        messages: {
          CostingRequest: {
            name: 'CostingRequestV1',
            title: 'Costing request',
            summary: 'One costing request.',
            description: 'Sent by a store, answered on the replies channel.',
            correlationId: { location: '$message.header#/REQUEST_ID' },
            tags: [{ name: 'costing' }],
            headers: {
              type: 'object',
              required: ['REQUEST_ID'],
              properties: { REQUEST_ID: { type: 'string' } },
            },
            payload: {
              type: 'object',
              required: ['sku'],
              properties: { sku: { type: 'string' }, quantity: { type: 'integer' } },
            },
            examples: [
              {
                name: 'one line',
                summary: 'A single item request',
                payload: { sku: 'AB-1', quantity: 2 },
              },
            ],
          },
        },
      },
      replies: {
        address: 'orders.replies',
        title: 'Costing replies',
        messages: {
          CostingResponse: {
            title: 'Costing response',
            contentType: 'avro/binary',
            payload: {
              schemaFormat: 'application/vnd.apache.avro;version=1.9.0',
              schema: {
                type: 'record',
                name: 'CostingResponse',
                fields: [{ name: 'total', type: ['null', 'long'], default: null }],
              },
            },
          },
        },
      },
    },
    operations: {
      placeCostingRequest: {
        action: 'send',
        channel: { $ref: '#/channels/requests' },
        summary: 'Place a costing request',
        tags: [{ name: 'costing' }],
        bindings: { kafka: { groupId: { type: 'string' } } },
        reply: {
          channel: { $ref: '#/channels/replies' },
          address: { location: '$message.header#/REPLY_TOPIC' },
        },
      },
      readCostingReply: {
        action: 'receive',
        channel: { $ref: '#/channels/replies' },
        summary: 'Read a costing reply',
      },
    },
  });
}

/**
 * Node ids of the two channels, in the order the sweep draws them.
 *
 * BOTH ARE SWEPT BECAUSE THEY DRAW DIFFERENT MARKUP. The templated one carries the address
 * variables, the `send` direction, the reply and a payload that reads as rows; the other carries
 * the `receive` direction and a payload that reads as Avro source. One of the two would leave half
 * the family on no list, which is the shape of the failure this sweep exists to catch.
 *
 * @returns The templated channel first, then the reply channel
 */
export function channelNodeIds(): readonly [string, string] {
  const ids = [...eventsDocument().nodes.keys()];
  const templated = ids.find((id) => id.includes('tenant'));
  const replies = ids.find((id) => id !== templated);
  if (templated === undefined || replies === undefined) {
    throw new Error('the events fixture must carry two channels');
  }
  return [templated, replies];
}

/**
 * The events document with the two topology cases its own channels cannot produce.
 *
 * WHY A SECOND DOCUMENT RATHER THAN A SECOND CHANNEL. `eventsDocument` declares three edges, and
 * all three of them are live: every target it names is also a source, so nothing in it is a dead
 * end, and every edge a normalizer writes is `declared`, so no normalizer can produce an
 * `inferred` one at all, per SPEC 9.4. Those are the two states the section draws differently, so
 * a sweep over the normalized document alone would leave `oref-topology-dead` and the inferred
 * mark on no list and styled by no rule, which is exactly the fixture bound blind spot this
 * repository has now recorded three times.
 *
 * THE TWO EXTRA EDGES ARE PLANTED RATHER THAN NORMALIZED, and that is the honest way round. An
 * `inferred` edge has no producer in M5 by policy, and an event nobody consumes is a fact about an
 * estate rather than about a document, so neither is something a single AsyncAPI file can be
 * written to yield.
 *
 * @returns The events document with a dead end and an inferred edge added
 */
export function topologyDocument(): IRDocument {
  const events = eventsDocument();

  return {
    ...events,
    relationships: [
      ...events.relationships,
      {
        from: events.id,
        fromKind: 'service',
        to: 'orders.archived',
        toKind: 'event',
        type: 'publishes',
        confidence: 'declared',
      },
      {
        from: events.id,
        fromKind: 'service',
        to: 'orders.rebuilt',
        toKind: 'event',
        type: 'publishes',
        confidence: 'inferred',
      },
    ],
  };
}

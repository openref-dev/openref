import type { IRDocument, IRNode, IRNodeRuntime } from '@openref/core';
import {
  buildHealthReport,
  hashDocument,
  normalizeAsyncApiDocument,
  normalizeOpenApiDocument,
  parseSpecification,
} from '@openref/core';

/**
 * Fixtures for the headless layer.
 *
 * They go through the real normalizer rather than being hand written IR. That matters for the
 * cycle fixtures in particular: the point of those tests is that the IR genuinely carries no
 * `$cycle` marker for a cycle among named schemas, and a hand built fixture would only prove
 * that whoever wrote it left the marker out.
 */

function normalize(source: string): IRDocument {
  return normalizeOpenApiDocument(parseSpecification(source));
}

/** A small document with one tagged operation, a body, a response and a security scheme. */
export function simpleDocument(): IRDocument {
  return normalize(`
openapi: 3.1.0
info:
  title: Orders API
  version: '1.4.0'
servers:
  - url: https://api.example.com
security:
  - bearer: []
paths:
  /orders:
    get:
      operationId: listOrders
      summary: List orders
      tags: [Orders]
      parameters:
        - name: limit
          in: query
          schema: { type: integer }
        - name: X-Trace
          in: header
          schema: { type: string }
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: array
                items: { $ref: '#/components/schemas/Order' }
    post:
      operationId: createOrder
      summary: Create an order
      tags: [Orders]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Order' }
      responses:
        '201':
          description: created
  /health:
    get:
      operationId: health
      summary: Health
      deprecated: true
      responses:
        '200':
          description: ok
components:
  securitySchemes:
    bearer:
      type: http
      scheme: bearer
  schemas:
    Order:
      type: object
      required: [id]
      properties:
        id: { type: string, readOnly: true }
        note: { type: string, writeOnly: true }
        total: { type: number }
`);
}

/** Two named schemas that refer to each other. The IR carries no marker for this. */
export function mutuallyRecursiveDocument(): IRDocument {
  return normalize(`
openapi: 3.1.0
info: { title: Pair, version: '1.0.0' }
paths: {}
components:
  schemas:
    A:
      type: object
      properties:
        b: { $ref: '#/components/schemas/B' }
        name: { type: string }
    B:
      type: object
      properties:
        a: { $ref: '#/components/schemas/A' }
`);
}

/** Three named schemas in a ring, so the revisit is not the immediate parent. */
export function threeSchemaCycleDocument(): IRDocument {
  return normalize(`
openapi: 3.1.0
info: { title: Ring, version: '1.0.0' }
paths: {}
components:
  schemas:
    A:
      type: object
      properties:
        b: { $ref: '#/components/schemas/B' }
    B:
      type: object
      properties:
        c: { $ref: '#/components/schemas/C' }
    C:
      type: object
      properties:
        a: { $ref: '#/components/schemas/A' }
`);
}

/** A schema that refers to itself directly. */
export function selfRecursiveDocument(): IRDocument {
  return normalize(`
openapi: 3.1.0
info: { title: Tree, version: '1.0.0' }
paths: {}
components:
  schemas:
    Node:
      type: object
      properties:
        label: { type: string }
        children:
          type: array
          items: { $ref: '#/components/schemas/Node' }
`);
}

/** A document with a `oneOf` carrying a discriminator, so variants exist. */
export function variantDocument(): IRDocument {
  return normalize(`
openapi: 3.1.0
info: { title: Variants, version: '1.0.0' }
paths: {}
components:
  schemas:
    Card:
      type: object
      properties:
        last4: { type: string }
    Bank:
      type: object
      properties:
        iban: { type: string }
    Method:
      oneOf:
        - $ref: '#/components/schemas/Card'
        - $ref: '#/components/schemas/Bank'
      discriminator:
        propertyName: kind
        mapping:
          card: '#/components/schemas/Card'
          bank: '#/components/schemas/Bank'
`);
}

/**
 * A property written the way `@nestjs/swagger` writes one that carries a description.
 *
 * The singleton `allOf` around a reference, per SPEC 5.1.1 and retrofit T003-R2. Before that
 * retrofit this normalized to an anonymous object and the expander had no name to show, which
 * is what a reader saw in the browser on the demo.
 */
export function wrappedReferenceDocument(): IRDocument {
  return normalize(`
openapi: 3.0.3
info: { title: Wrapped, version: '1.0.0' }
paths: {}
components:
  schemas:
    CustomerDto:
      type: object
      description: The target says this.
      properties:
        id: { type: string }
    OrderDto:
      type: object
      properties:
        customer:
          allOf:
            - $ref: '#/components/schemas/CustomerDto'
          description: Who placed it.
        retries:
          allOf:
            - $ref: '#/components/schemas/Retries'
          default: 1
    Retries:
      type: integer
      default: 7
`);
}

/** What a fixture leaves out, so a test can name the state it is about. */
export interface RuntimeFixtureOptions {
  /** False to leave the host's source link template unconfigured, which is the ordinary case. */
  readonly sourceLink?: boolean;
  /** True to add the registry's own check line for a collector that did not run. */
  readonly failedCollector?: boolean;
}

/**
 * `simpleDocument` with an application behind it, per SPEC 6.
 *
 * The facts are attached the way the runtime pass attaches them and the report is built by the
 * real engine, so what a composable is tested against is the shape the engine produces rather
 * than one a fixture author imagined.
 *
 * @param options - What to leave out
 * @returns The document, with its hash retaken over the facts
 */
export function runtimeDocument(options: RuntimeFixtureOptions = {}): IRDocument {
  const base = simpleDocument();
  // Named rather than found: this fixture's own tests read `get-orders` by name, and a search
  // would quietly put the facts on `get-health` the day another operation is added above it.
  const target = 'get-orders';

  const runtime: IRNodeRuntime = {
    source: {
      controller: 'OrdersController',
      handler: 'findAll',
      file: 'src/orders.controller.ts',
      line: 42,
    },
    guards: [
      { name: 'JwtAuthGuard', scope: 'route', confidence: 'derived', collector: 'guardsCollector' },
    ],
    scopes: { value: ['orders:read'], confidence: 'declared', collector: 'scopesCollector' },
    rateLimit: {
      value: { limit: 100, ttlMs: 60_000 },
      confidence: 'derived',
      collector: 'throttlerCollector',
    },
    errors: { declared: [], runtimeDerived: [], global: [] },
  };

  const nodes = new Map<string, IRNode>();
  for (const [id, node] of base.nodes) nodes.set(id, id === target ? { ...node, runtime } : node);

  const template = 'https://github.com/org/repo/blob/abc123/{file}#L{line}';
  const withFacts: IRDocument = {
    ...base,
    nodes,
    runtime: {
      collectors: ['guardsCollector', 'scopesCollector', 'throttlerCollector'],
      ...(options.sourceLink === false ? {} : { sourceLinkTemplate: template }),
    },
  };

  const health = buildHealthReport(withFacts, {
    observation: { handledNodeIds: new Set(base.nodes.keys()) },
    // THE REGISTRY OWNS THIS LINE AND THE RULES DO NOT, per SPEC 7: a collector that threw is a
    // failed tool, and a drift row would send a reader to fix code that is not broken.
    ...(options.failedCollector === true
      ? {
          checks: [
            {
              id: 'runtime-collectors',
              label: 'collectors ran',
              passed: 2,
              total: 3,
              severity: 'warning' as const,
            },
          ],
        }
      : {}),
  });

  const complete: IRDocument = { ...withFacts, health };

  return { ...complete, hash: hashDocument(complete) };
}

/**
 * One operation declaring five of the six body forms of SPEC 14.3, in one document.
 *
 * ALL OF IT ON ONE OPERATION, deliberately: what the projection has to get right is that the
 * editor follows the media type and its schema rather than the operation, and five media types
 * on five operations would not put that under any pressure at all.
 *
 * The multipart entry is the one the task names: a file part declared by `format: binary`, a
 * JSON part declared as an object, and a third property whose part type the document states
 * itself through `encoding`, so the derived default and the declared value are both exercised.
 */
export function bodyDocument(): IRDocument {
  return normalize(`
openapi: 3.1.0
info:
  title: Uploads API
  version: '1.0.0'
servers:
  - url: https://api.example.com
paths:
  /uploads:
    post:
      operationId: createUpload
      summary: Create an upload
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                title: { type: string }
          text/plain:
            schema: { type: string }
          application/x-ndjson:
            schema: { type: string }
          application/x-www-form-urlencoded:
            schema:
              type: object
              required: [sku]
              properties:
                sku: { type: string }
                note: { type: string }
          multipart/form-data:
            schema:
              type: object
              required: [file]
              properties:
                file: { type: string, format: binary }
                metadata:
                  type: object
                  properties:
                    title: { type: string }
                tags:
                  type: array
                  items: { type: string }
                sidecar: { type: string }
            encoding:
              sidecar:
                contentType: application/xml
          application/octet-stream:
            schema: { type: string, format: binary }
      responses:
        '201':
          description: created
`);
}

/**
 * An AsyncAPI 3.1 document with one channel, for `useChannel`.
 *
 * IT EXISTS BECAUSE THE COMPOSABLE WAS DECLARED AT `T008` AND COULD NOT BE PROVEN THEN. Until
 * `T048` the IR carried no channel any normalizer produced, so the only case that could be
 * written was the narrowing one: an HTTP node yields nothing. This is the other half.
 *
 * @returns The document
 */
export function eventsDocument(): IRDocument {
  return normalizeAsyncApiDocument(
    parseSpecification(`
asyncapi: 3.1.0
info:
  title: Orders events
  version: '1.0.0'
servers:
  broker:
    host: kafka.example.com:9092
    protocol: kafka
channels:
  created:
    address: orders.created
    title: Orders created
    messages:
      OrderCreated:
        title: Order created
        payload:
          type: object
          properties:
            id:
              type: string
operations:
  publishOrderCreated:
    action: send
    channel:
      $ref: '#/channels/created'
    summary: Publish an order created event
`),
  );
}

import type { IRDocument } from '@openref/core';
import { normalizeOpenApiDocument, parseSpecification } from '@openref/core';

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

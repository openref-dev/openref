import { describe, expect, it } from 'vitest';
import { federatedSchemaId, MergeConflictError, schemaNameFromId } from '@openref/core';
import type { IRDocument, IROperation } from '@openref/core';
import { mergeDocuments } from '../../src/index';
import type { FederationConflictMode, MergeResult } from '../../src/index';
import { bearerScheme, buildDocument, namedSchema, operation } from '../mocks/documents';

/**
 * The merge engine of SPEC 15, against the four things T044 asks it to prove: two services on one
 * path under each mode, deduplication by content rather than by name, a security scheme that is
 * two schemes, and output that does not depend on the order the remotes arrived in.
 */

const MERGED = { id: 'platform', info: { title: 'Platform', version: '2026.8' } } as const;

/** Two services that both answer `GET /status`, which is the conflict SPEC 15 is written about. */
function collidingServices(): { billing: IRDocument; orders: IRDocument } {
  return {
    billing: buildDocument({
      id: 'billing-api',
      title: 'Billing',
      nodes: [operation({ id: 'get-status', path: '/status', summary: 'Billing status' })],
    }),
    orders: buildDocument({
      id: 'orders-api',
      title: 'Orders',
      nodes: [operation({ id: 'get-status', path: '/status', summary: 'Orders status' })],
    }),
  };
}

/** Merges the two colliding services under one mode. */
function mergeColliding(onConflict: FederationConflictMode): MergeResult {
  const { billing, orders } = collidingServices();
  return mergeDocuments(
    [
      { id: 'billing', document: billing },
      { id: 'orders', document: orders },
    ],
    { ...MERGED, onConflict },
  );
}

/** The operations of a merged document, by merged id. */
function operationsOf(document: IRDocument): Map<string, IROperation> {
  const operations = new Map<string, IROperation>();
  for (const [id, node] of document.nodes) {
    if (node.kind === 'operation') operations.set(id, node);
  }
  return operations;
}

describe('mergeDocuments, two services exposing the same path', () => {
  it('should keep both operations and move both addresses under namespace', () => {
    // Given two services that both answer GET /status
    // When they are merged under the default mode
    const { document, report } = mergeColliding('namespace');

    // Then both operations are there, at addresses of their own
    const operations = operationsOf(document);
    expect([...operations.keys()].sort()).toEqual(['billing_get-status', 'orders_get-status']);
    expect(operations.get('billing_get-status')?.path).toBe('/billing/status');
    expect(operations.get('orders_get-status')?.path).toBe('/orders/status');

    // And the report says which name became which, and who contested it
    const paths = report.renames.filter((rename) => rename.kind === 'path');
    expect(paths).toEqual([
      {
        kind: 'path',
        serviceId: 'billing',
        from: '/status',
        to: '/billing/status',
        reason: 'address-conflict',
        contestedBy: ['orders'],
      },
      {
        kind: 'path',
        serviceId: 'orders',
        from: '/status',
        to: '/orders/status',
        reason: 'address-conflict',
        contestedBy: ['billing'],
      },
    ]);
  });

  it('should let the first service keep the address and move the rest under first-wins', () => {
    // Given the same two services
    // When they are merged under first-wins
    const { document, report } = mergeColliding('first-wins');

    // Then the lowest service id keeps the plain address and nothing was dropped
    const operations = operationsOf(document);
    expect(operations.size).toBe(2);
    expect(operations.get('billing_get-status')?.path).toBe('/status');
    expect(operations.get('orders_get-status')?.path).toBe('/orders/status');

    // And only the service that moved is reported as having moved
    expect(report.renames.filter((rename) => rename.kind === 'path')).toEqual([
      {
        kind: 'path',
        serviceId: 'orders',
        from: '/status',
        to: '/orders/status',
        reason: 'address-conflict',
        contestedBy: ['billing'],
      },
    ]);
  });

  it('should refuse the merge under fail, naming the address and both services', () => {
    // Given the same two services
    // When they are merged under fail
    const merge = (): MergeResult => mergeColliding('fail');

    // Then nothing is produced and the refusal says what collided and who claimed it
    expect(merge).toThrow(MergeConflictError);
    expect(merge).toThrow(/"\/status"/);
    expect(merge).toThrow(/billing, orders/);
  });

  it('should lose nothing but the address and the id, under every mode', () => {
    // Given the modes that produce a document at all
    const modes: readonly FederationConflictMode[] = ['namespace', 'first-wins'];

    // When each merge is undone by putting the source id and address back
    const restored = modes.map((mode) => {
      const { document } = mergeColliding(mode);
      const source = collidingServices();

      return [...document.nodes.values()].map((node) => {
        const serviceId = node.serviceId ?? '';
        const own = serviceId === 'billing' ? source.billing : source.orders;
        const sourceId = node.id.slice(`${serviceId}_`.length);
        const sourceNode = own.nodes.get(sourceId);
        const { serviceId: _dropped, ...rest } = node;

        return {
          matches:
            JSON.stringify({ ...rest, id: sourceId, path: (sourceNode as IROperation).path }) ===
            JSON.stringify(sourceNode),
          serviceId,
        };
      });
    });

    // Then every node of every service came back exactly as its own document wrote it
    expect(restored).toEqual([
      [
        { matches: true, serviceId: 'billing' },
        { matches: true, serviceId: 'orders' },
      ],
      [
        { matches: true, serviceId: 'billing' },
        { matches: true, serviceId: 'orders' },
      ],
    ]);
  });
});

describe('mergeDocuments, component deduplication', () => {
  const money = {
    type: 'object' as const,
    properties: { amount: { type: 'integer' as const }, currency: { type: 'string' as const } },
  };

  it('should collapse identical schemas from two services into one entry', () => {
    // Given two services describing Money identically
    const billing = buildDocument({
      id: 'billing-api',
      schemas: [namedSchema('Money', money)],
      nodes: [
        operation({
          id: 'get-total',
          path: '/total',
          responses: [
            {
              statusCode: '200',
              content: [
                { mediaType: 'application/json', schema: { kind: 'named', schemaId: 'Money' } },
              ],
            },
          ],
        }),
      ],
    });
    const orders = buildDocument({ id: 'orders-api', schemas: [namedSchema('Money', money)] });

    // When they are merged
    const { document, report } = mergeDocuments(
      [
        { id: 'billing', document: billing },
        { id: 'orders', document: orders },
      ],
      MERGED,
    );

    // Then one entry survives, under the plain name, and both sources are recorded against it
    expect([...document.schemas.keys()]).toEqual(['Money']);
    expect(report.deduplicated).toEqual([
      {
        schemaId: 'Money',
        sources: [
          { serviceId: 'billing', schemaId: 'Money' },
          { serviceId: 'orders', schemaId: 'Money' },
        ],
      },
    ]);
  });

  it('should keep schemas that differ by one field apart', () => {
    // Given two services whose Money differs in a single property
    const billing = buildDocument({ id: 'billing-api', schemas: [namedSchema('Money', money)] });
    const orders = buildDocument({
      id: 'orders-api',
      schemas: [
        namedSchema('Money', {
          ...money,
          properties: { ...money.properties, precision: { type: 'integer' } },
        }),
      ],
    });

    // When they are merged
    const { document, report } = mergeDocuments(
      [
        { id: 'billing', document: billing },
        { id: 'orders', document: orders },
      ],
      MERGED,
    );

    // Then both survive, namespaced, and nothing is reported as deduplicated
    expect([...document.schemas.keys()].sort()).toEqual(
      [federatedSchemaId('billing', 'Money'), federatedSchemaId('orders', 'Money')].sort(),
    );
    expect(report.deduplicated).toEqual([]);
    expect(report.renames.filter((rename) => rename.kind === 'schema')).toEqual([
      {
        kind: 'schema',
        serviceId: 'billing',
        from: 'Money',
        to: federatedSchemaId('billing', 'Money'),
        reason: 'name-conflict',
        contestedBy: ['orders'],
      },
      {
        kind: 'schema',
        serviceId: 'orders',
        from: 'Money',
        to: federatedSchemaId('orders', 'Money'),
        reason: 'name-conflict',
        contestedBy: ['billing'],
      },
    ]);
  });

  it('should namespace a schema into the third id space rather than by the node prefix', () => {
    // Given two services whose Money differs, one of them named so that the node prefix would
    // have collided with a real schema name of the other, which is SPEC 15's Stripe case
    const billing = buildDocument({
      id: 'billing-api',
      schemas: [namedSchema('annual_revenue', { type: 'integer' })],
    });
    const account = buildDocument({
      id: 'account-api',
      schemas: [namedSchema('annual_revenue', { type: 'string' })],
    });

    // When they are merged
    const { document } = mergeDocuments(
      [
        { id: 'billing', document: billing },
        { id: 'account', document: account },
      ],
      MERGED,
    );

    // Then each id is `~s<8 hex>~<its own id>`, which no document can spell for itself, and the
    // reader is still shown the name the document wrote
    const ids = [...document.schemas.keys()].sort();
    expect(ids).toEqual(
      [
        federatedSchemaId('billing', 'annual_revenue'),
        federatedSchemaId('account', 'annual_revenue'),
      ].sort(),
    );
    expect(ids.every((id) => /^~s[0-9a-f]{8}~annual_revenue$/.test(id))).toBe(true);
    expect(ids.map((id) => schemaNameFromId(id))).toEqual(['annual_revenue', 'annual_revenue']);
  });

  it('should re-point every use site at the id the class was given', () => {
    // Given two services whose Money differs, one of them using it in a response
    const billing = buildDocument({
      id: 'billing-api',
      schemas: [namedSchema('Money', money)],
      nodes: [
        operation({
          id: 'get-total',
          path: '/total',
          responses: [
            {
              statusCode: '200',
              content: [
                { mediaType: 'application/json', schema: { kind: 'named', schemaId: 'Money' } },
              ],
            },
          ],
        }),
      ],
    });
    const orders = buildDocument({
      id: 'orders-api',
      schemas: [namedSchema('Money', { ...money, title: 'Order money' })],
    });

    // When they are merged
    const { document } = mergeDocuments(
      [
        { id: 'billing', document: billing },
        { id: 'orders', document: orders },
      ],
      MERGED,
    );

    // Then the response points at the renamed entry rather than at the name it was written with
    const node = document.nodes.get('billing_get-total');
    const slot = node?.kind === 'operation' ? node.responses[0]?.content[0]?.schema : undefined;
    expect(slot).toEqual({ kind: 'named', schemaId: federatedSchemaId('billing', 'Money') });
  });
});

describe('mergeDocuments, security schemes', () => {
  it('should namespace a bearer scheme that two services configure differently', () => {
    // Given two services declaring `bearer` with different scopes, which is SPEC 15's own example
    const billing = buildDocument({
      id: 'billing-api',
      security: [bearerScheme({ 'invoices:read': 'Read invoices' })],
      nodes: [
        operation({
          id: 'get-total',
          path: '/total',
          security: [{ schemeId: 'bearer', scopes: [] }],
        }),
      ],
    });
    const orders = buildDocument({
      id: 'orders-api',
      security: [bearerScheme({ 'orders:read': 'Read orders' })],
    });

    // When they are merged
    const { document } = mergeDocuments(
      [
        { id: 'billing', document: billing },
        { id: 'orders', document: orders },
      ],
      MERGED,
    );

    // Then there are two schemes, each with its own scopes, and the requirement follows its own
    const ids = document.security.map((scheme) => scheme.id).sort();
    const node = document.nodes.get('billing_get-total');
    const requirement = node?.kind === 'operation' ? node.security[0]?.schemeId : undefined;

    expect(ids).toEqual(
      [federatedSchemaId('billing', 'bearer'), federatedSchemaId('orders', 'bearer')].sort(),
    );
    expect(requirement).toBe(federatedSchemaId('billing', 'bearer'));
  });

  it('should keep one entry when two services declare the same scheme identically', () => {
    // Given two services declaring the same bearer scheme
    const billing = buildDocument({ id: 'billing-api', security: [bearerScheme()] });
    const orders = buildDocument({ id: 'orders-api', security: [bearerScheme()] });

    // When they are merged
    const { document } = mergeDocuments(
      [
        { id: 'billing', document: billing },
        { id: 'orders', document: orders },
      ],
      MERGED,
    );

    // Then the reader is asked for one credential rather than the same one twice
    expect(document.security.map((scheme) => scheme.id)).toEqual(['bearer']);
  });
});

describe('mergeDocuments, determinism', () => {
  it('should produce one document and one report under shuffled remote ordering', () => {
    // Given three services with overlapping paths, schemas and schemes
    const services = [
      {
        id: 'orders',
        document: buildDocument({
          id: 'orders-api',
          nodes: [operation({ id: 'get-status', path: '/status' })],
          schemas: [namedSchema('Money', { type: 'object' })],
          security: [bearerScheme({ 'orders:read': 'Read' })],
        }),
      },
      {
        id: 'billing',
        document: buildDocument({
          id: 'billing-api',
          nodes: [operation({ id: 'get-status', path: '/status' })],
          schemas: [namedSchema('Money', { type: 'string' })],
          security: [bearerScheme({ 'invoices:read': 'Read' })],
        }),
      },
      {
        id: 'shipping',
        document: buildDocument({
          id: 'shipping-api',
          nodes: [operation({ id: 'get-status', path: '/status' })],
          schemas: [namedSchema('Money', { type: 'object' })],
        }),
      },
    ];

    // When the same three are merged in six orders
    const orders = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    const results = orders.map((order) =>
      mergeDocuments(
        order.map((index) => services[index]).filter((entry) => entry !== undefined),
        MERGED,
      ),
    );
    const [first] = results;

    // Then every hash and every report is the one the sorted order produces
    expect(results.map((result) => result.document.hash)).toEqual(
      results.map(() => first?.document.hash),
    );
    expect(results.map((result) => JSON.stringify(result.report))).toEqual(
      results.map(() => JSON.stringify(first?.report)),
    );
  });
});

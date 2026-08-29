import { normalizeOpenApiDocument } from '@openref/core';
import { mergeDocuments } from '@openref/federation';
import { buildSearchIndex, loadSearchIndex } from '@openref/search';
import { describe, expect, it } from 'vitest';

/**
 * One search across all services, per SPEC 15.3 and `T046`.
 *
 * THE FAIRNESS CLAIM IS THE ONE WORTH A SUITE: a match in a three operation service competes
 * with a forty operation neighbour as a record among records, never as a service among
 * services. The index is built over the merged document, so there is nothing per service to
 * weight; what could still bury the small service is bulk, a large corpus full of weak matches
 * outranking one strong one, and that is exactly what the fixture builds: the large service
 * mentions the query word in prose on every operation, the small one carries it in a title and
 * a path, and the title has to win.
 *
 * IT LIVES IN `@openref/nest` BECAUSE THIS IS THE PACKAGE THAT COMPOSES THE TWO: the federation
 * produces the document and the search factory serves the index, and neither of those packages
 * may see the other, per STANDARDS 3.5.
 */

/** The small service: three operations, one of which is the strong match. */
function smallService(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: { title: 'Refunds', version: '1.0.0' },
    paths: {
      '/refunds': {
        post: {
          operationId: 'createRefund',
          summary: 'Refund an order',
          responses: { '201': { description: 'created' } },
        },
      },
      '/refunds/pending': {
        get: {
          operationId: 'listPendingRefunds',
          summary: 'List pending refunds',
          responses: { '200': { description: 'ok' } },
        },
      },
      '/health-probe': {
        get: {
          operationId: 'probeRefundsService',
          summary: 'Probe',
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  };
}

/** The large service: forty operations, each mentioning the query word weakly, in prose. */
function largeService(): Record<string, unknown> {
  const paths: Record<string, unknown> = {};

  for (let index = 0; index < 40; index += 1) {
    paths[`/orders/slot-${String(index)}`] = {
      get: {
        operationId: `getOrderSlot${String(index)}`,
        summary: `Order slot ${String(index)}`,
        description: `Reads one order slot. A cancelled order here is later refunded elsewhere.`,
        responses: { '200': { description: 'ok' } },
      },
    };
  }

  return { openapi: '3.1.0', info: { title: 'Orders', version: '2.0.0' }, paths };
}

function mergedIndex(): ReturnType<typeof loadSearchIndex> {
  const result = mergeDocuments(
    [
      { id: 'refunds', document: normalizeOpenApiDocument(smallService()) },
      { id: 'orders', document: normalizeOpenApiDocument(largeService()) },
    ],
    { id: 'gateway', info: { title: 'Gateway', version: '1.0.0' } },
  );

  return loadSearchIndex(buildSearchIndex(result.document).serialized);
}

describe('search over a federated document', () => {
  it('should rank the small service strong match above forty weak mentions in the large one', () => {
    // Given: one index over the merged document
    const index = mergedIndex();

    // And the presence half first: the large service really is in the same index, in bulk,
    // so the ranking below is a contest rather than a walkover
    const orders = index.search('order slot', 60);
    expect(orders.filter((hit) => hit.id.startsWith('orders_')).length).toBeGreaterThan(30);

    // When: the query the small service answers with a title and the large one with prose
    const hits = index.search('refund');

    // Then: the strong match leads, and it is the small service's
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.id.startsWith('refunds_')).toBe(true);
    expect(hits[0]?.title).toBe('Refund an order');
  });

  it('should answer one query with hits from both services, which is what one search means', () => {
    // Given
    const index = mergedIndex();

    // When: a word both services carry
    const hits = index.search('order', 60);

    // Then
    const services = new Set(
      hits.map((hit) => (hit.id.startsWith('refunds_') ? 'refunds' : 'orders')),
    );
    expect(services).toEqual(new Set(['refunds', 'orders']));
  });
});

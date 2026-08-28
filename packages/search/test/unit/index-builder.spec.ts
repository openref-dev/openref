import { gzipSync } from 'node:zlib';
import { normalizeOpenApiDocument, type IRDocument } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { largeDocument } from '../../../render/test/mocks/documents';
import {
  buildSearchIndex,
  collectSearchDocuments,
  loadSearchIndex,
  SEARCH_INDEX_VERSION,
  SearchIndexFormatError,
} from '../../src/index';

/**
 * The search index, per SPEC 11, SPEC 12 and SPEC 20, and BUILD T007.
 *
 * SPEC 20 budgets the index at 250 KB gzip for 1000 nodes, and the committed budgets gate
 * prints that budget as NOT MEASURED HERE with T007 named as the task that enforces it. This
 * file is where that enforcement lives, so the number is asserted here or nowhere.
 *
 * THE INPUT IS THE SPEC 20 FIXTURE AND NOT A LOCAL ONE. It used to be a local generator giving
 * a thousand operations one description, and gzip is exactly the measurement repetition
 * flatters: it read 43 KB against the 250 KB cap, which is 5.8x of headroom no real document
 * has. `index-budget-input.spec.ts` is what keeps the replacement honest, by holding its cost
 * per record inside the band the real corpus documents measure.
 */

/** SPEC 20: search index, 1000 nodes, gzip. */
const INDEX_BUDGET_BYTES = 250 * 1024;

/** SPEC 20: the same index in the bytes a client parses, added at T042. */
const INDEX_RAW_BUDGET_BYTES = 1024 * 1024;

function documentWith(operations: readonly Record<string, unknown>[]): IRDocument {
  const paths: Record<string, unknown> = {};
  for (const operation of operations) {
    paths[String(operation.path)] = { get: operation.get };
  }

  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Orders API', version: '1' },
    paths,
    components: {
      schemas: {
        Order: { type: 'object', title: 'Order', properties: { id: { type: 'string' } } },
        Money: { type: 'string', description: 'An amount in minor units' },
      },
    },
  });
}

const sample = documentWith([
  {
    path: '/orders',
    get: {
      summary: 'List every order',
      description: 'Returns the orders visible to the caller.',
      tags: ['Orders', 'Billing'],
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
  {
    path: '/invoices',
    get: {
      summary: 'List invoices',
      tags: ['Billing'],
      responses: { '200': { description: 'ok' } },
    },
  },
]);

describe('collectSearchDocuments', () => {
  it('should index an operation with its route, method, tags and schema names', () => {
    // Given
    const document = sample;

    // When
    const records = collectSearchDocuments(document);
    const orders = records.find((record) => record.id === 'get-orders');

    // Then
    expect(orders).toMatchObject({
      kind: 'operation',
      path: '/orders',
      method: 'get',
      summary: 'List every order',
      tags: ['Billing', 'Orders'],
      schemaNames: ['Order'],
    });
  });

  it('should index every named schema of the document', () => {
    // Given
    const document = sample;

    // When
    const schemas = collectSearchDocuments(document).filter((record) => record.kind === 'schema');

    // Then
    expect(schemas.map((record) => record.id)).toEqual(['Money', 'Order']);
  });

  it('should order records canonically, not by the order the document was written in', () => {
    // Given
    const forward = documentWith([
      { path: '/a', get: { summary: 'A', responses: {} } },
      { path: '/b', get: { summary: 'B', responses: {} } },
    ]);
    const reversed = documentWith([
      { path: '/b', get: { summary: 'B', responses: {} } },
      { path: '/a', get: { summary: 'A', responses: {} } },
    ]);

    // When
    const ids = [forward, reversed].map((document) =>
      collectSearchDocuments(document).map((record) => record.id),
    );

    // Then
    expect(ids[0]).toEqual(ids[1]);
  });
});

describe('buildSearchIndex', () => {
  it('should carry the hash of the IR it was built from, per SPEC 12', () => {
    // Given
    const document = sample;

    // When
    const index = buildSearchIndex(document);

    // Then
    expect(index.documentHash).toBe(document.hash);
  });

  it('should produce byte identical output from two builds of the same IR', () => {
    // Given
    const document = sample;

    // When
    const builds = [buildSearchIndex(document), buildSearchIndex(document)];

    // Then
    expect(builds[0]?.serialized).toBe(builds[1]?.serialized);
  });

  it('should produce byte identical output from two normalizations of one source', () => {
    // Given, the whole point of being a pure function of the IR
    const first = documentWith([{ path: '/orders', get: { summary: 'List', responses: {} } }]);
    const second = documentWith([{ path: '/orders', get: { summary: 'List', responses: {} } }]);

    // When
    const builds = [buildSearchIndex(first), buildSearchIndex(second)];

    // Then
    expect(first.hash).toBe(second.hash);
    expect(builds[0]?.serialized).toBe(builds[1]?.serialized);
  });

  it('should stay at or under 250 KB gzip for 1000 nodes, per SPEC 20', () => {
    // Given the document SPEC 20 names: 1000 operations, 1750 schemas, 2750 index records.
    const document = largeDocument(1000);

    // When
    const index = buildSearchIndex(document);
    const compressed = gzipSync(Buffer.from(index.serialized, 'utf8')).byteLength;

    // Then, measured 176,714 bytes against the 250 KB cap, which is 1.45x of room. The cap is
    // not re-derived down to that, because the record count of a real document of this node
    // count varies with its schema density and the corpus spans 0.75 to 9.3 schemas per
    // operation; the fixture sits at the 1.75 the three largest documents average.
    expect(index.documentCount).toBe(2750);
    expect(compressed).toBeLessThanOrEqual(INDEX_BUDGET_BYTES);
  }, 120_000);

  it('should stay at or under 1 MB raw for 1000 nodes, which is the cap that binds', () => {
    // Given the same document, and the second question the row above cannot answer. The gzip cap
    // bounds what a reader downloads; this bounds what the engine parses, and the two differ by a
    // factor of 5.34 here. The T039 amendment filed this against whoever first serves the index
    // into a page, and until T042 nothing did, which is the only reason it was latent.
    const document = largeDocument(1000);

    // When
    const index = buildSearchIndex(document);
    const raw = Buffer.byteLength(index.serialized, 'utf8');

    // Then, measured 946,269 raw bytes at T042 against the 1 MB cap derived from it, which leaves
    // 102,307 bytes for ordinary work. At the current ratio this is the tighter of the two: an
    // index sitting on the 250 KB transfer cap would be about 1.37 MB for a client to parse.
    expect(index.documentCount).toBe(2750);
    expect(raw).toBeLessThanOrEqual(INDEX_RAW_BUDGET_BYTES);
  }, 120_000);
});

describe('loadSearchIndex', () => {
  it('should find an operation by a fragment of its path', () => {
    // Given
    const index = loadSearchIndex(buildSearchIndex(sample).serialized);

    // When
    const hits = index.search('invoices');

    // Then
    expect(hits.map((hit) => hit.id)).toContain('get-invoices');
  });

  it('should find an operation by a word from its summary', () => {
    // Given
    const index = loadSearchIndex(buildSearchIndex(sample).serialized);

    // When
    const hits = index.search('every');

    // Then
    expect(hits.map((hit) => hit.id)).toContain('get-orders');
  });

  it('should find an operation by one of its tags', () => {
    // Given
    const index = loadSearchIndex(buildSearchIndex(sample).serialized);

    // When
    const hits = index.search('Billing');

    // Then
    expect(hits.map((hit) => hit.id)).toEqual(
      expect.arrayContaining(['get-orders', 'get-invoices']),
    );
  });

  it('should find an operation by the name of a schema it returns', () => {
    // Given
    const index = loadSearchIndex(buildSearchIndex(sample).serialized);

    // When
    const hits = index.search('Order');

    // Then
    expect(hits.map((hit) => hit.id)).toContain('get-orders');
  });

  it('should carry the document hash and count through serialization', () => {
    // Given
    const built = buildSearchIndex(sample);

    // When
    const index = loadSearchIndex(built.serialized);

    // Then
    expect(index.documentHash).toBe(built.documentHash);
    expect(index.documentCount).toBe(built.documentCount);
  });

  it('should return nothing for an empty query rather than everything', () => {
    // Given
    const index = loadSearchIndex(buildSearchIndex(sample).serialized);

    // When
    const hits = index.search('   ');

    // Then
    expect(hits).toEqual([]);
  });

  it('should honour the result limit', () => {
    // Given
    const index = loadSearchIndex(buildSearchIndex(sample).serialized);

    // When
    const hits = index.search('list', 1);

    // Then
    expect(hits.length).toBeLessThanOrEqual(1);
  });

  it('should refuse an index written by a different format version', () => {
    // Given
    const built = buildSearchIndex(sample);
    const tampered = built.serialized.replace(
      `"version":${String(SEARCH_INDEX_VERSION)}`,
      '"version":999',
    );

    // When
    const act = (): unknown => loadSearchIndex(tampered);

    // Then
    expect(act).toThrow(SearchIndexFormatError);
    expect(act).toThrow(/version 999/);
  });

  it('should refuse a file that is not JSON', () => {
    // Given
    const serialized = 'not an index';

    // When
    const act = (): unknown => loadSearchIndex(serialized);

    // Then
    expect(act).toThrow(SearchIndexFormatError);
  });

  it('should refuse an index carrying no document hash', () => {
    // Given
    const serialized = JSON.stringify({ version: SEARCH_INDEX_VERSION, index: {} });

    // When
    const act = (): unknown => loadSearchIndex(serialized);

    // Then
    expect(act).toThrow(/document hash/);
  });
});

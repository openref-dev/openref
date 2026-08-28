import { describe, expect, it } from 'vitest';
import { normalizeOpenApiDocument } from '@openref/core';
import { buildSearchIndex } from '@openref/search';
import { createPageSearch } from '../../src/browser/search-factory';

/**
 * The half of the search wiring this package owns: a body a page fetched, turned into an index.
 *
 * `runner-factory.spec.ts`'s position in the plan. The renderer performs the request, because
 * the address is relative to a mount point only it knows, and it may not see `@openref/search`;
 * this package may see both, so it is where the body is read. What is asserted here is
 * therefore what the renderer's own case cannot assert: that a real serialized index, built by
 * the builder the server serves from, loads and answers a word that lives in a description.
 *
 * THE REAL BUILDER AND NOT A MOCK, deliberately, unlike the runner factory beside it. There the
 * subject is a branch and the transports are somebody else's; here the subject is whether two
 * halves of one format agree, and a mocked loader would agree with itself.
 */

/** The word that lives in a description and in no summary, path or schema name. */
const INDEX_ONLY_WORD = 'ptarmigan';

/** A document whose one operation hides a word behind its description. */
function ordersDocument() {
  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Orders API', version: '1.0.0' },
    paths: {
      '/orders': {
        get: {
          operationId: 'listOrders',
          summary: 'List orders',
          description: `Returns every order the ${INDEX_ONLY_WORD} warehouse holds.`,
          responses: { '200': { description: 'A page of orders' } },
        },
      },
    },
  });
}

describe('createPageSearch', () => {
  it('should load the index the server serves and answer a word only a description holds', () => {
    // Given the body of `<mount>/_search-index`, built the way the reference builds it
    const document_ = ordersDocument();
    const serialized = buildSearchIndex(document_).serialized;

    // When
    const index = createPageSearch({ serialized });

    // Then, and the word is asserted to be findable only because it is in the index: the
    // summary and the path, which the navigation rows already carry, do not contain it.
    expect(index.search(INDEX_ONLY_WORD).map((hit) => hit.title)).toContain('List orders');
    expect(`List orders /orders`).not.toContain(INDEX_ONLY_WORD);
  });

  it('should carry the hash of the document it was built from, which is what the page checks', () => {
    // Given
    const document_ = ordersDocument();

    // When
    const index = createPageSearch({ serialized: buildSearchIndex(document_).serialized });

    // Then. The renderer compares this against the page's own, in `readSearchIndex`, because
    // `_search-index` is one address per mount and a cache in front of it can outlive a
    // deployment. Without the field there is nothing to compare.
    expect(index.documentHash).toBe(document_.hash);
  });

  it('should refuse a body that is not an index this build can read', () => {
    // Given a response that is not an index at all, which is what a rewriting proxy answers with

    // When, Then, and it fails rather than returning an index that finds nothing, which is the
    // state a reader cannot tell from a document with no content
    expect(() => createPageSearch({ serialized: '<!doctype html>' })).toThrow(/search index/);
  });
});

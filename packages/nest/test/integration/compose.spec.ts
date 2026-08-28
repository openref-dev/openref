import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeOpenApiDocument } from '@openref/core';
import { buildSearchIndex } from '@openref/search';

/**
 * The production composition, asserted to pass the real factories rather than to exist.
 *
 * WHY THIS FILE EXISTS, AND IT IS A REVIEW FINDING RATHER THAN A GAP SOMEBODY NOTICED. The search
 * half of T042 was proved twice and neither proof touched this line. `search-factory.spec.ts` runs
 * the real builder against the real loader, and knows nothing about who calls it;
 * `search-fetch.spec.ts` drives the palette through `hydrateReference({ loadSearch: aFakeLoader })`,
 * so it proves the renderer's seam with a loader the test wrote. Delete `loadSearch` from
 * `compose.ts` and both stay green: every shipped page loses full text search and the only thing
 * that goes red is a budget gate complaining about a chunk root. That is a capability disappearing
 * with no test to its name, which is the eighth class of SPEC 0.
 *
 * SO WHAT IS UNDER TEST IS THE ARGUMENT AND NOT THE FUNCTION. `hydrateReference` is replaced,
 * the options it was handed are captured, and the captured `loadSearch` is then driven with a real
 * serialized index and asked a word that only a real index can answer. A loader that is absent, or
 * one that is not `createPageSearch`, cannot pass.
 */

/** What the composition handed the renderer, captured rather than executed. */
interface CapturedOptions {
  readonly loadSearch?: (model: { readonly serialized: string }) => Promise<{
    readonly documentHash: string;
    search(query: string, limit?: number): readonly { readonly title: string }[];
  }>;
  readonly loadRunner?: unknown;
}

let captured: CapturedOptions | null = null;

vi.mock('@openref/render/browser', () => ({
  hydrateReference: (options: CapturedOptions): boolean => {
    captured = options;
    return true;
  },
}));

const { mountReference } = await import('../../src/browser/compose');

/** The word that lives in a description and in no summary or path. */
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

beforeEach(() => {
  captured = null;
});

describe('mountReference', () => {
  it('should hand the renderer a search loader at all, which is the line T042 added', () => {
    // Given the composition every shipped browser entry performs
    // When
    mountReference();

    // Then
    expect(captured).not.toBeNull();
    expect(typeof captured?.loadSearch).toBe('function');
    // The runner half beside it, so a composition that lost both fails saying which one is gone.
    expect(typeof captured?.loadRunner).toBe('function');
  });

  it('should hand it the real index loader, proved by asking a word only a real index answers', async () => {
    // Given a body exactly as the server serves it, built by the builder the server builds with
    const document_ = ordersDocument();
    const serialized = buildSearchIndex(document_).serialized;
    mountReference();

    const loadSearch = captured?.loadSearch;
    if (loadSearch === undefined) throw new Error('the composition passed no search loader');

    // When the loader the composition supplied is driven with that body
    const index = await loadSearch({ serialized });

    // Then it is a queryable index over the document, carrying the hash the page checks against,
    // and it answers a word that lives only in a description. A stub, a fake or an absent loader
    // fails here; the navigation rows this palette falls back to carry the summary and the path
    // and neither of them holds the word.
    expect(index.documentHash).toBe(document_.hash);
    expect(index.search(INDEX_ONLY_WORD).map((hit) => hit.title)).toContain('List orders');
    expect('List orders /orders').not.toContain(INDEX_ONLY_WORD);
  });
});

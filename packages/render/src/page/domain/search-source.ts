/**
 * Where the palette gets a full text index from, and what it refuses.
 *
 * THE INDEX IS NOT IMPORTED HERE AND NEVER WILL BE. STANDARDS 3.5 gives this package `core` and
 * `vue` and nothing else, so `@openref/search` is out of reach: the index arrives as an
 * `ISearchPort`, which `@openref/vue` declares and whoever wires the application supplies. That
 * is `@openref/nest` for a served reference, through a dynamic import, so the loader and the
 * index it builds travel in a chunk no first paint compiles. It is the shape `loadRunner`
 * already has, for the same reason.
 *
 * THE PORT SAYS WHICH DOCUMENT IT INDEXES, WHICH `ISearchPort` DOES NOT, and the extra member is
 * the whole of {@link SearchIndexPort}. `_navigation` is addressed by document hash and
 * `readNavigationPayload` still refuses a payload about another document, because a hash
 * addressed url can answer with the wrong thing through a proxy that rewrites or a cache that
 * outlived a deployment. `_search-index` is one address per mount, per SPEC 13.3, so it has not
 * even that much: a deployment that changes the document leaves the url alone. A page that
 * searched whatever came back would show a reader operations that are not in the reference they
 * are reading, and it would do it silently. So the index states its subject and the page checks
 * it, which a serialized index can do because it carries the hash of the IR it was built from.
 */

import type { ISearchPort } from '@openref/vue';

/**
 * An index that says which document it is about.
 *
 * A `SearchIndex` from `@openref/search` satisfies this structurally, deliberately: the port is
 * declared once, in `@openref/vue`, and the search package is not made to know about either it
 * or this.
 */
export interface SearchIndexPort extends ISearchPort {
  /** Hash of the IR the index was built from. */
  readonly documentHash: string;
}

/** A fetched index, and the document the page that fetched it is about. */
export interface SearchIndexSource {
  /** `PageModel.documentHash`, so the loader can refuse an index about something else. */
  readonly documentHash: string;
  /** The response body of `<mount>/_search-index`, exactly as it arrived. */
  readonly serialized: string;
}

/**
 * Turns a fetched index into a port, supplied by whoever wires the application.
 *
 * A rejection is a working page with no full text search, never a broken one: see
 * `createSearchStore`.
 */
export type SearchIndexLoader = (source: SearchIndexSource) => Promise<SearchIndexPort>;

/** What the palette calls. No arguments, because the page's facts are already bound. */
export type SearchLoader = () => Promise<SearchIndexPort>;

/**
 * Reads a loaded index, refusing one that is about another document.
 *
 * The sibling of `readNavigationPayload`, and it throws the same way for the same reason: the
 * caller is a store that fails open, so what reaches a reader is a palette that still searches
 * the navigation rather than an exception.
 *
 * @param index - Whatever the loader returned
 * @param documentHash - Hash of the document the page is about
 * @returns The same index
 * @throws Error when the index describes another document
 */
export function readSearchIndex(index: SearchIndexPort, documentHash: string): SearchIndexPort {
  if (index.documentHash !== documentHash) {
    throw new Error(
      `the search index is about ${index.documentHash} and this page is about ${documentHash}`,
    );
  }

  return index;
}

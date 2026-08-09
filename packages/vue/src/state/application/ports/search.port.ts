/**
 * The port through which the headless layer reaches a search index.
 *
 * `@openref/vue` may depend on `@openref/core` and nothing else, so the index itself cannot be
 * imported here. Whoever wires the application, `render` on the server or `nest` at runtime,
 * hands in an implementation. A loaded `SearchIndex` from `@openref/search` satisfies this
 * shape structurally, which is deliberate: the port is defined once, here, and the search
 * package is not made to know about it.
 */

/** What a hit can point at. */
export type SearchHitKind = 'operation' | 'channel' | 'schema';

/** One search hit, as a theme renders it. */
export interface SearchHit {
  /** Key into {@link IRDocument.nodes} or {@link IRDocument.schemas}. */
  readonly id: string;
  readonly kind: SearchHitKind;
  readonly title: string;
  readonly score: number;
  readonly path?: string;
  readonly method?: string;
  readonly address?: string;
  readonly deprecated?: boolean;
}

/** A queryable index. */
export interface ISearchPort {
  /**
   * @param query - Raw query text as typed
   * @param limit - Greatest number of hits to return
   */
  search(query: string, limit?: number): SearchHit[];
}

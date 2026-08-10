/**
 * The cache SPEC 12 describes: render once per document hash, then serve.
 *
 * The interface is asynchronous although the memory implementation is not. A Redis driver
 * is the stated next implementation and it cannot be synchronous, and retrofitting `await`
 * into every call site later would be a breaking change to code that has no reason to
 * change.
 */

/**
 * A rendered page, as it is stored.
 *
 * IT CARRIES NO NONCE. A nonce is per response, and a cached one is either reused across
 * responses, which defeats the nonce, or stale, which breaks the page. The shell puts the
 * nonce in at serve time, on the way out of the cache.
 */
export interface RenderedPage {
  /** Hash of the document this page was rendered from. */
  readonly documentHash: string;
  /** Node the page shows, or null for the document overview. */
  readonly nodeId: string | null;
  /** Text for the `title` element, unescaped. */
  readonly title: string;
  /** Server rendered application markup. */
  readonly appHtml: string;
  /** Canonical JSON of the page model, for the client to hydrate from. */
  readonly stateJson: string;
}

/** Read and write side of the render cache. */
export interface IRenderCache {
  /**
   * @param key - Key produced by `renderCacheKey`
   * @returns The stored page, or undefined on a miss
   */
  get(key: string): Promise<RenderedPage | undefined>;
  /**
   * @param key - Key produced by `renderCacheKey`
   * @param page - Page to store
   */
  set(key: string, page: RenderedPage): Promise<void>;
  /** Drops everything. Used when a document is replaced rather than on a schedule. */
  clear(): Promise<void>;
}

/** What a cache reports about itself. Optional, because a remote driver may not know. */
export interface RenderCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly entries: number;
  readonly evictions: number;
}

/** A cache that can report its own counters. */
export interface IObservableRenderCache extends IRenderCache {
  stats(): RenderCacheStats;
}

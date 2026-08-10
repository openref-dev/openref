/**
 * In process render cache, the default driver.
 *
 * Bounded on purpose. A reference for a large specification has as many pages as it has
 * nodes, and an unbounded map keyed by hash and node would grow with every deployed
 * version of every document a federated instance serves.
 */

import type {
  IObservableRenderCache,
  RenderCacheStats,
  RenderedPage,
} from '../../application/ports/render-cache.port';

/** Entries a memory cache holds before it starts evicting. */
export const DEFAULT_MEMORY_CACHE_ENTRIES = 512;

/** Options of the memory driver. */
export interface MemoryRenderCacheOptions {
  /** Maximum number of pages held. Must be at least one. */
  readonly maxEntries?: number;
}

/**
 * Builds a bounded, least recently used render cache.
 *
 * A `Map` keeps insertion order, so promoting an entry on read is a delete followed by a
 * set, and the oldest key is the first one the iterator yields. That is the whole eviction
 * policy, and it needs no second data structure to stay correct.
 *
 * @param options - Bound on the number of entries
 * @returns A cache that reports its own hit, miss and eviction counts
 */
export function createMemoryRenderCache(
  options: MemoryRenderCacheOptions = {},
): IObservableRenderCache {
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MEMORY_CACHE_ENTRIES);
  const entries = new Map<string, RenderedPage>();

  let hits = 0;
  let misses = 0;
  let evictions = 0;

  return {
    get(key): Promise<RenderedPage | undefined> {
      const found = entries.get(key);

      if (found === undefined) {
        misses += 1;
        return Promise.resolve(undefined);
      }

      hits += 1;
      entries.delete(key);
      entries.set(key, found);
      return Promise.resolve(found);
    },

    set(key, page): Promise<void> {
      entries.delete(key);
      entries.set(key, page);

      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        entries.delete(oldest.value);
        evictions += 1;
      }

      return Promise.resolve();
    },

    clear(): Promise<void> {
      entries.clear();
      return Promise.resolve();
    },

    stats(): RenderCacheStats {
      return { hits, misses, entries: entries.size, evictions };
    },
  };
}

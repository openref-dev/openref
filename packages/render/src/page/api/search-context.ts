/**
 * The one full text index a page holds, and the one fetch that brings it.
 *
 * IT IS THE PALETTE'S AND NOBODY ELSE'S, which is the difference from `nav-context.ts`. The
 * navigation is asked for by the sidebar and by the palette, so its store is created where the
 * page model is and provided down; the index is asked for by the palette alone, so its store is
 * created inside the palette and travels in the palette's chunk. Creating it beside the
 * navigation store would put the loading of a feature one keystroke deep into the first paint of
 * every page, which is the cost T012 declined to pay in the first place.
 *
 * IT NEVER THROWS INTO THE PAGE. Full text search is a progressive enhancement over a palette
 * that already works: with no port, with a fetch that failed, or with an index about another
 * document, the palette matches navigation rows exactly as it did before this existed. So the
 * policy here is the navigation store's, fail open and say so, and not the normalizer's.
 */

import { computed, ref, shallowRef, type ComputedRef, type Ref, type ShallowRef } from 'vue';
import { readSearchIndex, type SearchIndexPort, type SearchLoader } from '../domain/search-source';

/** What the palette reads. */
export interface SearchStore {
  /** The index once it has arrived, null until then and after a failure. */
  readonly port: ShallowRef<SearchIndexPort | null>;
  /** True when a query would be answered by the index rather than by the navigation rows. */
  readonly available: ComputedRef<boolean>;
  /** True while the fetch and the load are in flight. */
  readonly pending: Ref<boolean>;
  /** Set when the index could not be loaded, so the palette can stay honest about what it searched. */
  readonly failed: Ref<boolean>;
  /**
   * Fetches and loads the index, once.
   *
   * @returns True when a queryable index is available afterwards
   */
  load(): Promise<boolean>;
}

/** What the store is built from. */
export interface SearchStoreOptions {
  /** Hash of the document this page is about, checked against the index's own. */
  readonly documentHash: string;
  /** How the index is reached. Absent leaves the palette on the navigation rows, which works. */
  readonly loader?: SearchLoader;
}

/**
 * Builds the search store for one page.
 *
 * @param options - The document it is about and how to reach its index
 * @returns The store
 */
export function createSearchStore(options: SearchStoreOptions): SearchStore {
  // shallowRef for the navigation store's reason: this is a large frozen structure that is
  // replaced whole and never mutated, so deep reactivity would buy proxies over an inverted
  // index to observe changes that cannot happen.
  const port = shallowRef<SearchIndexPort | null>(null);
  const pending = ref(false);
  const failed = ref(false);
  let inFlight: Promise<boolean> | null = null;

  const available = computed(() => port.value !== null);

  async function load(): Promise<boolean> {
    if (port.value !== null) return true;

    const loader = options.loader;
    if (loader === undefined) return false;

    // The second caller waits on the first rather than fetching the index twice, which is the
    // whole point of the store: opening the palette, closing it and opening it again is one
    // request, and on a large document that request is the largest thing the page ever asks for.
    inFlight ??= (async (): Promise<boolean> => {
      pending.value = true;
      failed.value = false;

      try {
        port.value = readSearchIndex(await loader(), options.documentHash);
        return true;
      } catch {
        // FAIL OPEN AND REMEMBER THAT IT FAILED. The palette keeps matching the navigation, and
        // `failed` is what stops it claiming the whole document was searched. Cleared in flight
        // so that a later open tries again: the first attempt may have been made offline.
        failed.value = true;
        inFlight = null;
        return false;
      } finally {
        pending.value = false;
      }
    })();

    return inFlight;
  }

  return { port, available, pending, failed, load };
}

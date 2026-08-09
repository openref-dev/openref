import { computed } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { useDocState } from '../state/api/context';
import type { SearchHit } from '../state/application/ports/search.port';

/**
 * Search over the document.
 *
 * The index is not built here. `@openref/vue` depends on `@openref/core` and nothing else, so
 * an index reaches this layer through the search port, handed in by whoever wired the
 * application. With no index the composable reports itself unavailable and returns nothing,
 * which is honest: an empty result list and a missing index look identical to a user, and
 * only one of them is a working search.
 */
export interface UseSearch {
  readonly query: Ref<string>;
  /** Whether an index was supplied. A theme hides the search box when this is false. */
  readonly available: boolean;
  readonly hits: ComputedRef<readonly SearchHit[]>;
  readonly hasQuery: ComputedRef<boolean>;
  search(query: string): void;
  clear(): void;
}

/** Hits returned when nothing narrows the request further. */
export const DEFAULT_HIT_LIMIT = 20;

/**
 * @param limit - Greatest number of hits to return
 * @returns The query and its results
 * @throws {ThemeContractError} When no state was provided above
 *
 * @example
 * const { query, hits, available } = useSearch();
 */
export function useSearch(limit: number = DEFAULT_HIT_LIMIT): UseSearch {
  const state = useDocState();
  const index = state.search;

  return {
    query: state.query,
    available: index !== undefined,
    hits: computed(() => {
      const query = state.query.value.trim();
      if (index === undefined || query === '') return [];
      return index.search(query, limit);
    }),
    hasQuery: computed(() => state.query.value.trim() !== ''),
    search: (query) => {
      state.query.value = query;
    },
    clear: () => {
      state.query.value = '';
    },
  };
}

/**
 * The one copy of the navigation a page holds, and the one fetch that completes it.
 *
 * The sidebar and the palette ask the same question, "what is the whole navigation", and they
 * ask it at different moments: the sidebar when a reader opens a closed group, the palette
 * when a reader opens it. Two components each holding their own copy would fetch the payload
 * twice and then disagree about it, so there is one store, created where the page model is and
 * handed down.
 *
 * INJECTION WITH A WORKING DEFAULT, rather than a required provide. A component mounted on its
 * own, which is how most of the tests use them, has no store and needs none: it renders what
 * its `entries` prop carries and nothing offers to open anything that is not in it. That is
 * also exactly the behaviour of a server render, where fetching is not merely unavailable but
 * wrong.
 */

import { computed, ref, shallowRef, type ComputedRef, type InjectionKey, type Ref } from 'vue';
import { readNavigationPayload, type NavigationLoader } from '../domain/nav-source';
import type { NavEntryModel } from '../domain/nav-entry';

/** What both navigation components read. */
export interface NavigationStore {
  /** The whole navigation once it has been fetched, the page's slice until then. */
  readonly entries: ComputedRef<readonly NavEntryModel[]>;
  /** True when `entries` is everything, whether it shipped that way or was fetched. */
  readonly complete: ComputedRef<boolean>;
  /** True while a fetch is in flight. */
  readonly pending: Ref<boolean>;
  /** Set when a fetch failed, so the sidebar can say so instead of appearing to be empty. */
  readonly failed: Ref<boolean>;
  /**
   * Fetches the rest, once.
   *
   * @returns True when the whole navigation is available afterwards
   */
  load(): Promise<boolean>;
}

/** Key the store is provided under. */
export const NAVIGATION_KEY: InjectionKey<NavigationStore> = Symbol.for('openref.navigation');

/** What the store is built from. */
export interface NavigationStoreOptions {
  /** The slice the page shipped. */
  readonly entries: readonly NavEntryModel[];
  /** Whether that slice is the whole navigation. */
  readonly complete: boolean;
  /** How the rest is fetched. Absent leaves the store unable to complete, which is honest. */
  readonly loader?: NavigationLoader;
}

/**
 * Builds the store for one page.
 *
 * @param options - The slice, the document it belongs to and how to fetch the rest
 * @returns The store
 */
export function createNavigationStore(options: NavigationStoreOptions): NavigationStore {
  // shallowRef, for the same reason the document is one in `@openref/vue`: this is a large
  // frozen tree that is replaced whole and never mutated, so deep reactivity would buy proxies
  // over every entry to observe changes that cannot happen.
  const loaded = shallowRef<readonly NavEntryModel[] | null>(null);
  const pending = ref(false);
  const failed = ref(false);
  let inFlight: Promise<boolean> | null = null;

  const entries = computed(() => loaded.value ?? options.entries);
  const complete = computed(() => options.complete || loaded.value !== null);

  async function load(): Promise<boolean> {
    if (complete.value) return true;

    const loader = options.loader;
    if (loader === undefined) return false;

    // The second caller waits on the first rather than starting a second fetch of the same
    // payload, which is the whole navigation and the cost this design exists to pay once.
    inFlight ??= (async (): Promise<boolean> => {
      pending.value = true;
      failed.value = false;

      try {
        loaded.value = await loader();
        return true;
      } catch {
        // FAIL OPEN AND SAY SO. The page keeps the navigation it shipped with, which is
        // enough to read this operation and to reach its neighbours, and the sidebar tells
        // the reader that the rest could not be loaded. Throwing here would take the sidebar
        // down over a request that is not what the reader asked for.
        failed.value = true;
        inFlight = null;
        return false;
      } finally {
        pending.value = false;
      }
    })();

    return inFlight;
  }

  return { entries, complete, pending, failed, load };
}

/**
 * Reads a navigation payload from a response body.
 *
 * Re-exported here so a host composing its own loader has one import rather than two.
 */
export { readNavigationPayload };
export type { NavigationLoader };

/**
 * Where a component gets the rest of the navigation from.
 *
 * The page ships what it can draw and the rest is fetched once, per `nav-payload.ts`. The
 * fetch itself is not written into a component: the sidebar and the palette both need it, a
 * server render must never perform it, and a static build will answer it from a file rather
 * than from a route. So it arrives as a function, and every one of those cases is a different
 * function rather than a flag inside one.
 *
 * ONE FETCH PER PAGE, SHARED. Opening a group and opening the palette in the same second are
 * two calls, and the second waits on the first rather than starting another: the payload is
 * the whole navigation, and fetching it twice would double the one cost this change exists to
 * remove.
 */

import type { NavEntryModel } from './nav-entry';

/** Fetches the whole navigation of the document this page is about. */
export type NavigationLoader = () => Promise<readonly NavEntryModel[]>;

/** What the navigation payload looks like on the wire. */
export interface NavigationPayload {
  /** Hash of the document it describes, so a stale payload is refused rather than rendered. */
  readonly documentHash: string;
  readonly navigation: readonly NavEntryModel[];
}

/**
 * Reads a navigation payload, refusing one that is about another document.
 *
 * @param value - Whatever the response body parsed to
 * @param documentHash - Hash of the document the page is about
 * @returns The entries
 * @throws Error when the payload is not one, or describes another document
 */
export function readNavigationPayload(
  value: unknown,
  documentHash: string,
): readonly NavEntryModel[] {
  if (value === null || typeof value !== 'object') {
    throw new Error('the navigation payload is not an object');
  }

  const payload = value as Partial<NavigationPayload>;

  if (payload.documentHash !== documentHash) {
    // A HASH ADDRESSED URL CAN STILL ANSWER WITH THE WRONG THING, through a proxy that
    // rewrites, a cache that outlived a deployment, or a host that mounted two documents and
    // crossed them. Rendering it would put another document's operations in this sidebar.
    throw new Error(
      `the navigation payload is about ${String(payload.documentHash)} and this page is about ${documentHash}`,
    );
  }

  if (!Array.isArray(payload.navigation)) {
    throw new Error('the navigation payload carries no navigation');
  }

  return payload.navigation as readonly NavEntryModel[];
}

/**
 * Search over the navigation the page already carries.
 *
 * WHY NOT MiniSearch. `@openref/search` builds the real index, and the dependency rule of
 * STANDARDS 3.5 gives `render` no edge to it: the index reaches a consumer through
 * `ISearchPort`, which `@openref/vue` defines and which whoever wires the application supplies.
 * The browser bundle of the reference wires nothing, so it has no port, and shipping a
 * serialized index into every page would put 250 KB on a page for a feature that is one
 * keystroke deep.
 *
 * What it does instead is match what the page is already holding: every navigation row, with
 * its label and its `METHOD /path` hint. That covers what a reader types into a palette on a
 * reference, which is a path, a method or part of a summary. No shipped path supplies a port
 * today: that gap is `full-text-search` in `CAPABILITY_DEBTS`, owned by T039, reachable by M3.
 * When a port is supplied, it replaces this rather than adding to it.
 *
 * The ranking is deliberately simple and deliberately stable. A prefix beats a word start
 * beats a substring, a label beats a hint, and equal scores keep document order, so the same
 * query over the same document always produces the same list.
 */

import type { NavRow } from './nav-rows';

/** One result, with the score that put it there. */
export interface NavHit {
  readonly row: NavRow;
  readonly score: number;
}

/** Results returned when nothing narrows the request further. */
export const NAV_HIT_LIMIT = 20;

/**
 * How well one field matches a query.
 *
 * @returns 3 for a prefix, 2 for the start of a word, 1 for a substring, 0 for no match
 */
function scoreField(field: string, query: string): number {
  if (field === '') return 0;

  const haystack = field.toLowerCase();
  const at = haystack.indexOf(query);

  if (at === -1) return 0;
  if (at === 0) return 3;

  const before = haystack.charAt(at - 1);
  return /[^a-z0-9]/.test(before) ? 2 : 1;
}

/**
 * Rows matching a query, best first.
 *
 * A group is never a hit: it has no page to go to, and a palette entry that navigates nowhere
 * is worse than one that is missing.
 *
 * @param rows - Flattened navigation
 * @param query - What the reader typed
 * @param limit - Greatest number of hits, defaults to {@link NAV_HIT_LIMIT}
 * @returns Hits in rank order, empty when the query is blank
 *
 * @example
 * searchNavigation(rows, '/orders').map((hit) => hit.row.label);
 */
export function searchNavigation(
  rows: readonly NavRow[],
  query: string,
  limit: number = NAV_HIT_LIMIT,
): NavHit[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];

  const hits: NavHit[] = [];

  for (const row of rows) {
    if (row.nodeId === null && row.schemaId === null) continue;

    // A label match outranks a hint match at the same quality, which is what puts an operation
    // called "List orders" above one whose path merely contains the word.
    const score = Math.max(scoreField(row.label, needle) * 2, scoreField(row.hint, needle));
    if (score > 0) hits.push({ row, score });
  }

  // A stable sort, so equal scores keep the order the document put them in.
  return hits.sort((left, right) => right.score - left.score).slice(0, limit);
}

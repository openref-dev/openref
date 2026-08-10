/**
 * The navigation one page carries, and the rest of it, which arrives when it is asked for.
 *
 * WHY THIS EXISTS, measured rather than felt. T015 measured the served page of the thousand
 * node document in a real browser: 191,975 bytes, of which 176,011 was the state block and
 * 173,412 of that was the navigation. The markup a reader can see was 16 KB. Median TTI was
 * 228 ms against a 150 ms budget, and the dominant phase was not hydration at 76 ms but
 * parsing the served document at 143 ms. The page was ninety percent a JSON index of a
 * thousand nodes, and the sidebar can show about sixty rows of it.
 *
 * IT IS ALSO A DECISION THAT WAS REVERSED WITHOUT ANYONE MAKING IT. T012 declined to inline a
 * 250 KB search index into every page, deliberately, because searching is one keystroke deep.
 * The navigation blob was 173 KB, seventy percent of what had been declined, and it arrived by
 * a different route with no such decision attached to it.
 *
 * WHAT SHIPS. Everything the sidebar can draw before the reader touches it: the top level, the
 * ancestors of the entry this page is about, and the entries beside those ancestors at every
 * level, which are that entry's siblings. A group nobody has opened ships as a header with a
 * count and no children. On the thousand node document that is 71 rows of 1022 and 11 KB of
 * 173 KB.
 *
 * WHAT DOES NOT. Everything under a closed group, which is fetched once, from the reader's own
 * origin, the first time a group is opened or the palette is opened. SPEC 19.4 is untouched by
 * that and the boundary is the one SPEC 14.4.1 already draws for a token refresh: a page that
 * was opened and not touched makes no request beyond loading itself, and a request the reader
 * caused by opening something is not the bundle calling home.
 *
 * THE COST IS BOUNDED BY THE OPEN GROUP, WHICH IS NOT THE SAME AS SMALL. A document whose
 * operations sit under few tags has large groups, and the open one ships whole: `stripe.yaml`
 * ships 591 rows of 2031 rather than 71 of 1022. That is stated here rather than discovered
 * later, because it is the shape of the guarantee: what a page carries is what it displays,
 * and a document that displays a great deal carries a great deal.
 */

import type { NavEntryModel } from './nav-entry';

/** The navigation a page ships, with what it left behind recorded rather than implied. */
export interface NavigationSlice {
  /** The entries, in tree shape, with closed groups carrying no children. */
  readonly entries: readonly NavEntryModel[];
  /** True when nothing was left out, so nothing can be fetched and nothing needs to be. */
  readonly complete: boolean;
  /** Rows in the slice, counting nested ones. */
  readonly shipped: number;
  /** Rows in the whole navigation. */
  readonly total: number;
}

/** Counts every entry of a tree, at any depth. */
function countRows(entries: readonly NavEntryModel[]): number {
  return entries.reduce((total, entry) => total + 1 + countRows(entry.children), 0);
}

/**
 * Whether an entry is the one the page is about.
 *
 * @param entry - Navigation entry
 * @param activeNodeId - Node the page shows, or null
 * @param activeSchemaId - Schema the page shows, or null
 * @returns True when this entry is that one
 */
function isActive(
  entry: NavEntryModel,
  activeNodeId: string | null,
  activeSchemaId: string | null,
): boolean {
  return (
    (activeNodeId !== null && entry.nodeId === activeNodeId) ||
    (activeSchemaId !== null && entry.schemaId === activeSchemaId)
  );
}

/**
 * The ids of the groups that hold the active entry, from the outermost in.
 *
 * @param entries - The whole navigation
 * @param activeNodeId - Node the page shows, or null
 * @param activeSchemaId - Schema the page shows, or null
 * @returns Ids of every ancestor of the active entry, empty when the page is about nothing in
 *   the navigation
 */
export function ancestorsOfActive(
  entries: readonly NavEntryModel[],
  activeNodeId: string | null,
  activeSchemaId: string | null,
): string[] {
  const found: string[] = [];

  const walk = (level: readonly NavEntryModel[], path: readonly string[]): boolean => {
    for (const entry of level) {
      if (isActive(entry, activeNodeId, activeSchemaId)) {
        found.push(...path);
        return true;
      }

      if (walk(entry.children, [...path, entry.id])) return true;
    }

    return false;
  };

  walk(entries, []);
  return found;
}

/**
 * Cuts the navigation down to what this page can show without asking for more.
 *
 * A group is opened when it holds the entry the page is about; every other group ships as a
 * header. `childCount` is on every entry either way, so a closed group is a group with
 * children rather than an empty one, and the sidebar can say so without having them.
 *
 * @param entries - The whole navigation, as `buildNavigation` produced it
 * @param activeNodeId - Node the page shows, or null
 * @param activeSchemaId - Schema the page shows, or null
 * @returns The slice, with what it dropped counted
 *
 * @example
 * sliceNavigation(navigation, 'get-resource-500', null).shipped; // 71 of 1022
 */
export function sliceNavigation(
  entries: readonly NavEntryModel[],
  activeNodeId: string | null,
  activeSchemaId: string | null,
): NavigationSlice {
  const open = new Set(ancestorsOfActive(entries, activeNodeId, activeSchemaId));

  const cut = (level: readonly NavEntryModel[]): NavEntryModel[] =>
    level.map((entry) => ({
      ...entry,
      children: open.has(entry.id) ? cut(entry.children) : [],
    }));

  const sliced = cut(entries);
  const shipped = countRows(sliced);
  const total = countRows(entries);

  return { entries: sliced, complete: shipped === total, shipped, total };
}

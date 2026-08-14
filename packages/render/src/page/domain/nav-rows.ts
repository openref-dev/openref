/**
 * The navigation, flattened into rows and cut into chunks.
 *
 * WHY THE SIDEBAR IS NOT A NESTED LIST OF EVERY ENTRY. `stripe.yaml` navigates 589 operations
 * and 1440 schemas, and its navigation alone is 427 KB of the page state. Rendering it whole
 * puts two thousand elements in the document on every page, which is the largest single thing
 * the browser is asked to do and it is asked to do it before the reader has scrolled anywhere.
 * SPEC 11 puts the ceiling at about sixty nodes in the DOM at once.
 *
 * WHY CHUNKS RATHER THAN A PIXEL WINDOW. The usual virtual list positions rows by pixel offset,
 * which means writing a computed length into the document, and this project cannot: STANDARDS
 * 10 forbids an inline style, and a value that varies per scroll position cannot come from a
 * class. A chunk of a fixed number of rows can: an unrendered chunk reserves its height through
 * one class, because every chunk holds the same number of rows.
 *
 * The window is derived from the scroll fraction rather than from a row height, so nothing here
 * needs to know how tall a row is, and the same arithmetic runs on the server, in a browser and
 * in a test.
 */

import type { NavEntryModel } from './nav-entry';

/** Rows per chunk. The theme reserves exactly this many row heights for a chunk it has not rendered. */
export const NAV_CHUNK_ROWS = 20;

/** Chunks rendered at once: the one in view and its neighbour on each side. */
export const NAV_CHUNK_WINDOW = 1;

/**
 * Greatest number of rows in the document at once, per SPEC 11.
 *
 * Three chunks of twenty. The ceiling is a consequence of the two constants above rather than a
 * number checked separately, and a test asserts the product against the spec figure.
 */
export const NAV_MAX_ROWS = NAV_CHUNK_ROWS * (NAV_CHUNK_WINDOW * 2 + 1);

/** One line of the sidebar. */
export interface NavRow {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly nodeId: string | null;
  readonly schemaId: string | null;
  readonly deprecated: boolean;
  /** Findings about this entry, summed over children for a group. Zero draws no marker. */
  readonly driftCount: number;
  /** `METHOD /path` for an operation, empty for a group. Shown and searched. */
  readonly hint: string;
  /** Depth in the original tree, from 1. Indentation is a data attribute the theme styles. */
  readonly level: number;
  /** Children this entry has in the whole navigation, whether or not this page carries them. */
  readonly childCount: number;
  /** True when this row's children are rendered under it. */
  readonly expanded: boolean;
}

/**
 * Flattens the navigation tree into the lines a reader scrolls through.
 *
 * WHAT IS OPEN IS THE DATA, NOT A DECISION TAKEN HERE. A page ships the children of the groups
 * it means to show open and nothing under the rest, per `nav-payload.ts`, so with no set given
 * the rows are exactly what arrived. Once the client has fetched the whole navigation it has
 * children under every group, and the set is what it opened; passing the set the slice implies
 * over the whole tree reproduces the server's rows exactly, which is what keeps the first
 * client render identical to the markup it hydrates.
 *
 * @param entries - The navigation, whole or sliced
 * @param expanded - Ids whose children are shown, or undefined for every child present
 * @returns Every visible entry, parents before children, with its depth
 *
 * @example
 * flattenNavigation(page.navigation).length; // 71 of 1022 on the thousand node document
 */
export function flattenNavigation(
  entries: readonly NavEntryModel[],
  expanded?: ReadonlySet<string>,
): NavRow[] {
  const rows: NavRow[] = [];

  const walk = (entry: NavEntryModel, level: number): void => {
    const open = entry.children.length > 0 && (expanded === undefined || expanded.has(entry.id));

    rows.push({
      id: entry.id,
      label: entry.label,
      kind: entry.kind,
      nodeId: entry.nodeId,
      schemaId: entry.schemaId,
      deprecated: entry.deprecated,
      driftCount: entry.driftCount,
      hint: entry.hint,
      level,
      childCount: entry.childCount,
      expanded: open,
    });

    if (!open) return;
    for (const child of entry.children) walk(child, level + 1);
  };

  for (const entry of entries) walk(entry, 1);
  return rows;
}

/**
 * The groups a slice arrived with open.
 *
 * A group whose children travelled with the page is a group the page renders open, so the
 * shipped shape is the initial state rather than a second copy of it. Read once, before
 * anything is fetched, because after the fetch every group has children and the shape no
 * longer says which ones were open.
 *
 * @param entries - The navigation as the page model carries it
 * @returns Ids of every entry that arrived with children
 */
export function expandedInSlice(entries: readonly NavEntryModel[]): Set<string> {
  const open = new Set<string>();

  const walk = (entry: NavEntryModel): void => {
    if (entry.children.length === 0) return;
    open.add(entry.id);
    for (const child of entry.children) walk(child);
  };

  for (const entry of entries) walk(entry);
  return open;
}

/** Rows in groups of {@link NAV_CHUNK_ROWS}, the last one short. */
export function chunkRows(rows: readonly NavRow[], size: number = NAV_CHUNK_ROWS): NavRow[][] {
  const chunks: NavRow[][] = [];

  for (let at = 0; at < rows.length; at += size) chunks.push(rows.slice(at, at + size));

  return chunks.length === 0 ? [[]] : chunks;
}

/** What a scroll container reports about itself. */
export interface ScrollPosition {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/**
 * The chunk a scroll position is looking at.
 *
 * Derived from the fraction scrolled rather than from a row height, because a row height is a
 * rendered measurement and this has to give the same answer on the server, where nothing is
 * rendered, as in the browser.
 *
 * @param position - What the container reports
 * @param chunkCount - How many chunks there are
 * @returns Index of the chunk in view, clamped into range
 */
export function chunkAt(position: ScrollPosition, chunkCount: number): number {
  if (chunkCount <= 1) return 0;

  const scrollable = position.scrollHeight - position.clientHeight;
  if (scrollable <= 0) return 0;

  const fraction = Math.min(Math.max(position.scrollTop / scrollable, 0), 1);
  return Math.round(fraction * (chunkCount - 1));
}

/**
 * Which chunks are rendered for a given chunk in view.
 *
 * @param current - Chunk in view
 * @param chunkCount - How many chunks there are
 * @param window - Neighbours on each side, defaults to {@link NAV_CHUNK_WINDOW}
 * @returns Indices to render, ascending
 */
export function chunkWindow(
  current: number,
  chunkCount: number,
  window: number = NAV_CHUNK_WINDOW,
): number[] {
  const first = Math.max(0, current - window);
  const last = Math.min(chunkCount - 1, current + window);
  const indices: number[] = [];

  for (let at = first; at <= last; at += 1) indices.push(at);

  return indices;
}

/**
 * The chunk holding the row that is open, so a page opens with its own entry in view.
 *
 * @param rows - Flattened navigation
 * @param activeNodeId - Node the page is about, or null
 * @param activeSchemaId - Schema the page is about, or null
 * @param size - Rows per chunk
 * @returns The chunk index, or 0 when nothing on the page is in the navigation
 */
export function chunkOfActive(
  rows: readonly NavRow[],
  activeNodeId: string | null,
  activeSchemaId: string | null,
  size: number = NAV_CHUNK_ROWS,
): number {
  const at = rows.findIndex(
    (row) =>
      (activeNodeId !== null && row.nodeId === activeNodeId) ||
      (activeSchemaId !== null && row.schemaId === activeSchemaId),
  );

  return at === -1 ? 0 : Math.floor(at / size);
}

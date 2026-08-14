/**
 * Where a page lives, as this theme has to work it out for itself.
 *
 * THIS FILE IS A FINDING BEFORE IT IS A UTILITY. `NavTree` is handed `NavEntryModel`s carrying a
 * `nodeId` and a `schemaId`, plus `basePath`, and it has to build the link. `CommandPalette` is
 * handed `PaletteHitModel`s that already carry a finished `href`. So one position of the contract
 * is given the answer and the other is given the parts, and the parts can only be assembled by
 * knowing the reference's own route table, which is in `@openref/render` and is not published.
 *
 * The three rules below are transcribed from `packages/render/src/page/domain/links.ts`. A theme
 * that transcribed one of them wrong ships a reference whose every navigation link is a 404, and
 * nothing in the contract, the conformance checker or this theme's own tests would say so: they
 * are `href` strings, and a wrong string is a string. `theme-boundary.spec.ts` is what makes them
 * fail here instead, by driving the links through the renderer's own route shapes.
 *
 * It is not worked around by importing the renderer. See `THEME-BOUNDARY.md`.
 */

/** Path of the document overview, relative to the mount point. */
export function overviewHref(basePath: string): string {
  return basePath === '' ? '/' : basePath;
}

/** Path of one node's page. The id is encoded, since it comes from a third party document. */
export function nodeHref(nodeId: string, basePath: string): string {
  return `${basePath}/${encodeURIComponent(nodeId)}`;
}

/** Path of one named schema's page, under the segment that keeps the two id spaces apart. */
export function schemaHref(schemaId: string, basePath: string): string {
  return `${basePath}/schema/${encodeURIComponent(schemaId)}`;
}

/** Where an entry of the navigation points, or nothing when it is a group. */
export function entryHref(
  entry: { readonly nodeId: string | null; readonly schemaId: string | null },
  basePath: string,
): string | null {
  if (entry.nodeId !== null) return nodeHref(entry.nodeId, basePath);
  if (entry.schemaId !== null) return schemaHref(entry.schemaId, basePath);
  return null;
}

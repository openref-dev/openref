/**
 * Where a page lives.
 *
 * One place decides this, because the server route table, the links in the navigation and
 * the file names a static build writes have to agree. A disagreement between them is a
 * broken link that no test of any single one of the three would catch.
 */

/** Path of the document overview, relative to the mount point. */
export const OVERVIEW_PATH = '/';

/**
 * Path of one node's page.
 *
 * The node id is already a slug produced by `operationNodeId`, but it is encoded anyway:
 * the id is derived from a path template written in a third party document, and treating
 * it as safe because it usually is would be the last assumption anyone checks.
 *
 * @param nodeId - Key into `IRDocument.nodes`
 * @param basePath - Where the reference is mounted, without a trailing slash
 * @returns Absolute path of the page
 */
export function nodeHref(nodeId: string, basePath = ''): string {
  return `${basePath}/${encodeURIComponent(nodeId)}`;
}

/**
 * Path of the overview page.
 *
 * @param basePath - Where the reference is mounted, without a trailing slash
 * @returns Absolute path of the overview
 */
export function overviewHref(basePath = ''): string {
  return basePath === '' ? OVERVIEW_PATH : basePath;
}

/** Segment under which the whole navigation is served, per page slice of it. */
export const NAVIGATION_SEGMENT = '_navigation';

/**
 * Where the rest of the navigation is fetched from.
 *
 * ADDRESSED BY DOCUMENT HASH, so the response is immutable and a reader who has it never asks
 * again, and so a deployment that changes the document changes the url rather than serving a
 * navigation that does not match the page holding it. The hash is already in the page, as
 * `PageModel.documentHash`, so nothing has to be threaded through to build this.
 *
 * @param documentHash - `IRDocument.hash`
 * @param basePath - Where the reference is mounted, without a trailing slash
 * @returns Absolute path of the navigation payload
 */
export function navigationHref(documentHash: string, basePath = ''): string {
  return `${basePath}/${NAVIGATION_SEGMENT}/${encodeURIComponent(documentHash)}`;
}

/** Segment that separates a schema page from a node page, so the two id spaces cannot collide. */
export const SCHEMA_SEGMENT = 'schema';

/**
 * Path of one named schema's page.
 *
 * A schema gets a page of its own for two reasons. The navigation already ends in a `Schemas`
 * group, which T004 appends and which had nowhere to link to; and a schema too far from a use
 * site to travel with the page is shown by linking to it rather than by being unreachable.
 *
 * THE ID IS THE STORED ONE, SUFFIX AND ALL. An external target is registered as
 * `<name>__<8 hex>` per SPEC 5.1.1 and the suffix is identity, not display: it belongs in the
 * URL, where identity is what a link needs, and nowhere a reader is shown.
 *
 * @param schemaId - Key into `IRDocument.schemas`
 * @param basePath - Where the reference is mounted, without a trailing slash
 * @returns Absolute path of the page
 */
export function schemaHref(schemaId: string, basePath = ''): string {
  return `${basePath}/${SCHEMA_SEGMENT}/${encodeURIComponent(schemaId)}`;
}

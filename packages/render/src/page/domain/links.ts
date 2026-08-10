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

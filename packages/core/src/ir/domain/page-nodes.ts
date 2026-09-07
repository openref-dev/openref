/**
 * Which node ids have a page, per SPEC 13.3 as amended 2026-09-05.
 *
 * IT IS IN `core` BECAUSE FOUR PACKAGES ANSWER THE SAME QUESTION AND THREE OF THEM CANNOT SEE EACH
 * OTHER. `@openref/render` builds the address and renders what is behind it, `@openref/search`
 * decides what the index stores and so what the palette links, `@openref/nest` resolves a request
 * back to an id, and `@openref/static` writes one file per id. Four readings of one set is how the
 * defect this file closes survived: `IRDocument` holds nodes in two maps, and every producer of a
 * link read both while the one consumer that resolves a link read one.
 *
 * WHY THERE ARE TWO MAPS AT ALL, since the obvious repair is to merge them and there is a reason
 * not to. `webhooks` is what a server calls and `nodes` is what a reader calls, and SPEC 5.4 keeps
 * them apart because `diff` matches nodes by method and path and a webhook has neither in that
 * sense. Merging them would move the IR, the document hash and every corpus snapshot with it, to
 * answer a question about addressing.
 *
 * `nodes` WINS A COLLISION. A path operation is what a page at a bare segment was before this rule
 * existed, so a document that manages to produce one id in both maps keeps the page it had. Only
 * `additionalOperations` with a method key of `webhook` can produce one, per SPEC 13.3, and it is
 * named there as a residual rather than a closed door.
 */

import type { IRDocument } from './document.types';
import type { IRNode } from './node.types';

/**
 * The node one page address is about, whichever map the document keeps it in.
 *
 * @param document - The normalized document
 * @param nodeId - Id from a link, a route parameter or a search hit
 * @returns The node, or nothing when no page is served under that id
 */
export function pageNode(document: IRDocument, nodeId: string): IRNode | undefined {
  return document.nodes.get(nodeId) ?? document.webhooks.get(nodeId);
}

/**
 * Every node that has a page, in one map, with `nodes` winning any collision.
 *
 * The order is webhooks first so that a later `nodes` entry overwrites, which is the collision rule
 * this module's header states, written as the construction rather than asserted beside it.
 *
 * @param document - The normalized document
 * @returns Id to node, for every address the node route answers
 */
export function pageNodes(document: IRDocument): ReadonlyMap<string, IRNode> {
  return new Map<string, IRNode>([...document.webhooks, ...document.nodes]);
}

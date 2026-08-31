/**
 * The audience marking of SPEC 13.4, and the one place its two strings are written.
 *
 * IT IS IN `core` BECAUSE IT HAS THREE READERS IN THREE PACKAGES THAT CANNOT SEE EACH OTHER.
 * `@openref/nest` writes the extension from `@ApiAudience`; `@openref/agent` filters the MCP
 * surface and the two text files by it; and since the SPEC 16.1 ruling of `T062` the static
 * build's `llms.txt` filters by it too, from `@openref/static`, which may see neither of the other
 * two. Before that ruling the key was spelled twice and the two spellings were held together by a
 * case, which is the arrangement STANDARDS calls a vocabulary with more than one owner. Three
 * spellings of a filter's key is a filter that silently matches nothing, and on this question
 * matching nothing means exposed.
 *
 * IT IS A DOCUMENTATION MARKING AND NOT AN ACCESS CONTROL, which SPEC 18.1 states and this file
 * repeats because the name invites the other reading. Who may reach the reference at all is
 * `visibility` and the guard of SPEC 19.6.
 */

import type { IRNode } from './node.types';

/** The extension `@ApiAudience` writes, per SPEC 13.4. */
export const AUDIENCE_EXTENSION = 'x-openref-audience';

/** The audience value that keeps a node off a machine readable surface, per SPEC 18. */
export const INTERNAL_AUDIENCE = 'internal';

/**
 * Whether one node is marked for internal eyes only.
 *
 * THE EXACT VALUE AND NOTHING ELSE. A node marked `Internal`, `internal-only` or anything else is
 * not marked internal: guessing at intent here would withhold what the author did not ask to have
 * withheld, and a marking nobody can predict is a marking nobody can rely on.
 *
 * @param node - The node
 * @returns True when its `x-openref-audience` extension reads `internal`
 *
 * @example
 * isInternalAudience(node); // true when the document wrote x-openref-audience: internal
 */
export function isInternalAudience(node: IRNode): boolean {
  return node.extensions?.[AUDIENCE_EXTENSION] === INTERNAL_AUDIENCE;
}

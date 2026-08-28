/**
 * What decides whether a page has to be rendered again.
 *
 * SPEC 16.3 asks for a rebuild keyed on node level hashes, and `IRNode` carries no hash of its
 * own: only `IRDocument.hash` exists, and it changes when any node does, so keying on it would
 * make every rebuild a full one. The key is therefore taken here, over the two things that can
 * change one page's bytes: the node itself, and the frame every page shares.
 *
 * THE FRAME IS THE DOCUMENT WITH ITS NODES REMOVED, and it is in the key because it is in the
 * page. A page draws the title, the servers, the navigation and the health report of the whole
 * document, so a change to any of them changes every page whether or not a node moved. Blanking
 * `nodes` and `hash` leaves exactly what a page reads about the document and nothing that
 * varies with the node.
 *
 * `canonicalize` AND NOT `JSON.stringify`, per STANDARDS: a `Map` iterates in insertion order
 * and any restructuring of the document would otherwise shuffle the bytes and invalidate every
 * key for no reason.
 */

import { canonicalize, sha256Hex, type IRDocument, type IRNode } from '@openref/core';

/** Version of what a page key covers. Bumped when a change here changes the same page's bytes. */
export const PAGE_KEY_VERSION = 1;

/**
 * The frame hash: everything a page reads about the document except its nodes.
 *
 * @param document - The normalized document
 * @returns A hash that changes when anything outside the nodes does
 */
export function frameHashOf(document: IRDocument): string {
  return sha256Hex(
    canonicalize({
      version: PAGE_KEY_VERSION,
      id: document.id,
      kind: document.kind,
      info: document.info,
      servers: document.servers,
      navigation: document.navigation,
      // THE SCHEMAS ARE IN THE FRAME RATHER THAN PER NODE, and that is a deliberate coarsening
      // rather than an oversight. A page carries a bounded slice of the schema payload whose
      // membership depends on what the page references, so attributing a schema to the nodes
      // that reach it would mean walking every reference to build a key. A changed schema
      // rebuilds every page; a changed operation rebuilds its own, which is the case SPEC 16.3
      // names and the case a rebuild is for.
      schemas: document.schemas,
      security: document.security,
      relationships: document.relationships,
      runtime: document.runtime ?? null,
      health: document.health ?? null,
      extensions: document.extensions ?? null,
    }),
  );
}

/**
 * The key of one page.
 *
 * @param frameHash - From {@link frameHashOf}
 * @param kind - Which page of the node, so a node and its bench are two keys
 * @param node - The node the page is about, or null for a page about the document
 * @param extra - Anything else that changes the bytes, such as the schema a page shows
 * @returns The key
 */
export function pageKeyOf(
  frameHash: string,
  kind: string,
  node: IRNode | null,
  extra = '',
): string {
  const nodePart = node === null ? '' : sha256Hex(canonicalize(node));
  return `${frameHash}:${kind}:${nodePart}:${extra}`;
}

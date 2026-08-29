/**
 * The one place a list of topology edges is put in order, per SPEC 9.
 *
 * TWO PRODUCERS AND ONE ORDER. Both normalizers build edges by walking their own document, and
 * `@openref/nest` adds more from what it read off the running application. `relationships` is an
 * array on {@link IRDocument}, so unlike `nodes` and `schemas` it is not a `Map` the canonical
 * serializer sorts on the way to the hash: its order is its own, and two walks that produced the
 * same edges in a different order would otherwise hash to two documents.
 */

import { compareByCodePoint } from '../../hashing/domain/canonical';
import type { IRRelationship } from '../../ir/domain/relationship.types';

/**
 * The sort key of one edge, which is every member of it.
 *
 * @param edge - The edge
 * @returns A key that two edges share only when they are the same edge
 */
function edgeKey(edge: IRRelationship): string {
  return JSON.stringify([
    edge.fromKind,
    edge.from,
    edge.type,
    edge.toKind,
    edge.to,
    edge.confidence,
  ]);
}

/**
 * Folds identical edges together and puts the rest in code point order.
 *
 * AN EDGE REPEATED IS ONE EDGE. A channel with two `send` operations says the same thing about
 * the topology twice, and a graph that drew the row twice would read as two publications. This is
 * the same fold `mergeRelationships` performs across services in `@openref/federation`, applied
 * within one document so that a document is already folded before it is merged.
 *
 * @param edges - Edges in whatever order they were produced
 * @returns The distinct edges, ordered deterministically
 *
 * @example
 * orderRelationships([edge, edge]); // [edge]
 */
export function orderRelationships(edges: readonly IRRelationship[]): IRRelationship[] {
  const seen = new Map<string, IRRelationship>();
  for (const edge of edges) {
    const key = edgeKey(edge);
    if (!seen.has(key)) seen.set(key, edge);
  }

  return [...seen.entries()]
    .sort(([left], [right]) => compareByCodePoint(left, right))
    .map(([, edge]) => edge);
}

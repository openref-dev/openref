/**
 * The topology graph, arranged for reading, per SPEC 9.5.
 *
 * WHY THE VIEW IS BUILT HERE AND NOT IN THE RENDERER. Nothing about grouping edges, resolving an
 * event name to a channel or deciding that a target leads nowhere is a rendering question, and all
 * three are the kind of thing a test wants to hold without a DOM. The renderer draws what this
 * returns and adds no rule of its own.
 *
 * THE GRAPH IS NEVER WALKED IN DEPTH, AND THAT IS THE WHOLE OF THE CYCLE ANSWER. A topology of
 * real services has cycles in it as a matter of course, `orders` publishing what `billing`
 * consumes and back again, and a renderer that expanded a chain would either hang or need a
 * visited set whose depth is a rendering decision. An adjacency list has neither problem: each
 * endpoint is drawn once with its outgoing edges, a cycle is three groups pointing at each other,
 * and the layout cost is linear in the number of edges whatever the shape is.
 */

import { compareByCodePoint } from '../../hashing/domain/canonical';
import type { IRConfidence } from '../../ir/domain/confidence.types';
import type { IRDocument } from '../../ir/domain/document.types';
import type { IRNode } from '../../ir/domain/node.types';
import type {
  IRRelationshipEndpointKind,
  IRRelationshipType,
} from '../../ir/domain/relationship.types';
import { orderRelationships } from './relationships';

/** One end of an edge, with what the document turned out to have for it. */
export interface IRTopologyEndpoint {
  /** The value the edge carried, unchanged. */
  readonly name: string;
  /** What the edge said this end is, per SPEC 9.1. Never rewritten by resolution. */
  readonly kind: IRRelationshipEndpointKind;
  /**
   * The node this end turned out to name, when it names one.
   *
   * Absent on a `service` end, on a `node` end whose node is not in this document, and on an
   * `event` end that no channel address matches or that two channels match at once. The
   * distinction from {@link IRTopologyEndpoint.kind} is the point: `kind` is what was declared
   * and this is what was found, and a reader is owed both.
   */
  readonly nodeId?: string;
  /** What to show: an address, a method and path, or the name itself when nothing was found. */
  readonly label: string;
}

/** One outgoing edge of a group. */
export interface IRTopologyEdge {
  readonly to: IRTopologyEndpoint;
  readonly type: IRRelationshipType;
  readonly confidence: IRConfidence;
  /**
   * Whether nothing at all leaves the target.
   *
   * A dead end is drawn rather than dropped, per SPEC 9.5: an event nobody consumes is a fact
   * about the estate, and the one thing a topology view must never do is make it look consumed.
   */
  readonly deadEnd: boolean;
}

/** Every edge leaving one endpoint. */
export interface IRTopologyGroup {
  readonly from: IRTopologyEndpoint;
  readonly edges: readonly IRTopologyEdge[];
}

/**
 * The whole graph, grouped by source endpoint.
 *
 * `duplicateCount` WAS HERE AND IS GONE, deleted by the second review of `T052` rather than wired
 * to a reader. It counted edges the document listed more than once and this folded into one, and
 * measurement is what removed it: every producer in the repository folds before this is reached,
 * both normalizers and the `@openref/nest` runtime pass through `orderRelationships` and the
 * federated merge through `mergeRelationships`, so over the whole corpus, 40 documents of which 26
 * declare edges, the count was zero every time. A page drawing it would have drawn a constant, and
 * SPEC 0's rule is that a field either has a producer and a reader or it goes. What it was standing
 * in for, that the fold below changes nothing on a real document, is now asserted directly.
 */
export interface IRTopology {
  readonly groups: readonly IRTopologyGroup[];
  /** Edges drawn, after identical ones are folded together. */
  readonly edgeCount: number;
}

/**
 * A stable key for one endpoint, keyed by what it turned out to be rather than by how it was
 * spelled.
 *
 * TWO SPELLINGS OF ONE NODE ARE ONE PLACE IN THE GRAPH, and this is where that is decided. An
 * `event` end that resolved to a channel and a `node` end naming that same channel are the same
 * channel: keying by the spelling would give the channel two groups, and, worse, would call the
 * resolved one a dead end, because the outgoing edges of the channel are declared against its node
 * id. A name that resolved to nothing keeps its own kind, so a node called `orders` and a service
 * called `orders` stay two places, which is the distinction SPEC 9.1 exists for.
 *
 * @param endpoint - The endpoint, already resolved
 * @returns The key
 */
function endpointKey(endpoint: IRTopologyEndpoint): string {
  return endpoint.nodeId === undefined
    ? JSON.stringify([endpoint.kind, endpoint.name])
    : JSON.stringify(['node', endpoint.nodeId]);
}

/**
 * What a reader sees for a node.
 *
 * @param node - The node the end resolved to
 * @returns The label
 */
function nodeLabel(node: IRNode): string {
  return node.kind === 'channel'
    ? (node.address ?? node.title ?? node.id)
    : `${node.method.toUpperCase()} ${node.path}`;
}

/**
 * Indexes every channel address that exactly one channel in the document answers.
 *
 * ONLY AN ADDRESS ONE CHANNEL HOLDS IS A RESOLUTION, per SPEC 9.5. Two channels sharing an
 * address is an ambiguity, and picking either would be the guess this project's confidence policy
 * exists to refuse, so the name stays unresolved and the view says so by drawing it unlinked.
 *
 * @param document - The document the graph belongs to
 * @returns Address to node id, holding only the addresses with exactly one channel
 */
function channelsByAddress(document: IRDocument): ReadonlyMap<string, string> {
  const counts = new Map<string, string | null>();

  for (const [id, node] of document.nodes) {
    if (node.kind !== 'channel' || node.address === undefined) continue;
    counts.set(node.address, counts.has(node.address) ? null : id);
  }

  const resolved = new Map<string, string>();
  for (const [address, id] of counts) if (id !== null) resolved.set(address, id);
  return resolved;
}

/**
 * Builds one end of an edge, resolving it against the document as far as the document allows.
 *
 * @param kind - What the edge said the end is
 * @param name - The value the edge carried
 * @param nodes - Every node of the document, its own and its webhooks
 * @param addresses - Channel addresses that exactly one channel answers
 * @returns The endpoint, with `nodeId` set only where something was actually found
 */
function endpointOf(
  kind: IRRelationshipEndpointKind,
  name: string,
  nodes: ReadonlyMap<string, IRNode>,
  addresses: ReadonlyMap<string, string>,
): IRTopologyEndpoint {
  const id = kind === 'node' ? name : kind === 'event' ? addresses.get(name) : undefined;
  const node = id === undefined ? undefined : nodes.get(id);

  return node === undefined || id === undefined
    ? { name, kind, label: name }
    : { name, kind, nodeId: id, label: nodeLabel(node) };
}

/**
 * Arranges a document's declared edges into the adjacency list SPEC 9.5 draws.
 *
 * IDENTICAL EDGES ARE FOLDED BY THE SAME FUNCTION THE PRODUCERS USE. Both normalizers, the
 * `@openref/nest` runtime pass and the federated merge already fold what they build, so a document
 * that reaches here is folded already and this changes nothing on any of them, which is asserted
 * over the corpus rather than assumed. Running it again is what makes the view right for a document
 * assembled anywhere else, which is a hand built one and nothing this repository produces.
 *
 * @param document - Any document, merged or not
 * @returns The graph, grouped by source endpoint and ordered deterministically
 *
 * @example
 * const topology = buildTopology(document);
 * for (const group of topology.groups) console.log(group.from.label, group.edges.length);
 */
export function buildTopology(document: IRDocument): IRTopology {
  const nodes = new Map<string, IRNode>([...document.nodes, ...document.webhooks]);
  const addresses = channelsByAddress(document);

  const kept = orderRelationships(document.relationships);

  const resolved = kept.map((edge) => ({
    edge,
    from: endpointOf(edge.fromKind, edge.from, nodes, addresses),
    to: endpointOf(edge.toKind, edge.to, nodes, addresses),
  }));

  // AN ENDPOINT LEADS SOMEWHERE WHEN IT IS THE SOURCE OF AN EDGE, and that is the only reading of
  // a dead end this document can support. It is deliberately not "the node exists": a channel
  // that is documented and that nothing consumes is exactly the case the task names.
  const sources = new Set(resolved.map((entry) => endpointKey(entry.from)));

  const groups = new Map<string, { from: IRTopologyEndpoint; edges: IRTopologyEdge[] }>();
  for (const entry of resolved) {
    const key = endpointKey(entry.from);
    let group = groups.get(key);
    if (group === undefined) {
      group = { from: entry.from, edges: [] };
      groups.set(key, group);
    }
    group.edges.push({
      to: entry.to,
      type: entry.edge.type,
      confidence: entry.edge.confidence,
      deadEnd: !sources.has(endpointKey(entry.to)),
    });
  }

  const ordered = [...groups.entries()]
    .sort(([left], [right]) => compareByCodePoint(left, right))
    .map(([, group]) => ({
      from: group.from,
      edges: group.edges.sort((left, right) =>
        left.type === right.type
          ? compareByCodePoint(endpointKey(left.to), endpointKey(right.to))
          : compareByCodePoint(left.type, right.type),
      ),
    }));

  return { groups: ordered, edgeCount: kept.length };
}

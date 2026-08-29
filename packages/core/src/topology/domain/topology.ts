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
  /**
   * Whether this document holds nothing at all under the end's name, per SPEC 9.5.
   *
   * NOT THE SAME QUESTION AS `nodeId`, and that is the whole reason the member exists. An unset
   * `nodeId` meant four things at once: a `service` end, which never resolves to a node however
   * well known the service is; a `node` end from a service nobody federated in; an `event`
   * address no channel answers; and an `event` address two channels answer. Only the middle two
   * lead outside the known set, and a page that drew all four alike could not tell a reader
   * whether the target was missing or merely unlinkable.
   *
   * The known set is `nodes` and `webhooks` for a `node` end, `IRService.id` of a merged document
   * or `IRDocument.id` of an unmerged one for a `service` end, and the channel addresses of the
   * document for an `event` end. AMBIGUITY IS INSIDE: an address two channels answer is held by
   * this document, so it stays unresolved and not marked, because marking it would print a false
   * statement about a document that describes those channels.
   */
  readonly outside: boolean;
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

/** What the document's channels answer to: what resolves, and what it holds at all. */
interface ChannelAddresses {
  /** Address to node id, holding only the addresses with exactly one channel. */
  readonly resolved: ReadonlyMap<string, string>;
  /** Every address any channel answers, ambiguous ones included, per SPEC 9.5. */
  readonly held: ReadonlySet<string>;
}

/**
 * Indexes every channel address that exactly one channel in the document answers.
 *
 * ONLY AN ADDRESS ONE CHANNEL HOLDS IS A RESOLUTION, per SPEC 9.5. Two channels sharing an
 * address is an ambiguity, and picking either would be the guess this project's confidence policy
 * exists to refuse, so the name stays unresolved and the view says so by drawing it unlinked.
 *
 * THE TWO ANSWERS ARE KEPT APART BECAUSE THEY ARE DIFFERENT FACTS. An ambiguous address is held
 * by this document and cannot be linked; an unknown one is not here at all. `held` is what says
 * which, and it is why `outside` can be false for a name that resolved to nothing.
 *
 * @param document - The document the graph belongs to
 * @returns What resolves, and every address a channel of this document answers
 */
function channelsByAddress(document: IRDocument): ChannelAddresses {
  const counts = new Map<string, string | null>();

  for (const [id, node] of document.nodes) {
    if (node.kind !== 'channel' || node.address === undefined) continue;
    counts.set(node.address, counts.has(node.address) ? null : id);
  }

  const resolved = new Map<string, string>();
  for (const [address, id] of counts) if (id !== null) resolved.set(address, id);
  return { resolved, held: new Set(counts.keys()) };
}

/**
 * The service names this document knows, per SPEC 9.1.
 *
 * A merged document names its members in `IRDocument.services`; an unmerged one is a single
 * service and the only name it can vouch for is its own id, which is what the merge rewrites into
 * a `serviceId` when it federates that document. A name outside this set is a service somebody
 * declared an edge to and nobody federated in, which is a true statement about the estate and is
 * exactly what the mark exists to show.
 *
 * @param document - The document the graph belongs to
 * @returns Every service name this document holds
 */
function knownServices(document: IRDocument): ReadonlySet<string> {
  const services = document.services ?? [];
  return services.length === 0
    ? new Set([document.id])
    : new Set(services.map((service) => service.id));
}

/**
 * Builds one end of an edge, resolving it against the document as far as the document allows.
 *
 * @param kind - What the edge said the end is
 * @param name - The value the edge carried
 * @param nodes - Every node of the document, its own and its webhooks
 * @param addresses - What this document's channels answer to
 * @param services - Service names this document knows
 * @returns The endpoint, with `nodeId` set only where something was found, and `outside` set only
 *          where nothing under the name is here at all
 */
function endpointOf(
  kind: IRRelationshipEndpointKind,
  name: string,
  nodes: ReadonlyMap<string, IRNode>,
  addresses: ChannelAddresses,
  services: ReadonlySet<string>,
): IRTopologyEndpoint {
  const id = kind === 'node' ? name : kind === 'event' ? addresses.resolved.get(name) : undefined;
  const node = id === undefined ? undefined : nodes.get(id);

  if (node !== undefined && id !== undefined) {
    return { name, kind, nodeId: id, label: nodeLabel(node), outside: false };
  }

  const outside =
    kind === 'service'
      ? !services.has(name)
      : kind === 'event'
        ? !addresses.held.has(name)
        : !nodes.has(name);

  return { name, kind, label: name, outside };
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
  const services = knownServices(document);

  const kept = orderRelationships(document.relationships);

  const resolved = kept.map((edge) => ({
    edge,
    from: endpointOf(edge.fromKind, edge.from, nodes, addresses, services),
    to: endpointOf(edge.toKind, edge.to, nodes, addresses, services),
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

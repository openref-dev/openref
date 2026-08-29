import type { IRConfidence } from './confidence.types';

/** How one node relates to another, per SPEC 9. */
export type IRRelationshipType = 'publishes' | 'subscribes' | 'calls' | 'webhook' | 'callback';

/**
 * What one end of an edge names, per SPEC 9.1.
 *
 * THE THREE NAMES REPLACE A SENTENCE IN A DOC COMMENT, and the sentence is why they exist.
 * Until `T052` both ends were plain strings documented as "a node id, or a service name", which
 * is a separation promised in prose and left out of the type. Two places in this repository paid
 * for that: the federated merge rewrote an end by the rule "a value the rewrite map knows is a
 * node id", which is a coincidence standing in for a fact, and `unresolvedReferences` refused to
 * check edges at all because a checker cannot tell a service called `payments` from a node that
 * was dropped.
 */
export type IRRelationshipEndpointKind =
  /** A key into {@link IRDocument.nodes} or {@link IRDocument.webhooks}. */
  | 'node'
  /** A service name: `IRService.id` in a merged document, `IRDocument.id` in one that is not. */
  | 'service'
  /** An event name this document holds no channel for, which is what `@ApiPublishes` declares. */
  | 'event';

/**
 * An edge in the service topology.
 *
 * Policy from SPEC 9: relationships are declared explicitly. Automatic inference is only ever
 * emitted with `confidence: 'inferred'`, because static analysis of what a handler publishes
 * is unreliable and must not be presented as fact. No producer of that level ships in M5, and
 * SPEC 9.4 records that rather than leaving it to be noticed.
 *
 * THE ARROW POINTS WHERE THE MESSAGE GOES, per SPEC 9.2. `publishes` runs from the sender into
 * the channel and `subscribes` runs from the channel into the receiver, so the two are opposite
 * sides of a channel rather than two spellings of one fact.
 */
export interface IRRelationship {
  /** What the edge starts at. Read with {@link IRRelationship.fromKind}. */
  readonly from: string;
  readonly fromKind: IRRelationshipEndpointKind;
  /** What the edge ends at. Read with {@link IRRelationship.toKind}. */
  readonly to: string;
  readonly toKind: IRRelationshipEndpointKind;
  readonly type: IRRelationshipType;
  readonly confidence: IRConfidence;
}

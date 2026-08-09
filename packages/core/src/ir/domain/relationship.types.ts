import type { IRConfidence } from './confidence.types';

/** How one node relates to another, per SPEC 9. */
export type IRRelationshipType = 'publishes' | 'subscribes' | 'calls' | 'webhook' | 'callback';

/**
 * An edge in the service topology.
 *
 * Policy from SPEC 9: relationships are declared explicitly. Automatic inference is only ever
 * emitted with `confidence: 'inferred'`, because static analysis of what a handler publishes
 * is unreliable and must not be presented as fact.
 */
export interface IRRelationship {
  /** Node id, or service name, the edge starts at. */
  readonly from: string;
  /** Node id, or service name, the edge ends at. */
  readonly to: string;
  readonly type: IRRelationshipType;
  readonly confidence: IRConfidence;
}

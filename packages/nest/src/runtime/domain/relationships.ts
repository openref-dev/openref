/**
 * The topology edges the running application declares, per SPEC 9.
 *
 * TWO JOBS, AND THEY PULL IN OPPOSITE DIRECTIONS ON PURPOSE. One adds edges: `@ApiPublishes` is a
 * person writing down what a handler publishes, which is the `declared` row of SPEC 9.3 and the
 * only relationship producer in this package. The other takes confidence away: an events document
 * is synthesized here and then normalized, so the normalizer marks every `send` and `receive` edge
 * `declared` because a document declares it, and for the operations whose direction this package
 * defaulted rather than read, that word is wrong.
 *
 * WHY THAT SECOND JOB IS NOT OPTIONAL. SPEC 6.1 has three levels and one rule behind them: a fact
 * carries the provenance of how it was actually obtained. A `@MessagePattern` handler with no
 * `@ApiChannel` tells this package that it receives on an address, and that reading is `derived`,
 * metadata under a key we know. Writing it into a synthesized AsyncAPI document turns it into a
 * sentence the document says, and reading that sentence back gives `declared`. Nothing was learned
 * in between: the confidence was laundered by a round trip through our own document. The downgrade
 * below is where the round trip is undone.
 *
 * IT ONLY EVER LOWERS. A downgrade that could raise a level would be the same defect facing the
 * other way, so the rank is compared and the weaker of the two always wins.
 */

import {
  orderRelationships,
  type IRConfidence,
  type IRDocument,
  type IRRelationship,
} from '@openref/core';
import type { CollectorTarget } from '../application/services/collector-registry.service';
import type { DiscoveryProblem } from '../infrastructure/adapters/controller-discovery.adapter';
import { OPENREF_METADATA } from '../../api/decorators/metadata';
import type { ReflectorLike } from '../../shared/types/nest-surface';

/** Rank of each level, high wins. The same three of SPEC 6.1 the fact merge ranks. */
const CONFIDENCE_RANK: Readonly<Record<IRConfidence, number>> = {
  declared: 3,
  derived: 2,
  inferred: 1,
};

/**
 * How confidently the direction of each synthesized channel was read, by node id.
 *
 * THE KEY IS THE NORMALIZER'S NODE ID, not the address and not the synthesis key, because the edge
 * this corrects carries a node id and matching on anything else would mean deriving that id a
 * second time. `channel-pairing.ts` already holds both halves and is where the map is built.
 *
 * ONE VALUE PER CHANNEL, AND WHERE ITS HANDLERS DISAGREE IT IS THE WEAKER ONE. A channel served by
 * one handler that wrote `@ApiChannel({ direction })` and one that did not has a declared reading
 * and a defaulted one, and this carries the defaulted one. That understates the declared half, and
 * understating is the direction this is allowed to be wrong in: the alternative is a defaulted
 * direction wearing the word `declared`, which is the whole defect. Such a channel is already
 * reported: more than one handler on an address is the ambiguity `pairChannels` refuses by name.
 */
export type ChannelDirectionConfidence = ReadonlyMap<string, IRConfidence>;

/** What reading `@ApiPublishes` over the paired handlers produced. */
export interface DeclaredRelationships {
  readonly edges: readonly IRRelationship[];
  readonly problems: readonly DiscoveryProblem[];
}

/**
 * Reads the event names off one handler.
 *
 * `getAllAndOverride`, THE SCOPES RULE: a handler that restates what it publishes replaces the
 * controller's list rather than adding to it, because writing the decorator a second time on the
 * method is how a person says "this one publishes these instead".
 *
 * @param target - The node, class and handler the pass is walking
 * @param reflector - Nest's reflector, narrowed
 * @returns Whatever was written under the key, untouched
 */
function readPublishes(target: CollectorTarget, reflector: ReflectorLike): unknown {
  return reflector.getAllAndOverride(OPENREF_METADATA.publishes, [
    target.handler,
    target.controller,
  ]);
}

/**
 * Builds the `publishes` edges the decorators of an application declare, per SPEC 9.3.
 *
 * `toKind` IS ALWAYS `event` AND NEVER `node`, and that is the honest reading rather than a
 * limitation. `@ApiPublishes('payment.created')` names an event, not a node of this document: the
 * channel is usually documented by whichever service consumes it, and writing the name into a
 * `node` end would put an id in the graph that resolves to nothing. SPEC 9.1 has the third kind
 * for exactly this, and `buildTopology` in `@openref/core` is the one place that tries to match an
 * event name to a channel address, so the match is made once rather than in every producer.
 *
 * A DECORATOR THAT NAMES NOTHING PRODUCES A PROBLEM AND NO EDGE, per SPEC 9.4. `@ApiPublishes()`
 * is somebody starting to write a declaration and stopping, and a graph that answered it with a
 * blank node would be a graph inventing an event. The same goes for a name that is not a string,
 * which is what an application in plain JavaScript reaches this with.
 *
 * @param targets - Every node paired with the handler that serves it
 * @param reflector - Nest's reflector, narrowed
 * @returns The edges, folded and ordered, and everything that could not be read
 */
export function declaredRelationships(
  targets: readonly CollectorTarget[],
  reflector: ReflectorLike,
): DeclaredRelationships {
  const edges: IRRelationship[] = [];
  const problems: DiscoveryProblem[] = [];

  for (const target of targets) {
    const raw = readPublishes(target, reflector);
    if (raw === undefined || raw === null) continue;

    const subject = `${target.declaredOn.name}.${target.handlerName}`;

    if (!Array.isArray(raw)) {
      problems.push({
        subject,
        reason:
          '@ApiPublishes wrote something other than a list of event names, so no topology edge ' +
          'was drawn for this handler. Pass event names: @ApiPublishes("payment.created")',
      });
      continue;
    }

    const names = raw.filter(
      (name): name is string => typeof name === 'string' && name.trim() !== '',
    );

    if (names.length !== raw.length) {
      problems.push({
        subject,
        reason:
          '@ApiPublishes was applied with something other than a non-empty event name, so that ' +
          'entry drew no topology edge. Pass event names: @ApiPublishes("payment.created")',
      });
    }

    if (raw.length === 0) {
      problems.push({
        subject,
        reason:
          '@ApiPublishes was applied with no event name, so it declares nothing and drew no ' +
          'topology edge. Pass event names: @ApiPublishes("payment.created")',
      });
      continue;
    }

    for (const name of names)
      edges.push({
        from: target.node.id,
        fromKind: 'node',
        to: name,
        toKind: 'event',
        type: 'publishes',
        confidence: 'declared',
      });
  }

  return { edges: orderRelationships(edges), problems };
}

/**
 * Lowers the confidence of every edge whose channel direction this package defaulted.
 *
 * ONLY `publishes` AND `subscribes` ARE TOUCHED, because they are the two edges an `action` makes.
 * A `calls` edge comes from `reply.channel`, which the synthesis never writes and a handed document
 * states outright, and `webhook` and `callback` cannot occur in an events document at all.
 *
 * A HANDED DOCUMENT IS NEVER TOUCHED, and it cannot be: the map is built from the channels this
 * package synthesized, so a document the host supplied contributes no keys and every edge of it
 * passes through unchanged.
 *
 * @param document - The document as the normalizer produced it
 * @param confidence - How the direction of each synthesized channel was read, by node id
 * @returns The same edges with the laundered ones marked for what they are
 */
export function withReadConfidence(
  document: IRDocument,
  confidence: ChannelDirectionConfidence,
): readonly IRRelationship[] {
  if (confidence.size === 0) return document.relationships;

  return document.relationships.map((edge) => {
    if (edge.type !== 'publishes' && edge.type !== 'subscribes') return edge;

    const nodeEnd =
      edge.fromKind === 'node' ? edge.from : edge.toKind === 'node' ? edge.to : undefined;
    const read = nodeEnd === undefined ? undefined : confidence.get(nodeEnd);
    if (read === undefined) return edge;

    // THE WEAKER OF THE TWO, ALWAYS. This function exists to take a word back, and one that could
    // also hand a stronger word out would be the same defect pointing the other way.
    return CONFIDENCE_RANK[read] < CONFIDENCE_RANK[edge.confidence]
      ? { ...edge, confidence: read }
      : edge;
  });
}

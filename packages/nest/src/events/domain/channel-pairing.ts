import type { IRConfidence, IRDocument } from '@openref/core';
import type { CollectorTarget } from '../../runtime/application/services/collector-registry.service';
import type { DiscoveryProblem } from '../../runtime/infrastructure/adapters/controller-discovery.adapter';
import type { ChannelDirectionConfidence } from '../../runtime/domain/relationships';
import type { SynthesizedChannel } from './asyncapi-synthesis';

/**
 * Pairing a synthesized channel with the handler that serves it, per SPEC 8.3.
 *
 * IT IS THE CHANNEL SIDE OF `route-pairing.ts` AND IT IS EASIER, because the two sides were built
 * from one another. An HTTP route has to be matched to a node somebody else wrote, through three
 * rules ordered from certain to inferred; a channel node exists because this discovery produced
 * it, so the pairing is a lookup by the address the synthesis wrote. What survives from that file
 * is its rule about ambiguity: anything that would attribute a fact to a node the handler does not
 * uniquely serve is reported rather than resolved by choosing.
 *
 * A CHANNEL WITH SEVERAL HANDLERS CARRIES NO FACTS, AND THAT IS THE AMBIGUITY RULE. A socket.io
 * gateway is one address that several `@SubscribeMessage` methods answer on, so guards read off
 * one of them are not guards on the channel: they are guards on one of its operations. Attaching
 * them to the channel would put one method's facts on a page describing all of them, which is the
 * wrong endpoint failure `route-pairing.ts` opens by naming. `IRChannelOperation.runtime` is where
 * the per operation answer belongs and no collector fills it yet, so the honest state today is a
 * channel with no runtime block and a problem saying why.
 */

/** What one channel pairing pass produced. */
export interface ChannelPairingResult {
  /** Node, class and handler, ready for the registry `T017` froze. */
  readonly targets: readonly CollectorTarget[];
  /** Channels no fact could be attributed to, with the reason. */
  readonly problems: readonly DiscoveryProblem[];
  /**
   * How confidently each channel's direction was read, by node id, per SPEC 9.3.
   *
   * IT COVERS EVERY CHANNEL AND NOT ONLY THE PAIRED ONES, which is the difference between this and
   * `targets`. A channel several handlers serve gets no runtime facts, by the ambiguity rule above,
   * but the normalizer still drew its topology edges, and those edges still need the word they
   * carry to be true. Leaving it out of this map would leave exactly the ambiguous case laundered.
   */
  readonly directionConfidence: ChannelDirectionConfidence;
}

/**
 * How the direction of one channel was read.
 *
 * `declared` ONLY WHEN A PERSON WROTE IT. `@ApiChannel({ direction })` is somebody documenting the
 * channel; anything else is `directionOf` in the synthesis defaulting to `receive` from the shape
 * of the framework decorator, which is SPEC 6.1's `derived`: metadata under a key we know.
 *
 * THE WEAKER READING WINS WHERE HANDLERS DISAGREE. See {@link ChannelDirectionConfidence}: the
 * result is one word for the channel, and of the two ways to be wrong, understating a declared
 * direction is the one that does not put the word `declared` on a default.
 *
 * @param channel - The synthesized channel and every handler that contributed to it
 * @returns The level to mark that channel's edges with
 */
function directionConfidenceOf(channel: SynthesizedChannel): IRConfidence {
  // A channel with no handlers cannot have been declared by one, and `every` over an empty list
  // says otherwise, which is the one way this predicate could hand out the stronger word for free.
  if (channel.handlers.length === 0) return 'derived';

  return channel.handlers.every((handler) => handler.declared?.value.direction !== undefined)
    ? 'declared'
    : 'derived';
}

/**
 * Pairs each synthesized channel with its handler, where there is exactly one.
 *
 * @param document - The normalized document the synthesis produced
 * @param channels - What the synthesis filed, by key and address
 * @returns The collector targets and everything that could not be attributed
 */
export function pairChannels(
  document: IRDocument,
  channels: readonly SynthesizedChannel[],
): ChannelPairingResult {
  const targets: CollectorTarget[] = [];
  const problems: DiscoveryProblem[] = [];
  const directionConfidence = new Map<string, IRConfidence>();

  // The address is what a channel is, and the synthesis groups by it, so it identifies one node.
  // The node id is derived from the address per SPEC 8.2 and is not recomputed here: two spellings
  // of one derivation is how they come to disagree.
  const byAddress = new Map<string, string>();
  for (const [id, node] of document.nodes) {
    if (node.kind !== 'channel' || node.address === undefined) continue;
    if (!byAddress.has(node.address)) byAddress.set(node.address, id);
  }

  for (const channel of channels) {
    const nodeId = byAddress.get(channel.address);
    const node = nodeId === undefined ? undefined : document.nodes.get(nodeId);
    if (node === undefined) {
      problems.push({
        subject: `the channel ${channel.address}`,
        reason:
          'it was discovered in the application and the normalized document holds no channel at ' +
          'that address, so no runtime fact could be attributed to it',
      });
      continue;
    }

    // RECORDED BEFORE THE TWO REFUSALS BELOW AND NOT AFTER THEM. The refusals are about attaching
    // runtime facts, and the edges exist either way, so a channel that gets no facts still needs
    // the word on its edges to be true.
    directionConfidence.set(node.id, directionConfidenceOf(channel));

    const [handler, ...rest] = channel.handlers;
    if (handler === undefined) continue;

    if (rest.length > 0) {
      problems.push({
        subject: `the channel ${channel.address}`,
        reason:
          `${String(rest.length + 1)} handlers serve it, so a fact read off any one of them is a ` +
          'fact about one of its operations rather than about the channel, and none is attached. ' +
          'The handlers are ' +
          channel.handlers
            .map((entry) => `${entry.controllerName}.${entry.handlerName}`)
            .join(', '),
      });
      continue;
    }

    targets.push({
      node,
      controller: handler.controller,
      declaredOn: handler.declaredOn,
      handler: handler.handler,
      handlerName: handler.handlerName,
    });
  }

  return { targets, problems, directionConfidence };
}

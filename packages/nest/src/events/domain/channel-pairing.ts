import type { IRDocument } from '@openref/core';
import type { CollectorTarget } from '../../runtime/application/services/collector-registry.service';
import type { DiscoveryProblem } from '../../runtime/infrastructure/adapters/controller-discovery.adapter';
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

  return { targets, problems };
}

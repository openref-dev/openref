/**
 * What `<route>/_bridge` answers, for both of the services that mount it.
 *
 * ONE IMPLEMENTATION BECAUSE THERE ARE TWO CALLERS, and the two callers are the reason the proxy
 * beside it drifted once already: `ReferenceService` answers this route on an ordinary mount and
 * `FederatedReferenceService` answers it on a federated one, and a second copy of the refusal
 * statuses would be a second set of wordings a reader could meet.
 */

import { NO_STORE } from '../../http/domain/reply';
import type { ErrorReporter } from '../../http/domain/reply';
import type {
  ReferenceReply,
  ReferenceRequest,
} from '../../http/application/ports/reference-http.port';
import type { BridgeService } from '../application/services/bridge.service';

/** Name of the query parameter carrying the channel a reader asks for. */
export const BRIDGE_CHANNEL_PARAM = 'channel';

/**
 * Opens one broker subscription, or refuses it and says why.
 *
 * THE ANSWER IS A STREAM AND NOT A DOCUMENT, which is the only route of SPEC 13.3 of which that is
 * true. Everything else a reference serves is a value the process already holds, so it goes out in
 * one write and carries an etag; this one stays open for as long as the reader wants it and is
 * paced by the limiter of SPEC 14.8 while it does.
 *
 * @param bridge - The mount's bridge
 * @param request - The request, for the channel in its query string
 * @param onError - Where a failure to subscribe is reported, if anywhere
 * @returns The event stream, or the refusal, always `no-store`
 */
export async function answerBridge(
  bridge: BridgeService,
  request: ReferenceRequest,
  onError: ErrorReporter | undefined,
): Promise<ReferenceReply> {
  let result;
  try {
    result = await bridge.open(request.query?.[BRIDGE_CHANNEL_PARAM]);
  } catch (cause: unknown) {
    // A SOURCE THAT COULD NOT SUBSCRIBE IS THE HOST'S BROKER AND NOT THE READER'S BUSINESS, so the
    // detail goes to the reporter and the reader gets a status. Same rule as the proxy's 502, and
    // the same reason.
    onError?.(cause);

    return bridgeRefusal(502, 'the broker subscription did not open');
  }

  if (result.refused !== undefined)
    return bridgeRefusal(result.refused.status, result.refused.reason);

  return {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': NO_STORE,
      // A REVERSE PROXY THAT BUFFERS IS A STREAM THAT ARRIVES ALL AT ONCE OR NOT AT ALL, which
      // looks to a reader exactly like a channel with nothing on it. This is the header nginx and
      // its relatives read, and it is inert everywhere else.
      'x-accel-buffering': 'no',
    },
    body: result.session.stream,
  };
}

/**
 * What the bridge answers when it will not open a subscription, per SPEC 14.8.
 *
 * THE STATUS COMES FROM THE REFUSAL RATHER THAN BEING FIXED AT 403, which is the one shape
 * difference from the proxy of SPEC 14.5. Four things can go wrong here and a reader acts on them
 * differently: 403 for a bridge that is off or a channel nobody may hear, 400 for a request that
 * named no channel, 429 for a ceiling somebody else is currently filling, 502 for a broker that
 * would not answer.
 *
 * @param status - What the wire should carry
 * @param reason - Why, phrased for whoever asked
 * @returns The refusal
 */
function bridgeRefusal(status: number, reason: string): ReferenceReply {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': NO_STORE },
    body: JSON.stringify({ error: reason }),
  };
}

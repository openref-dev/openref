/**
 * Opening a response and reading it as it arrives, which the send transport cannot do.
 *
 * A SECOND PORT RATHER THAN A FLAG ON THE FIRST. `IHttpTransport.send` returns a body, which
 * means it has read the whole of one, and a stream is the case where there is no whole. The two
 * differ in their return type rather than in a parameter, so they are two ports and a transport
 * may implement one, the other, or both.
 *
 * THE CANCELLATION IS AN ARGUMENT AND NOT A RETURNED HANDLE. Whoever opens the stream owns the
 * `AbortController`, because stopping has to work before the response has arrived: a server that
 * accepts the connection and never answers is exactly the case Stop must survive, and a handle
 * handed back on open does not exist yet at that moment.
 */

import type { RequestPlan } from '../../../request/domain/request-plan';

/** A response that is being read while it arrives. */
export interface StreamOpenResult {
  readonly status: number;
  readonly statusText: string;
  /** Response headers, in the order the transport reported them. */
  readonly headers: readonly (readonly [string, string])[];
  /**
   * The body as text, in whatever pieces it arrives in.
   *
   * ALREADY DECODED AND ALREADY WHOLE CHARACTERS. A multi byte character split across two
   * network chunks is held back by the decoder rather than delivered as two replacement
   * characters, which is one of the cases T035 asks about by name.
   */
  readonly chunks: AsyncIterable<string>;
}

/** Opens a request and hands back its body as it arrives. */
export interface IStreamTransport {
  /**
   * @param plan - The request as `buildRequest` resolved it
   * @param signal - Aborted by whoever opened it, which closes the connection
   * @returns The status, the headers, and the body as it arrives
   */
  open(plan: RequestPlan, signal: AbortSignal): Promise<StreamOpenResult>;
}

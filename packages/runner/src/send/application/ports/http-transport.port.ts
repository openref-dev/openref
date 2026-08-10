/**
 * The one thing the runner cannot do itself: put bytes on the wire.
 *
 * Behind a port so that every test above it runs without a network, and so that the proxy mode
 * of SPEC 14.5 is a second adapter in M2 rather than a branch inside the runner.
 */

import type { RequestPlan } from '../../../request/domain/request-plan';

/** A response, reduced to what the try-it panel shows. */
export interface TransportResponse {
  readonly status: number;
  readonly statusText: string;
  /** Response headers, in the order the transport reported them. */
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string;
}

/** Sends a request and reports what came back. */
export interface IHttpTransport {
  /**
   * @param plan - The request as `buildRequest` resolved it
   * @returns What the server answered
   */
  send(plan: RequestPlan): Promise<TransportResponse>;
}

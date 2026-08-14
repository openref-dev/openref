/**
 * The two things the proxy cannot do itself: resolve a name, and open a socket.
 *
 * BEHIND PORTS SO THAT THE DEFENCE IS TESTED AND NOT THE NETWORK. Every case SPEC 14.5 names is a
 * question about what the proxy does with an answer: a name that resolves to the loopback, a name
 * that resolves to one address and then to another, an API that answers with a redirect to an
 * internal host. Each of those is a fixture here and a flaky integration test anywhere else.
 *
 * THE RESOLVED ADDRESS TRAVELS WITH THE REQUEST, WHICH IS WHAT CLOSES DNS REBINDING. A proxy that
 * checks an address and then hands a hostname to an http client has checked one resolution and
 * connected on another, and the window between the two is the whole attack. So the outbound port
 * takes the address the check passed, and the adapter connects to that address rather than
 * resolving the name a second time.
 */

/** Answers what a hostname resolves to right now. */
export interface IAddressResolver {
  /**
   * @param hostname - The name to resolve
   * @returns Every address it resolves to, in the order the resolver reported them
   */
  resolve(hostname: string): Promise<readonly string[]>;
}

/** One request as it goes out to the API. */
export interface OutboundRequest {
  readonly method: string;
  /** The target url, unchanged, so the request line and the `Host` header are the API's own. */
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
  /**
   * The address the connection is opened to, already checked.
   *
   * AN ADAPTER MAY NOT RESOLVE THE HOSTNAME ITSELF. This is the address the policy passed, and
   * connecting to any other one is the rebinding case, whether it arrives through a second lookup
   * or through a cache entry that changed underneath.
   */
  readonly address: string;
  /** How long the whole exchange may take. */
  readonly timeoutMs: number;
  /** How many bytes of response body are read before the read is abandoned. */
  readonly maxResponseBytes: number;
}

/** What came back. */
export interface OutboundResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string;
}

/** Puts one request on the wire, to one address, following nothing. */
export interface IOutboundHttp {
  /**
   * @param request - The request, with the address already decided
   * @returns What the API answered, redirects included and never followed
   */
  send(request: OutboundRequest): Promise<OutboundResponse>;
}

/**
 * The same origin proxy of SPEC 14.5, which refuses by default at every step.
 *
 * THIS IS THE COMPONENT MOST LIKELY TO BECOME SOMEBODY ELSE'S INCIDENT. A documentation server
 * that will send a request on a reader's behalf is a request forgery primitive by construction:
 * it is inside a network the reader is not, it has a resolver the reader does not, and whatever it
 * can reach the reader can now reach through it. So the order of the checks matters as much as the
 * checks, and it is written as one straight line rather than as a set of guards, because a guard
 * that is skipped looks exactly like a guard that passed.
 *
 * The order, and what each step refuses:
 *
 * 1. the allowlist, built from the document's own servers. Empty means off. A url that is not
 *    under one of those servers never becomes a name to resolve
 * 2. the address, when the url names one directly, so `http://127.0.0.1` is refused without a
 *    resolver being asked anything
 * 3. the resolution, where every address a name resolves to is checked and not merely the first.
 *    A name resolving to one public address and one loopback address is refused, because which
 *    one a connection would use is not this code's decision to lose
 * 4. the connection, opened to the address that passed, so a second resolution cannot happen
 * 5. the answer, which is returned as it came and never followed
 *
 * NOTHING HERE FOLLOWS A REDIRECT, AND THAT IS SIMPLER THAN FOLLOWING ONE CAREFULLY. A redirect
 * followed with the checks reapplied is defensible and it is also a loop with a credential in it,
 * where every iteration is a fresh chance to get the reapplication wrong. A 302 is a perfectly
 * good answer to give a reader, who can see where it points and decide.
 */

import { ErrorCode, ProxyBlockedError } from '@openref/core';
import { addressRefusal, isAddressLiteral } from '../../domain/address';
import { decideTarget, type ProxyAllowlist } from '../../domain/allowlist';
import {
  forwardableRequestHeaders,
  forwardableResponseHeaders,
  proxyLogRecord,
  type ForwardingOptions,
  type ProxyLogRecord,
} from '../../domain/forwarding';
import type { IAddressResolver, IOutboundHttp } from '../ports/proxy-outbound.port';

/** Default ceiling on one proxied exchange. */
export const DEFAULT_PROXY_TIMEOUT_MS = 30_000;

/** Default ceiling on a proxied response body, matching what the console can show. */
export const DEFAULT_PROXY_MAX_RESPONSE_BYTES = 5_000_000;

/** What the page asks the proxy to send. */
export interface ProxyRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
}

/** What the proxy answers with. */
export interface ProxyResult {
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string;
}

/** How a proxy is built. */
export interface ProxyServiceOptions extends ForwardingOptions {
  readonly allowlist: ProxyAllowlist;
  readonly resolver: IAddressResolver;
  readonly outbound: IOutboundHttp;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  /** Where one line per request goes. Absent means nothing is written anywhere. */
  readonly log?: (record: ProxyLogRecord) => void;
  /** Clock, so a duration can be asserted without waiting for one. */
  readonly now?: () => number;
}

/** Methods a documentation console may ask the proxy to send. */
const METHODS: ReadonlySet<string> = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);

/** Sends one request on behalf of a page, or refuses and says why. */
export class ProxyService {
  private readonly options: ProxyServiceOptions;

  /** @param options - Allowlist, ports and limits */
  constructor(options: ProxyServiceOptions) {
    this.options = options;
  }

  /** Whether this proxy can reach anything at all. False is the default and is not an error. */
  get enabled(): boolean {
    return this.options.allowlist.targets.length > 0;
  }

  /**
   * Forwards one request.
   *
   * @param request - What the page asked for
   * @returns What the API answered
   * @throws {ProxyBlockedError} When any step refuses, with the reason in the message
   */
  async forward(request: ProxyRequest): Promise<ProxyResult> {
    const clock = this.options.now ?? Date.now;
    const started = clock();

    /**
     * Records the outcome and produces the refusal.
     *
     * @param reason - Why the request stops here
     * @returns The error to throw
     */
    const refuse = (reason: string): ProxyBlockedError => {
      this.options.log?.(
        proxyLogRecord({
          method: request.method,
          url: request.url,
          status: null,
          refusedBecause: reason,
          durationMs: clock() - started,
          headers: request.headers,
        }),
      );

      return new ProxyBlockedError(
        `the proxy refused this request: ${reason}`,
        ErrorCode.RUN_PROXY_HOST_BLOCKED,
        undefined,
        { reason },
      );
    };

    const method = request.method.toUpperCase();
    if (!METHODS.has(method)) throw refuse(`${method} is not a method this proxy sends`);

    const decision = decideTarget(this.options.allowlist, request.url);
    if (!decision.allowed) throw refuse(decision.reason);

    const host = decision.url.hostname;
    const address = await this.addressFor(host, refuse);

    const response = await this.options.outbound.send({
      method,
      url: decision.url.toString(),
      headers: forwardableRequestHeaders(request.headers, this.options),
      body: request.body,
      address,
      timeoutMs: this.options.timeoutMs ?? DEFAULT_PROXY_TIMEOUT_MS,
      maxResponseBytes: this.options.maxResponseBytes ?? DEFAULT_PROXY_MAX_RESPONSE_BYTES,
    });

    this.options.log?.(
      proxyLogRecord({
        method,
        url: decision.url.toString(),
        status: response.status,
        refusedBecause: null,
        durationMs: clock() - started,
        headers: request.headers,
      }),
    );

    return {
      status: response.status,
      statusText: response.statusText,
      headers: forwardableResponseHeaders(response.headers, this.options),
      body: response.body,
    };
  }

  /**
   * The address the connection will be opened to, checked before it is returned.
   *
   * EVERY ADDRESS A NAME RESOLVES TO IS CHECKED, NOT THE ONE THAT WOULD BE USED. A name answering
   * with one public address and one loopback address is a name whose next answer is a coin toss,
   * and refusing the whole name is the only reading of it that does not depend on which entry a
   * resolver happens to put first.
   *
   * @param host - Hostname or address literal from the target url
   * @param refuse - How to produce the refusal
   * @returns The address to connect to
   * @throws {ProxyBlockedError} When the host is an address the proxy may not reach, when it
   *   resolves to one, or when it resolves to nothing
   */
  private async addressFor(
    host: string,
    refuse: (reason: string) => ProxyBlockedError,
  ): Promise<string> {
    if (isAddressLiteral(host)) {
      const refusal = addressRefusal(host);
      if (refusal !== null) throw refuse(`${host} is ${refusal}`);

      return host;
    }

    const resolved = await this.options.resolver.resolve(host);

    if (resolved.length === 0) {
      throw refuse(`${host} resolves to no address, so there is nothing to check or to reach`);
    }

    for (const address of resolved) {
      const refusal = addressRefusal(address);
      if (refusal !== null) throw refuse(`${host} resolves to ${address}, which is ${refusal}`);
    }

    return resolved[0] ?? '';
  }
}

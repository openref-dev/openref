/**
 * The proxy mode transport of SPEC 14.5: send the request to this page's own origin and let the
 * documentation server put it on the wire.
 *
 * WHAT IT BUYS AND WHAT IT COSTS, both worth stating because a reader chooses between two modes.
 * It buys the requests a browser refuses to make: an API with no CORS policy for this origin, a
 * `Cookie` parameter that SPEC 14.2 defines and `fetch` drops, a `Host` header a browser reserves.
 * It costs the property that made direct mode safe on its own, which is that nothing this package
 * did could reach a host the browser would not let the page reach. On this path the reach is the
 * server's, so everything that keeps it narrow is on the server, in `@openref/nest`, and none of
 * it is here. This adapter names a target and refuses to be clever about anything.
 *
 * THE REQUEST IS DATA IN A BODY RATHER THAN A URL TO REWRITE. A proxy addressed as
 * `/_proxy?url=...` invites every reader of the url to think of it as a place to put a url, and
 * invites this file to build one. The envelope is a JSON object with a method, a url, headers and
 * a body, and the server decides whether that url is one of its document's own servers.
 *
 * CREDENTIALS ARE OMITTED ON THE FETCH TO OUR OWN ORIGIN. The reader's cookies for the
 * documentation site have no business travelling with a request whose purpose is to reach the API,
 * and whether a cookie reaches the API at all is the server's `forwardCookies`, which is off by
 * default per SPEC 19.10.
 */

import { RunnerError } from '@openref/core';
import type { RequestPlan } from '../../../request/domain/request-plan';
import type {
  IHttpTransport,
  TransportResponse,
} from '../../application/ports/http-transport.port';
import { DEFAULT_TIMEOUT_MS, type FetchLike } from './fetch-transport.adapter';

/** How the proxy transport is built. */
export interface ProxyTransportOptions {
  /**
   * Absolute path of the proxy route on this origin, such as `/docs/_proxy`.
   *
   * A PATH AND NOT A URL, deliberately. The one thing this transport must never do is send the
   * envelope to another origin, and a path cannot name one.
   */
  readonly endpoint: string;
  /** The implementation to call. Defaults to the global `fetch`. */
  readonly fetch?: FetchLike;
  /** How long to wait for an answer. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

/** What the proxy route answers with, before it is checked. */
interface ProxyEnvelope {
  readonly status: unknown;
  readonly statusText: unknown;
  readonly headers: unknown;
  readonly body: unknown;
  readonly error: unknown;
}

/** Sends through the same origin proxy rather than straight to the API. */
export class ProxyHttpTransport implements IHttpTransport {
  private readonly options: ProxyTransportOptions;

  /**
   * @param options - The endpoint and how to reach it
   * @throws {RunnerError} When the endpoint is not a path on this origin
   */
  constructor(options: ProxyTransportOptions) {
    if (!options.endpoint.startsWith('/') || options.endpoint.startsWith('//')) {
      throw new RunnerError(
        `the proxy endpoint must be an absolute path on this origin, received '${options.endpoint}'`,
        'CONFIG_INVALID_OPTIONS',
        undefined,
        { endpoint: options.endpoint },
      );
    }

    this.options = options;
  }

  /** @inheritdoc */
  async send(plan: RequestPlan): Promise<TransportResponse> {
    const call = this.options.fetch ?? globalFetch();
    if (call === null) {
      throw new RunnerError(
        'this runtime has no fetch, so the proxy transport has nothing to send with',
        'RUN_NOT_AVAILABLE',
      );
    }

    // A BODY OF BYTES IS REFUSED RATHER THAN DECODED. A multipart body carrying a file is not
    // text, and turning it into a JSON string would replace every byte that is not a code point
    // with U+FFFD and upload a corrupted file with a 200 to show for it. The envelope grows a
    // binary form when a task pays for one; until then the refusal names the case.
    if (plan.body !== null && typeof plan.body !== 'string') {
      throw new RunnerError(
        'the proxy carries a text body, and this request carries bytes. Send it in direct mode, ' +
          'or upload through an endpoint the browser can reach',
        'RUN_SERIALIZATION_FAILED',
      );
    }

    const controller = abortController();
    const timer =
      controller === null
        ? null
        : setTimeout(() => {
            controller.abort();
          }, this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    try {
      const response = await call(this.options.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          method: plan.method,
          url: plan.url,
          headers: plan.headers,
          body: plan.body,
        }),
        credentials: 'omit',
        ...(controller === null ? {} : { signal: controller.signal }),
      });

      const text = await response.text();

      // THE PROXY'S OWN STATUS IS NOT THE API'S, and reading it as one is the mistake this branch
      // exists to prevent. A refusal is a 403 from the documentation server; the API's 403, if
      // there ever is one, arrives inside a 200 with the rest of its answer.
      if (response.status !== 200) throw refusalOf(response.status, text);

      return readEnvelope(text);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }
}

/**
 * The global `fetch`, or null in a runtime with none.
 *
 * @returns The implementation, or null
 */
function globalFetch(): FetchLike | null {
  const candidate = (globalThis as { fetch?: unknown }).fetch;

  return typeof candidate === 'function' ? (candidate as FetchLike) : null;
}

/**
 * A cancellation controller, where the runtime has one.
 *
 * @returns The controller, or null
 */
function abortController(): AbortController | null {
  const candidate = (globalThis as { AbortController?: unknown }).AbortController;

  return typeof candidate === 'function' ? new (candidate as typeof AbortController)() : null;
}

/**
 * The error for a proxy that refused.
 *
 * @param status - What the proxy route answered
 * @param text - Its body, which carries the reason
 * @returns The error to throw
 */
function refusalOf(status: number, text: string): RunnerError {
  let reason = text;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) {
      const carried = (parsed as { error?: unknown }).error;
      if (typeof carried === 'string') reason = carried;
    }
  } catch {
    // The body was not JSON, so the text is what there is to report. A proxy answering something
    // other than its own envelope is still an answer a reader has to be told about.
  }

  return new RunnerError(
    `the proxy did not send this request: ${reason}`,
    'RUN_PROXY_HOST_BLOCKED',
    undefined,
    { status },
  );
}

/**
 * Reads the envelope, refusing one that is not shaped like an answer.
 *
 * @param text - The response body
 * @returns The response the API gave
 * @throws {RunnerError} When the body is not an envelope
 */
function readEnvelope(text: string): TransportResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw malformed();
  }

  if (typeof parsed !== 'object' || parsed === null) throw malformed();
  const envelope = parsed as unknown as ProxyEnvelope;

  if (typeof envelope.status !== 'number' || typeof envelope.body !== 'string') throw malformed();

  const headers: (readonly [string, string])[] = [];
  if (Array.isArray(envelope.headers)) {
    for (const pair of envelope.headers as unknown[]) {
      if (!Array.isArray(pair)) continue;
      const [name, value] = pair as unknown[];
      if (typeof name === 'string' && typeof value === 'string') headers.push([name, value]);
    }
  }

  return {
    status: envelope.status,
    statusText: typeof envelope.statusText === 'string' ? envelope.statusText : '',
    headers,
    body: envelope.body,
  };
}

/**
 * The error for a body that is not an envelope.
 *
 * @returns The error to throw
 */
function malformed(): RunnerError {
  return new RunnerError(
    'the proxy answered with something that is not a proxy envelope',
    'RUN_PROXY_HOST_BLOCKED',
  );
}

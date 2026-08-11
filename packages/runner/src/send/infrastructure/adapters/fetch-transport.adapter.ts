/**
 * The direct mode transport: the browser's own `fetch`, straight to the server.
 *
 * `direct` is the only mode in M0, per SPEC 14.1. It means the request is subject to the API's
 * CORS policy exactly as any other page's request would be, which is a property rather than a
 * limitation: nothing in this package can reach a host the browser would not let the page
 * reach. The same origin proxy of SPEC 14.5, which can, is M2 and is a second adapter.
 *
 * `fetch` is named structurally rather than through the DOM lib, for the reason `shared/dom.ts`
 * in the renderer gives: this package compiles in the server program, where the DOM types are
 * deliberately out of scope, and a transport that cannot be constructed there is fine while a
 * package that will not compile there is not.
 *
 * TIME AND SIZE ARE BOUNDED HERE, per SPEC 14.1 as amended by T016. A hostile server does not
 * need to answer wrongly to take the page: F7 was a server that never answers, against a send
 * that carried no cancellation, and F8 was a server that answers with ten gigabytes, against a
 * `text()` that buffers whatever arrives. Neither was a refusal. Both were a hang.
 */

import { ErrorCode, RunnerError } from '@openref/core';
import type { RequestPlan } from '../../../request/domain/request-plan';
import type {
  IHttpTransport,
  TransportResponse,
} from '../../application/ports/http-transport.port';

/**
 * How long a send may take before the runner stops waiting, in milliseconds.
 *
 * Long enough for a slow API on a slow connection, short enough that a reader learns the
 * server is not answering rather than watching a spinner. Configurable, because an operator
 * who knows their API is slower is better placed to say so than this default is.
 */
export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * How much response body the console will hold, in bytes.
 *
 * The panel renders the body into the page, so the ceiling is what can be shown rather than
 * what can be downloaded. SPEC 20 budgets the whole rendered document at 64 KB and the peak
 * client memory for a 7 MB document at 250 MB; a response an order above that is not a
 * response this console can display, whatever the network could carry.
 */
export const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** What `fetch` returns, reduced to what this adapter reads. */
export interface FetchResponseLike {
  readonly status: number;
  readonly statusText: string;
  readonly headers: {
    forEach(callback: (value: string, key: string) => void): void;
    get?(name: string): string | null;
  };
  /** The body as a stream, when the implementation exposes one. */
  readonly body?: ResponseStreamLike | null;
  text(): Promise<string>;
}

/** The part of a `ReadableStreamDefaultReader` this adapter uses. */
export interface ResponseReaderLike {
  read(): Promise<{ done: boolean; value?: Uint8Array | undefined }>;
  cancel(): Promise<void>;
}

/**
 * The part of a `ReadableStream` this adapter uses.
 *
 * `getReader` is declared as taking anything rather than nothing, because a real `ReadableStream`
 * declares it as an overload set whose first member takes an argument. A parameter list of none
 * reads as the most permissive thing to write and is the least permissive thing to assign to: it
 * put the browser's own `Response` outside this type, and with it the browser's own `fetch`.
 */
export interface ResponseStreamLike {
  getReader(...args: never[]): ResponseReaderLike;
}

/** What `fetch` is, reduced to how this adapter calls it. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    redirect?: 'follow';
    credentials?: 'omit';
    signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

/** How the adapter finds its `fetch`, and what it will put up with. */
export interface FetchTransportOptions {
  /** The implementation to call. Defaults to the global `fetch`. */
  readonly fetch?: FetchLike;
  /** How long to wait for an answer. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** How much body to read. Defaults to {@link DEFAULT_MAX_RESPONSE_BYTES}. */
  readonly maxResponseBytes?: number;
}

function globalFetch(): FetchLike | null {
  const candidate = (globalThis as { fetch?: unknown }).fetch;

  return typeof candidate === 'function' ? (candidate as FetchLike) : null;
}

/**
 * Builds the cancellation signal, where the runtime has one to build.
 *
 * THE DECLARED TYPE IS `AbortSignal` AND NOT `unknown`, and the difference is not cosmetic. The
 * first version of this said `unknown`, which reads as accommodating and is the opposite: a
 * parameter position is contravariant, so the real `fetch` stopped being assignable to
 * `FetchLike` and any caller handing this adapter the browser's own `fetch` failed to compile.
 * The runtime check below stays, because a runtime old enough to lack `AbortSignal.timeout` is
 * exactly the one the declared type cannot speak for.
 */
function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
  const factory = (globalThis as { AbortSignal?: { timeout?: (ms: number) => AbortSignal } })
    .AbortSignal;
  return factory?.timeout?.(timeoutMs);
}

function isAbort(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'AbortError' || error.name === 'TimeoutError';
}

function tooLarge(limit: number, url: string): RunnerError {
  return new RunnerError(
    `the response is larger than the ${String(limit)} bytes this console will read`,
    ErrorCode.RUN_RESPONSE_TOO_LARGE,
    undefined,
    { url, limit },
  );
}

/**
 * Reads the body, refusing anything past the limit rather than buffering it.
 *
 * A declared `Content-Length` is checked before a byte is read, because a server that says how
 * much it will send can be refused for free. A body without one is read through the stream and
 * stopped at the limit, because a server that declares nothing is exactly the one to distrust.
 * The fallback to `text()` exists for a transport that exposes no stream, and it can only
 * refuse after the fact, which is why it is a fallback rather than the path.
 */
async function readBody(response: FetchResponseLike, limit: number, url: string): Promise<string> {
  const declared = response.headers.get?.('content-length') ?? null;
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > limit) throw tooLarge(limit, url);
  }

  const stream = response.body;
  if (stream === undefined || stream === null) {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > limit) throw tooLarge(limit, url);
    return text;
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let read = 0;
  let text = '';

  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const bytes = chunk.value;
      if (bytes === undefined) continue;

      read += bytes.length;
      if (read > limit) throw tooLarge(limit, url);
      text += decoder.decode(bytes, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return text + decoder.decode();
}

/** Sends a request with `fetch` and reads the whole body, within a time and a size. */
export class FetchHttpTransport implements IHttpTransport {
  private readonly fetch: FetchLike | null;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  /** @param options - The `fetch` to use, and the limits to send under */
  constructor(options: FetchTransportOptions = {}) {
    this.fetch = options.fetch ?? globalFetch();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  }

  /**
   * @param plan - The request as `buildRequest` resolved it
   * @returns What the server answered
   * @throws {RunnerError} When there is no `fetch`, when the request never reached a server,
   *         when the server did not answer inside the limit, or when the body is too large
   */
  async send(plan: RequestPlan): Promise<TransportResponse> {
    const send = this.fetch;
    if (send === null) {
      throw new RunnerError(
        'no fetch implementation is available, so the try-it console cannot send anything',
        ErrorCode.RUN_NOT_AVAILABLE,
      );
    }

    const signal = timeoutSignal(this.timeoutMs);

    let response: FetchResponseLike;
    try {
      response = await send(plan.url, {
        method: plan.method,
        headers: { ...plan.headers },
        // Named rather than left to the default, so the type and the behaviour agree. In
        // direct mode a redirect is followed by the browser under the same policy it applies
        // to any other request from this page.
        redirect: 'follow',
        // Credentials are carried by the headers this runner built, never by ambient cookies.
        // Sending the reader's session cookies to a third party API would be an authenticated
        // request nobody asked for, which is exactly the shape of a CSRF.
        credentials: 'omit',
        ...(signal === undefined ? {} : { signal }),
        ...(plan.body === null ? {} : { body: plan.body }),
      });
    } catch (cause) {
      if (isAbort(cause)) {
        throw new RunnerError(
          `the server did not answer inside ${String(this.timeoutMs)} ms, so the request was cancelled`,
          ErrorCode.RUN_TIMEOUT,
          cause instanceof Error ? cause : undefined,
          { url: plan.url, timeoutMs: this.timeoutMs },
        );
      }

      throw new RunnerError(
        'the request did not reach a server; the host may be unreachable or may refuse this origin',
        ErrorCode.RUN_NOT_AVAILABLE,
        cause instanceof Error ? cause : undefined,
        { url: plan.url },
      );
    }

    const headers: (readonly [string, string])[] = [];
    response.headers.forEach((value, key) => {
      headers.push([key, value]);
    });

    let body: string;
    try {
      body = await readBody(response, this.maxResponseBytes, plan.url);
    } catch (cause) {
      if (cause instanceof RunnerError) throw cause;
      if (isAbort(cause)) {
        throw new RunnerError(
          `the server stopped sending inside ${String(this.timeoutMs)} ms, so the request was cancelled`,
          ErrorCode.RUN_TIMEOUT,
          cause instanceof Error ? cause : undefined,
          { url: plan.url, timeoutMs: this.timeoutMs },
        );
      }
      throw new RunnerError(
        'the response body could not be read to the end',
        ErrorCode.RUN_STREAM_FAILED,
        cause instanceof Error ? cause : undefined,
        { url: plan.url },
      );
    }

    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      body,
    };
  }
}

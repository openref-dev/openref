/**
 * The direct mode stream transport: `fetch`, and the response body read as it arrives.
 *
 * STOP HAS TO ABORT THE REQUEST AND NOT THE READING, which is the decision SPEC 14.6 records and
 * the reason this adapter takes a signal rather than returning a way to stop. Dropping the reader
 * and walking away looks identical from the page: the elements stop appearing. It is not
 * identical anywhere else. The socket stays open, the server goes on producing, and for the one
 * case Stop exists for, a stream that never ends, the connection outlives the reader's decision
 * to stop watching it.
 *
 * NO SIZE LIMIT ON THE WHOLE BODY, WHICH IS THE POINT OF THE FEATURE. `FetchHttpTransport`
 * refuses a body past eight megabytes because it holds all of it; this holds one chunk at a time
 * and hands it on, so the quantity worth bounding is the element and the pause, and both are
 * bounded by the service above rather than here.
 */

import { ErrorCode, RunnerError } from '@openref/core';
import type { RequestPlan } from '../../../request/domain/request-plan';
import type {
  FetchLike,
  FetchResponseLike,
} from '../../../send/infrastructure/adapters/fetch-transport.adapter';
import type {
  IStreamTransport,
  StreamOpenResult,
} from '../../application/ports/stream-transport.port';

function globalFetch(): FetchLike | null {
  const candidate = (globalThis as { fetch?: unknown }).fetch;

  return typeof candidate === 'function' ? (candidate as FetchLike) : null;
}

/** How the adapter finds its `fetch`. */
export interface FetchStreamTransportOptions {
  /** The implementation to call. Defaults to the global `fetch`. */
  readonly fetch?: FetchLike;
}

/**
 * The body of a response, as decoded text, in the pieces it arrives in.
 *
 * `{ stream: true }` IS WHAT MAKES A SPLIT CHARACTER A NON EVENT. Without it a chunk ending in
 * the first two bytes of a three byte character decodes to U+FFFD and the third byte decodes to
 * another, so a name with an accent in it arrives corrupted whenever the network happens to
 * split there. With it the decoder holds the partial code point until the rest arrives.
 *
 * @param response - What `fetch` returned
 * @returns The text chunks, in order
 */
async function* textChunks(response: FetchResponseLike): AsyncGenerator<string> {
  const stream = response.body;

  if (stream === undefined || stream === null) {
    // A transport with no stream still has a body, and a stream of one element is a stream. This
    // is the fallback the send transport has for the same reason, and it is a fallback here too.
    yield await response.text();
    return;
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();

  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value === undefined) continue;

      const text = decoder.decode(chunk.value, { stream: true });
      if (text !== '') yield text;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const tail = decoder.decode();
  if (tail !== '') yield tail;
}

/** Opens a stream with `fetch` and reads it as it arrives. */
export class FetchStreamTransport implements IStreamTransport {
  private readonly fetch: FetchLike | null;

  /** @param options - The `fetch` to use */
  constructor(options: FetchStreamTransportOptions = {}) {
    this.fetch = options.fetch ?? globalFetch();
  }

  /**
   * @param plan - The request as `buildRequest` resolved it
   * @param signal - Aborted by the caller to close the connection
   * @returns The status, the headers, and the body as it arrives
   * @throws {RunnerError} When there is no `fetch`, or the request never reached a server
   */
  async open(plan: RequestPlan, signal: AbortSignal): Promise<StreamOpenResult> {
    const send = this.fetch;
    if (send === null) {
      throw new RunnerError(
        'no fetch implementation is available, so the try-it console cannot open a stream',
        ErrorCode.RUN_NOT_AVAILABLE,
      );
    }

    let response: FetchResponseLike;
    try {
      response = await send(plan.url, {
        method: plan.method,
        headers: { ...plan.headers },
        redirect: plan.redirect ?? 'follow',
        credentials: 'omit',
        signal,
        ...(plan.body === null ? {} : { body: plan.body }),
      });
    } catch (cause) {
      // AN ABORT IS NOT REPORTED AS A FAILURE TO REACH THE SERVER. Stop before the response
      // arrives lands here, and the service above tells the two apart by asking the signal.
      throw new RunnerError(
        'the stream did not reach a server; the host may be unreachable or may refuse this origin',
        ErrorCode.RUN_NOT_AVAILABLE,
        cause instanceof Error ? cause : undefined,
        { url: plan.url },
      );
    }

    const headers: (readonly [string, string])[] = [];
    response.headers.forEach((value, key) => {
      headers.push([key, value]);
    });

    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      chunks: textChunks(response),
    };
  }
}

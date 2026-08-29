import {
  ErrorCode,
  MAX_SPECIFICATION_LENGTH,
  OpenRefError,
  RemoteUnavailableError,
} from '@openref/core';
import type {
  IRemoteFetcher,
  RemoteDocumentSource,
  RemoteFetchRequest,
} from '../../application/ports/remote-fetcher.port';
import { abortedPromise, abortReason } from '../../domain/abort';

/**
 * The real fetcher: the runtime's own `fetch`, bounded in size, cancelled by the caller.
 *
 * THE ADDRESS IT IS HANDED IS CONFIGURATION AND NOTHING ELSE. SPEC 16 names federation remote
 * URLs as the one class of external request this product performs, and the lifecycle only ever
 * passes URLs that were validated at configuration time; nothing here is reachable from a
 * reader or from a document. That is also why no infrastructure-address policy applies: a
 * federation remote is routinely a loopback or cluster-internal address, the same trust class
 * as a configured database host, and the SSRF rules of SPEC 14.5 and 16.2 exist for addresses
 * chosen by clients and by documents, which this deliberately is not.
 *
 * SIZE IS BOUNDED BEFORE THE BODY IS HELD, per the runner's F8 lesson: a remote that answers
 * with ten gigabytes is not refused by a parser that never gets control. The ceiling is the
 * parser's own `MAX_SPECIFICATION_LENGTH`, because a body the parse would refuse anyway earns
 * nothing by being buffered first.
 */

/** The part of a `ReadableStreamDefaultReader` this adapter uses. */
export interface RemoteBodyReaderLike {
  read(): Promise<{ done: boolean; value?: Uint8Array | undefined }>;
  cancel(): Promise<void>;
}

/**
 * The part of a `ReadableStream` this adapter uses. `getReader` takes anything rather than
 * nothing for the reason the runner's transport records: the real overload set is only
 * assignable to the wider parameter list.
 */
export interface RemoteBodyStreamLike {
  getReader(...args: never[]): RemoteBodyReaderLike;
}

/** What `fetch` returns, reduced to what this adapter reads. */
export interface RemoteResponseLike {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body?: RemoteBodyStreamLike | null;
  text(): Promise<string>;
}

/** What `fetch` is, reduced to how this adapter calls it. */
export type RemoteFetchLike = (
  url: string,
  init: {
    method: 'GET';
    headers: Record<string, string>;
    redirect: 'follow';
    credentials: 'omit';
    signal: AbortSignal;
  },
) => Promise<RemoteResponseLike>;

/** How the adapter finds its `fetch`, and how much body it will hold. */
export interface FetchRemoteOptions {
  /** The implementation to call. Defaults to the global `fetch`. */
  readonly fetch?: RemoteFetchLike;
  /** Ceiling on body size in bytes. Defaults to the parser's `MAX_SPECIFICATION_LENGTH`. */
  readonly maxBodyBytes?: number;
}

/** Fetches one remote document over HTTP, within a size, cancelled by the caller's signal. */
export class FetchRemoteAdapter implements IRemoteFetcher {
  private readonly fetchImpl: RemoteFetchLike | null;
  private readonly maxBodyBytes: number;

  /** @param options - The `fetch` to use and the body ceiling */
  constructor(options: FetchRemoteOptions = {}) {
    this.fetchImpl = options.fetch ?? globalFetch();
    this.maxBodyBytes = options.maxBodyBytes ?? MAX_SPECIFICATION_LENGTH;
  }

  /**
   * @param request - The configured URL and the lifecycle's cancellation signal
   * @returns Status and body; the body is empty when the status is not a success, because a
   *          gateway's error page is not a specification
   * @throws {RemoteUnavailableError} When there is no `fetch`, no answer arrived, the request
   *         was cancelled, or the body is larger than the ceiling
   */
  async fetch(request: RemoteFetchRequest): Promise<RemoteDocumentSource> {
    const send = this.fetchImpl;
    if (send === null) {
      throw new RemoteUnavailableError(
        'no fetch implementation is available, so no remote can be fetched',
        ErrorCode.FED_REMOTE_UNAVAILABLE,
        undefined,
        { url: request.url },
      );
    }

    let response: RemoteResponseLike;
    try {
      response = await send(request.url, {
        method: 'GET',
        headers: {
          accept: 'application/json, application/yaml;q=0.9, text/yaml;q=0.8, */*;q=0.5',
        },
        // Redirects are followed: the address is operator configuration, the same trust as the
        // rest of the deployment's own wiring, and a specification served behind one hop of
        // indirection is ordinary.
        redirect: 'follow',
        // No ambient credentials, ever. Whatever this process is, its cookies are not part of
        // fetching a specification.
        credentials: 'omit',
        signal: request.signal,
      });
    } catch (cause) {
      // A cancellation carries the lifecycle's own timeout error as the abort reason, and
      // `fetch` rejects with the reason; passing it through keeps the recorded failure the one
      // the lifecycle wrote, with the timeout in its message.
      if (cause instanceof OpenRefError) throw cause;
      throw new RemoteUnavailableError(
        'the remote did not answer, or the request was cancelled before it did',
        ErrorCode.FED_REMOTE_UNAVAILABLE,
        cause instanceof Error ? cause : undefined,
        { url: request.url },
      );
    }

    if (response.status < 200 || response.status >= 300) {
      return { status: response.status, body: '' };
    }

    const body = await this.readBody(response, request.url, request.signal);
    return { status: response.status, body };
  }

  /**
   * Reads the body, refusing anything past the ceiling rather than buffering it.
   *
   * A declared `Content-Length` is refused before a byte is read; a stream is stopped at the
   * ceiling; the `text()` fallback exists for an implementation with no stream and can only
   * refuse after the fact, which is why it is the fallback.
   *
   * THE SIGNAL IS READ HERE AND NOT ONLY BEFORE THE REQUEST, and T047 measured why. The lifecycle
   * aborts the signal at its timeout and moves on, so a body already streaming was left reading
   * with nothing watching: after the abort the reader took 26 more chunks in 30 ms and was never
   * cancelled. Against a remote that trickles bytes, every timed out attempt leaves one connection
   * accumulating up to the whole ceiling while the next poll opens another, which is the slow
   * loris turned into unbounded work inside this process. The read now ends at the abort, with the
   * reason the aborter gave, and the reader is cancelled on the way out.
   */
  private async readBody(
    response: RemoteResponseLike,
    url: string,
    signal: AbortSignal,
  ): Promise<string> {
    const declared = response.headers.get('content-length');
    if (declared !== null) {
      const length = Number(declared);
      if (Number.isFinite(length) && length > this.maxBodyBytes) throw this.tooLarge(url);
    }

    const stream = response.body;
    if (stream === undefined || stream === null) {
      const text = await response.text();
      // The ceiling is in bytes, and `length` counts UTF-16 code units, so the string is
      // measured in UTF-8 bytes before it is accepted. UTF-8 never encodes a code unit into
      // less than one byte, so the code unit count is a lower bound used only to refuse: a
      // body over the ceiling in code units is refused without being encoded, and only a body
      // small enough to possibly fit pays for the exact byte count.
      if (text.length > this.maxBodyBytes) throw this.tooLarge(url);
      if (new TextEncoder().encode(text).length > this.maxBodyBytes) throw this.tooLarge(url);
      return text;
    }

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let read = 0;
    let text = '';

    // Built once rather than per chunk, which is what keeps a large body from registering one
    // listener per chunk on the signal.
    const aborted = abortedPromise(signal);
    // Nothing else observes this promise until the race does, and an abort that happens while the
    // loop is not racing would otherwise be an unhandled rejection.
    aborted.catch(() => undefined);

    try {
      for (;;) {
        if (signal.aborted) throw abortReason(signal);

        // The race is what ends a read that never settles. Waiting on `reader.read()` alone would
        // hold this loop open for as long as the remote holds the connection, whatever the signal
        // says, which is the shape the timeout exists to end.
        const chunk = await Promise.race([reader.read(), aborted]);
        if (chunk.done) break;
        const bytes = chunk.value;
        if (bytes === undefined) continue;

        read += bytes.length;
        if (read > this.maxBodyBytes) throw this.tooLarge(url);
        text += decoder.decode(bytes, { stream: true });
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }

    return text + decoder.decode();
  }

  private tooLarge(url: string): RemoteUnavailableError {
    return new RemoteUnavailableError(
      `the remote's document is larger than the ${String(this.maxBodyBytes)} bytes this ` +
        "fetcher will read, which is already the parser's own ceiling",
      ErrorCode.FED_REMOTE_UNAVAILABLE,
      undefined,
      { url, maxBodyBytes: this.maxBodyBytes },
    );
  }
}

function globalFetch(): RemoteFetchLike | null {
  const candidate = (globalThis as { fetch?: unknown }).fetch;
  return typeof candidate === 'function' ? (candidate as RemoteFetchLike) : null;
}

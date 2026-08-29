/**
 * How the lifecycle reaches a remote, reduced to the one thing it does: fetch a document.
 *
 * A PORT RATHER THAN A CALL TO `fetch`, for two reasons that are both about honesty. The suites
 * that prove degradation, timeouts and recovery must not touch a network, so the thing that
 * fails has to be substitutable; and the address being fetched is the one external request
 * SPEC 16 permits, so there is value in every such request leaving through a single named door.
 */

/** One request the lifecycle asks a fetcher to perform. */
export interface RemoteFetchRequest {
  /** The configured remote URL, exactly as validated. Never derived from a document or a reader. */
  readonly url: string;
  /**
   * Cancellation, owned by the lifecycle.
   *
   * The bounded timeout the task requires lives behind this signal, in the caller, so it is
   * enforced whatever the fetcher is: an implementation that ignores it can delay its own
   * promise, but the lifecycle has already recorded the attempt as failed and moved on.
   */
  readonly signal: AbortSignal;
}

/** What a remote answered: the status, and the body when the status was worth reading. */
export interface RemoteDocumentSource {
  /** HTTP status of the final response, after any redirects. */
  readonly status: number;
  /** Raw body text. Empty when the status was not a success, because it is not a document. */
  readonly body: string;
}

/** Fetches one remote document. */
export interface IRemoteFetcher {
  /**
   * @param request - The URL and the cancellation signal
   * @returns Status and body of the answer
   * @throws {Error} When no answer arrived at all: network failure, cancellation, or a body
   *         larger than the implementation will read
   */
  fetch(request: RemoteFetchRequest): Promise<RemoteDocumentSource>;
}

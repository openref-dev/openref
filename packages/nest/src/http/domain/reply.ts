/**
 * Replies that do not depend on which server is underneath.
 *
 * EVERY EXPECTED FAILURE IS A REPLY, NOT AN EXCEPTION. An unknown node is a 404 with a page,
 * an unknown asset is a 404, an unreadable document is refused at setup time. What is left for
 * {@link failureReply} is the unexpected, and it says nothing about itself: the reason belongs
 * in the host's log through `onError`, and a stack trace on a documentation page is a
 * disclosure rather than a diagnostic.
 */

import type { ReferenceReply } from '../application/ports/reference-http.port';

/** Cache directive for a response that must never be stored. */
export const NO_STORE = 'no-store';

/** Cache directive for a response whose name carries the digest of its bytes. */
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/** Cache directive for a response that changes with the document. */
export const REVALIDATE = 'no-cache';

/** Reported to a host when a handler throws. */
export type ErrorReporter = (error: unknown) => void;

/**
 * The text of a reply whose body is a value, refusing one whose body is a stream.
 *
 * IT EXISTS BECAUSE `ReferenceReply.body` GAINED A `Readable` ARM AT `T056`, and the two halves of
 * that union cannot be read the same way: a value is already whole and a stream is by construction
 * not. Every caller that wants text is a caller that already knows which route it asked, so the
 * narrowing is a statement rather than a burden, and the refusal names the one route that answers
 * otherwise rather than handing back an empty string that reads like an empty document.
 *
 * @param reply - Any reply
 * @returns Its body as text
 * @throws {TypeError} When the body is a stream, which is the bridge of SPEC 14.8 and nothing else
 */
export function replyText(reply: ReferenceReply): string {
  const body = reply.body;

  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');

  throw new TypeError(
    'this reply carries an event stream rather than a value, so it has no text to read. Only ' +
      'the broker bridge of SPEC 14.8 answers that way',
  );
}

/**
 * A plain text reply.
 *
 * @param status - HTTP status
 * @param body - Text of the reply
 * @param cacheControl - Cache directive
 * @returns The reply
 */
export function textReply(status: number, body: string, cacheControl: string): ReferenceReply {
  return {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': cacheControl },
    body,
  };
}

/**
 * The reply for a handler that threw.
 *
 * @returns A 500 carrying nothing about the cause
 */
export function failureReply(): ReferenceReply {
  return textReply(500, 'The API reference could not be rendered.', NO_STORE);
}

/**
 * The reply for a path that names nothing.
 *
 * @param what - What was looked for, for the reader
 * @returns A 404
 */
export function notFoundReply(what: string): ReferenceReply {
  return textReply(404, `No ${what} of that name is documented here.`, NO_STORE);
}

/**
 * The pieces every emitter reads off a {@link SampleRequest}, so that nine of them cannot answer
 * the same question differently.
 *
 * HEADERS COME OUT SORTED BY CODE POINT, and the reason is the canonical serialization lesson of
 * SPEC 12 rather than tidiness. `buildRequest` inserts a header parameter, then the content type,
 * then the credentials, so the order a plan carries is a fact about the order of statements inside
 * a function nothing in this package owns. Field order is not part of an HTTP request, so sorting
 * loses nothing and makes a sample the same bytes on every run.
 */

import { isMultipart } from '@openref/runner';
import type { RunnerBodyField, RunnerFile } from '@openref/runner';
import type { SampleRequest } from './sample-request';

/** One header, as an emitter writes it. */
export type HeaderPair = readonly [name: string, value: string];

/**
 * Every header of a request, ordered by name.
 *
 * @param request - The request being emitted
 * @returns Header pairs, sorted by code point
 */
export function headersOf(request: SampleRequest): readonly HeaderPair[] {
  return Object.entries(request.plan.headers).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

/**
 * Every header except the content type, for the emitters that build the body themselves.
 *
 * A CLIENT THAT BUILDS A MULTIPART BODY CHOOSES ITS OWN BOUNDARY, and a sample that also sets the
 * runner's `Content-Type` would declare one boundary and send another. The request would be
 * unparseable at the server, and it would be unparseable only for the body type where the reader
 * is least able to see why. The tool sets the header, so the sample does not.
 *
 * @param request - The request being emitted
 * @returns Header pairs, sorted by code point, with any spelling of the content type removed
 */
export function headersWithoutContentType(request: SampleRequest): readonly HeaderPair[] {
  return headersOf(request).filter(([name]) => name.toLowerCase() !== 'content-type');
}

/**
 * The body as text, or null when the request carries none or carries bytes.
 *
 * @param request - The request being emitted
 * @returns The exact text the runner would send, or null
 */
export function textBodyOf(request: SampleRequest): string | null {
  return typeof request.plan.body === 'string' ? request.plan.body : null;
}

/**
 * Whether the body is bytes, which is the one shape no sample can print.
 *
 * @param request - The request being emitted
 * @returns True when the runner would send bytes
 */
export function hasByteBody(request: SampleRequest): boolean {
  return request.plan.body !== null && typeof request.plan.body !== 'string';
}

/**
 * The multipart parts the reader supplied, or null when this is not a multipart request.
 *
 * READ OFF WHAT THE READER SUPPLIED AND NOT OFF THE ENCODED BYTES. Parsing the bytes back into
 * parts would be a second multipart implementation whose disagreements with the first are exactly
 * what SPEC 18 forbids, and it would have to guess at a part the encoder wrote and the reader did
 * not.
 *
 * @param request - The request being emitted
 * @returns The fields, or null
 */
export function multipartFieldsOf(request: SampleRequest): readonly RunnerBodyField[] | null {
  const contentType = request.contentType;
  if (contentType === null || !isMultipart(contentType)) return null;
  if (request.body?.kind !== 'fields') return null;

  return request.body.fields;
}

/**
 * The file the reader supplied for a binary body, or null when the body is not one.
 *
 * @param request - The request being emitted
 * @returns The file, or null
 */
export function binaryFileOf(request: SampleRequest): RunnerFile | null {
  if (request.body?.kind !== 'binary') return null;

  return request.body.file;
}

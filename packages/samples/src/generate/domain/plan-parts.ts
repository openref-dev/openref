/**
 * The pieces every emitter reads off a {@link SampleRequest}, so that fifteen of them cannot
 * answer the same question differently.
 *
 * HEADERS COME OUT SORTED BY CODE POINT, and the reason is the canonical serialization lesson of
 * SPEC 12 rather than tidiness. `buildRequest` inserts a header parameter, then the content type,
 * then the credentials, so the order a plan carries is a fact about the order of statements inside
 * a function nothing in this package owns. Field order is not part of an HTTP request, so sorting
 * loses nothing and makes a sample the same bytes on every run.
 */

import { isMultipart } from '@openref/runner';
import type { RunnerBodyField, RunnerFile } from '@openref/runner';
import { UNSENDABLE_PLAN_REFUSAL } from './languages';
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
 * A body the platform can weigh without this file inventing one, for the question below.
 *
 * ONLY PRESENCE MATTERS TO THE CHECK, so the real body is never copied into the probe: a plan
 * carrying a ten megabyte upload would otherwise be allocated a second time to answer a question
 * about its method.
 */
const PROBE_BODY = 'x';

/**
 * The base a plan's url is resolved against before the platform is asked about it.
 *
 * THE QUESTION IS THE METHOD AND THE BODY, NOT THE ADDRESS, and without this the check answered a
 * third question by accident. A document that declares no server takes the OpenAPI default of `/`,
 * so its plans carry a relative url; `new Request('/ping')` throws "Failed to parse URL", and the
 * guard read that as "the runner cannot send this" and refused every sample for every operation of
 * every such document. Measured as a regression against `packages/static`, whose `miniDocument`
 * fixture is exactly that shape. A browser resolves a relative url against the page it is on, so
 * the console does send those requests; resolving against a fixed base here reproduces that and
 * leaves the check asking only what it is for.
 */
const PROBE_BASE = 'https://openref.invalid/';

/** Any character outside US-ASCII, which is the whole of what RFC 9110 lets a field value carry. */
const NON_ASCII = /[^\u0000-\u007f]/u;

/**
 * Why the runner itself could not send this plan, or null when it can.
 *
 * IT ASKS THE PLATFORM RATHER THAN ENUMERATING SHAPES, which is the correction a second blind
 * review forced. The first edition listed one shape, a body on `GET` or `HEAD`, and a reviewer found
 * `TRACE` walking straight past it: `fetch` refuses that method outright, nothing left the process,
 * and all fifteen samples were written anyway with four of them putting a real `TRACE` on the wire.
 * `trace` is an OpenAPI Path Item field, so the shape is reachable from an ordinary document.
 *
 * `new Request(...)` IS THE TRANSPORT'S OWN ANSWER AND IT SENDS NOTHING. The constructor applies
 * exactly the checks `fetch` applies before it opens a connection, so the refusal is whatever the
 * platform refuses rather than whatever this file remembered to list. Measured on 2026-09-03: it
 * throws "Request with GET/HEAD method cannot have body" for the first shape and "'TRACE' HTTP
 * method is unsupported" for `TRACE`, `TRACK` and `CONNECT`, and returns normally for `PROPFIND`,
 * `QUERY` and a `POST` carrying a body. The platform's sentence travels into the reason, so a
 * runtime that refuses something new says so without this file being edited.
 *
 * @param request - The request being emitted
 * @returns The reason, or null
 */
export function unsendablePlanReason(request: SampleRequest): string | null {
  try {
    new Request(new URL(request.plan.url, PROBE_BASE), {
      method: request.plan.method,
      ...(request.plan.body === null ? {} : { body: PROBE_BODY }),
    });

    return null;
  } catch (cause) {
    const said = cause instanceof Error ? cause.message : String(cause);

    return `${UNSENDABLE_PLAN_REFUSAL} The transport said: ${said}`;
  }
}

/**
 * Header names whose value carries a character outside US-ASCII.
 *
 * THE OCTETS DIFFER BY CLIENT AND THE DIFFERENCE IS NOT COSMETIC, which is what the measurement of
 * 2026-09-03 established. A value of `café` leaves the runner as `caf` plus one octet `0xE9`,
 * because `fetch` converts a header value through the ByteString rule of its own specification; it
 * leaves curl, wget, HTTPie and Ruby as `caf` plus `0xC3 0xA9`, because a sample is a UTF-8 source
 * file and those clients pass its bytes through; and it leaves `Invoke-RestMethod` not at all,
 * which fails with "Request headers must contain only ASCII characters".
 *
 * @param request - The request being emitted
 * @returns The names, in the order `headersOf` fixed
 */
export function nonAsciiHeaderNames(request: SampleRequest): readonly string[] {
  return headersOf(request)
    .filter(([, value]) => NON_ASCII.test(value))
    .map(([name]) => name);
}

/**
 * The content type header of a request, under whatever spelling its producer used, or null.
 *
 * IT IS NOT THE SAME QUESTION AS `SampleRequest.contentType`, and conflating the two hid a dead
 * branch once already. That member is the content type of a body and is null whenever the request
 * carries none; this is the header, which a document may declare as a header parameter on an
 * operation that sends nothing. Two clients here refuse exactly that pair, so the distinction is
 * what makes their refusal reachable.
 *
 * @param request - The request being emitted
 * @returns The header pair, or null
 */
export function contentTypeHeaderOf(request: SampleRequest): HeaderPair | null {
  return headersOf(request).find(([name]) => name.toLowerCase() === 'content-type') ?? null;
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

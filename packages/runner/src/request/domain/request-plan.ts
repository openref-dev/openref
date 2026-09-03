/**
 * From what a reader typed to the request that will be sent.
 *
 * The plan is built as a value, separately from sending it, for two reasons that both show up
 * in the tests. A plan can be compared against a hand written `fetch` call without a server
 * being involved, which is what T013 asks for. And every refusal, an unsupported style, a
 * missing required parameter, an auth scheme M0 does not carry, happens before anything leaves
 * the browser, so a rejected request is never a half sent one.
 *
 * THE PLAN IS NOT PART OF THE RESULT. It carries the `Authorization` header and any apiKey in
 * the query string, and a result object holding it would put credentials into whatever renders
 * the response panel. The runner keeps it and hands back only status, headers, body and time.
 */

import { SerializationError } from '@openref/core';
import { DEFAULT_MAX_BODY_BYTES, isMultipart, serializeBody } from './body';
import type { BodyBytes, RunnerBody } from './body';
import { assertRequired, parameterKey } from './parameters';
import type { RunnableParameter } from './parameters';
import { encodeValue, serializeParameter } from './serialize';
import type { StreamItemSchema } from '../../stream/domain/item-check';
import type { RunnerValue } from './serialize';

/**
 * The five OAuth2 flows of SPEC 14.4, keyed as OpenAPI keys them.
 *
 * DECLARED HERE RATHER THAN IN THE AUTH MODULE THAT USES IT, and the reason is the graph. This
 * file owns the projection a page carries and the plan a transport takes, and `oauth.ts` builds
 * plans from flows; a flow declared there and a plan declared here is a cycle, which the
 * dependency graph linter rejects even when both edges are types.
 */
export type OAuthFlowKind =
  'authorizationCode' | 'clientCredentials' | 'password' | 'implicit' | 'deviceAuthorization';

/** One OAuth2 flow, reduced to the urls and scopes running it needs. */
export interface RunnableOAuthFlow {
  readonly kind: OAuthFlowKind;
  readonly authorizationUrl?: string;
  readonly tokenUrl?: string;
  readonly refreshUrl?: string;
  /** OpenAPI 3.2 `deviceAuthorizationUrl`, for the flow of RFC 8628. */
  readonly deviceAuthorizationUrl?: string;
  readonly scopes: readonly string[];
}

/** A security scheme as sending it requires. */
export interface RunnableSecurityScheme {
  readonly id: string;
  readonly type: string;
  /** Where an `apiKey` travels. */
  readonly in?: string;
  /** Name of the header or query parameter, for `apiKey`. */
  readonly name?: string;
  /** HTTP authentication scheme, for `http`. */
  readonly scheme?: string;
  /**
   * The flows an `oauth2` scheme declares, in the order SPEC 14.4 lists them.
   *
   * A LIST RATHER THAN THE IR'S RECORD, because the console offers one of them and a record with
   * four optional members makes "which one" a question every reader of this type answers again.
   */
  readonly flows?: readonly RunnableOAuthFlow[];
  /** Discovery document url, for `openIdConnect`. */
  readonly openIdConnectUrl?: string;
}

/**
 * Everything about one operation that sending it requires.
 *
 * A plain JSON projection of the IR rather than the node itself, so it can travel inside a
 * rendered page without the document travelling with it. `runnerOperationOf` in `@openref/vue`
 * derives it, and this package never sees an `IRDocument`.
 */
export interface RunnableOperation {
  readonly nodeId: string;
  readonly method: string;
  readonly path: string;
  readonly parameters: readonly RunnableParameter[];
  /** Server urls, operation level overrides first, falling back to the document's. */
  readonly servers: readonly string[];
  readonly security: readonly RunnableSecurityScheme[];
  /**
   * Media types the request body is declared with, in the order the IR carries them.
   *
   * SORTED BY CODE POINT AND NOT THE DOCUMENT'S ORDER, because the normalizer sorts a content
   * map. The first is what a send with no media type named uses, so the order is part of the
   * behaviour rather than a detail.
   *
   * OBJECTS RATHER THAN STRINGS SINCE T027, and the reason is the boundary rather than this
   * package. `@openref/vue` carries an editor and a field list on each of these, read off the
   * request body schema, and its view has to stay assignable to this one so that the projection a
   * page renders from is the same object the runner sends from. A second list of media types
   * would be two answers to which body an operation takes.
   */
  readonly body: readonly RunnableBodyMediaType[];
  /**
   * What it takes to watch this operation, when the application says it streams.
   *
   * ON THE OPERATION RATHER THAN IN THE STREAM CALL, for the reason the media type list is here:
   * `@openref/vue` derives this from the IR and puts it in the page, so the console passes the
   * same object it renders from rather than restating the format and the terminator at the call
   * site. An operation with no `stream` cannot be streamed, and asking is refused rather than
   * guessed at.
   */
  readonly stream?: RunnableStream;
}

/** How a streaming operation is read, per SPEC 14.6. */
export interface RunnableStream {
  readonly format: 'sse' | 'ndjson';
  readonly terminator?: string;
  readonly itemSchema?: StreamItemSchema;
}

/** One media type an operation declares a body for. */
export interface RunnableBodyMediaType {
  readonly mediaType: string;
}

/** What the reader filled in. */
export interface RequestInputs {
  /**
   * Values keyed by `${location}:${name}`, exactly as supplied.
   *
   * A MISSING KEY AND A KEY HOLDING AN EMPTY VALUE ARE DIFFERENT REQUESTS, per SPEC 14.2 and
   * `assertRequired`. Until T026 this was `Record<string, string>` and the empty string meant
   * both, so a reader who cleared a field sent what a reader who never opened it sent.
   */
  readonly values: Readonly<Record<string, RunnerValue>>;
  /** Server the request goes to, one of {@link RunnableOperation.servers}. */
  readonly serverUrl: string;
  /**
   * What the reader supplied for the body, in one of the three forms of SPEC 14.3.
   *
   * Absent, or a text form holding nothing, sends no body. A form with no fields and a file with
   * no bytes are both bodies somebody meant: an empty upload is a request an endpoint can be
   * asked to answer, and it is not the same request as sending nothing at all.
   */
  readonly body?: RunnerBody;
  /** Media type of the body. Defaults to the operation's first declared one. */
  readonly mediaType?: string;
  /** How many bytes of body may be built. Defaults to {@link DEFAULT_MAX_BODY_BYTES}. */
  readonly maxBodyBytes?: number;
  /**
   * Multipart boundary, without the leading dashes.
   *
   * Supplied by the caller rather than generated here, for the reason the clock is: a value the
   * runner invented would make a plan impossible to compare against an expected one, and the
   * multipart cases are exactly the ones worth comparing byte for byte.
   */
  readonly boundary?: string;
}

/** A request, fully resolved and ready to hand to a transport. */
export interface RequestPlan {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  /**
   * Body as it will be sent, or null when the request carries none.
   *
   * TEXT OR BYTES, SINCE T027. A multipart body carrying a file is not text and never was: making
   * it a string would decode the file's bytes as UTF-8, replace every byte that is not a code
   * point with U+FFFD, and upload a corrupted file with a 200 to show for it.
   */
  readonly body: string | BodyBytes | null;
  /**
   * What the transport does with a 3xx, defaulting to following it.
   *
   * ADDED BY T028 FOR THE REQUESTS THAT CARRY A CREDENTIAL TO SOMEBODY OTHER THAN THE API. A token
   * endpoint and an OpenID discovery document that answer with a redirect are refused rather than
   * followed: the request carries a client secret, a code verifier or the reader's password, and
   * following the redirect hands all of it to whatever host the answer named. An API request keeps
   * following redirects, because that is what a browser does for any other request from this page.
   */
  readonly redirect?: 'follow' | 'manual';
}

/** A header or query value auth wants added, produced by the credential layer. */
export interface AuthContribution {
  readonly headers: Readonly<Record<string, string>>;
  readonly query: readonly (readonly [string, string])[];
}

/**
 * Refuses a cookie parameter, which the matrix renders and a browser will not send.
 *
 * THE REFUSAL IS HERE AND NOT IN THE MATRIX, and that separation is the point. SPEC 14.2 defines
 * `form` at a cookie and `serialize.ts` implements both its cells, so the matrix is complete and
 * its contract tests cover them; what cannot happen is the sending, because `Cookie` is a
 * forbidden header name and `fetch` drops it. The same origin proxy of T029 is what removes this,
 * and when it does, nothing in the matrix changes.
 *
 * @param parameter - The parameter as the document declares it
 * @throws {SerializationError} When it is a cookie parameter
 */
function assertCookieSendable(parameter: RunnableParameter): void {
  if (parameter.in !== 'cookie') return;

  throw new SerializationError(
    `parameter '${parameter.name}' is a cookie parameter, which a browser will not let a ` +
      'script set; cookie parameters arrive with the same origin proxy of T029',
    'RUN_SERIALIZATION_FAILED',
    undefined,
    { parameter: parameter.name, in: parameter.in },
  );
}

function valueOf(inputs: RequestInputs, parameter: RunnableParameter): RunnerValue | undefined {
  return inputs.values[parameterKey(parameter.in, parameter.name)];
}

/** The text a parameter renders as, refusing the shape that is not text. */
function textOf(parameter: RunnableParameter, value: RunnerValue): string {
  const serialized = serializeParameter(parameter, value);

  // Unreachable while `LOCATIONS` holds: `path` and `header` admit only `simple`, `label` and
  // `matrix`, and all three return text. It is a narrowing rather than a check, and throwing
  // rather than defaulting is what keeps a fourth style from arriving here as an empty string.
  if (serialized.form !== 'text') {
    throw new SerializationError(
      `parameter '${parameter.name}' renders as query pieces at a ${parameter.in}`,
      'RUN_SERIALIZATION_FAILED',
      undefined,
      { parameter: parameter.name, in: parameter.in, style: parameter.style },
    );
  }

  return serialized.text;
}

/**
 * Substitutes path parameters into the path template.
 *
 * A template placeholder left unfilled is a refusal rather than a literal `{id}` in the url:
 * a request to `/orders/%7Bid%7D` is a request to a route that does not exist, and the 404 it
 * comes back with would read as the API's answer rather than as the runner's mistake.
 *
 * A PATH PARAMETER THAT RENDERS AS NOTHING IS REFUSED, AND THE TEST IS THE OUTPUT RATHER THAN THE
 * STYLE. `simple` renders an empty value as the empty string, so `/orders/{id}` would become
 * `/orders/` and the request would go to a different route; `matrix` and `label` render an empty
 * value as `;id` and `.`, which OpenAPI's own table defines and which keep the segment. Testing
 * what came out rather than which style produced it is what makes the rule survive a fourth one.
 */
function fillPath(
  path: string,
  inputs: RequestInputs,
  parameters: readonly RunnableParameter[],
): string {
  let filled = path;

  for (const parameter of parameters) {
    if (parameter.in !== 'path') continue;

    const value = valueOf(inputs, parameter);
    const text = value === undefined ? '' : textOf(parameter, value);
    if (text === '') {
      throw new SerializationError(
        `path parameter '${parameter.name}' renders as nothing, which would send the request to ` +
          'a different route than the one it is about',
        'RUN_SERIALIZATION_FAILED',
        undefined,
        { parameter: parameter.name, in: 'path', style: parameter.style },
      );
    }

    filled = filled.split(`{${parameter.name}}`).join(text);
  }

  const leftover = /\{([^}]+)\}/.exec(filled);
  if (leftover !== null) {
    throw new SerializationError(
      `path template holds '{${leftover[1] ?? ''}}', which the operation declares no parameter for`,
      'RUN_SERIALIZATION_FAILED',
      undefined,
      { path, placeholder: leftover[1] ?? '' },
    );
  }

  return filled;
}

/** Joins a server url and a path without doubling or dropping the separator. */
export function joinUrl(serverUrl: string, path: string): string {
  const base = serverUrl.replace(/\/+$/, '');
  const tail = path.startsWith('/') ? path : `/${path}`;

  return `${base}${tail}`;
}

/**
 * Builds the request for one operation.
 *
 * @param operation - The operation as `runnerOperationOf` projected it
 * @param inputs - What the reader typed
 * @param auth - Headers and query values the credential layer contributed
 * @returns The request, ready to send
 * @throws {SerializationError} When a parameter is outside the M0 subset or a required one is
 *   empty, or when the chosen server is not one the operation declares
 *
 * @example
 * const plan = buildRequest(operation, { values: { 'path:id': '42' }, serverUrl });
 */
export function buildRequest(
  operation: RunnableOperation,
  inputs: RequestInputs,
  auth: AuthContribution = { headers: {}, query: [] },
): RequestPlan {
  if (!operation.servers.includes(inputs.serverUrl)) {
    throw new SerializationError(
      `server '${inputs.serverUrl}' is not one this operation declares`,
      'RUN_SERIALIZATION_FAILED',
      undefined,
      { serverUrl: inputs.serverUrl, servers: [...operation.servers] },
    );
  }

  for (const parameter of operation.parameters) {
    assertCookieSendable(parameter);
    assertRequired(parameter, valueOf(inputs, parameter));
  }

  const path = fillPath(operation.path, inputs, operation.parameters);

  const query: string[] = [];
  const headers: Record<string, string> = {};

  for (const parameter of operation.parameters) {
    if (parameter.in === 'path') continue;

    // ABSENT, NOT EMPTY. A key that is not there is a parameter the reader did not fill in and
    // the request does not carry it; a key holding an empty value is one they cleared, and the
    // matrix renders that as `q=`, which is a question the server is being asked.
    const value = valueOf(inputs, parameter);
    if (value === undefined) continue;

    if (parameter.in === 'header') {
      headers[parameter.name] = textOf(parameter, value);
      continue;
    }

    const serialized = serializeParameter(parameter, value);
    if (serialized.form === 'pairs') query.push(...serialized.pairs);
  }

  for (const [name, value] of auth.query) {
    query.push(`${encodeValue(name, false)}=${encodeValue(value, false)}`);
  }

  const body = resolveBody(operation, inputs, headers);
  Object.assign(headers, auth.headers);

  const url = joinUrl(inputs.serverUrl, path) + (query.length === 0 ? '' : `?${query.join('&')}`);

  return { method: operation.method.toUpperCase(), url, headers, body };
}

/**
 * Decides what body is sent and sets the content type for it.
 *
 * THE DEFAULT BOUNDARY IS A CONSTANT AND THAT IS NOT AN OVERSIGHT. A boundary has to be absent
 * from the payloads, which this checks, and it does not have to be secret: the parts are the
 * reader's own and there is nothing to guess at. A random one would make every plan different
 * from the last, and comparing a built request against an expected one is the thing this package
 * is tested by. `RequestRunner` supplies a fresh one per send anyway.
 */
function resolveBody(
  operation: RunnableOperation,
  inputs: RequestInputs,
  headers: Record<string, string>,
): string | BodyBytes | null {
  const supplied = inputs.body;
  if (supplied === undefined) return null;
  if (supplied.kind === 'text' && supplied.text.trim() === '') return null;

  const declared = operation.body.map((media) => media.mediaType);
  const mediaType = inputs.mediaType ?? declared[0] ?? 'application/json';

  // A MEDIA TYPE THE OPERATION DOES NOT DECLARE IS REFUSED, and it is refused here rather than in
  // the encoder, which knows nothing about the operation. Sending a form to an endpoint the
  // document says takes JSON produces a 415 the reader reads as an API defect.
  if (declared.length > 0 && !declared.includes(mediaType)) {
    throw new SerializationError(
      `media type '${mediaType}' is not one this operation declares a body for`,
      'RUN_SERIALIZATION_FAILED',
      undefined,
      { mediaType, declared: [...declared] },
    );
  }

  const encoded = serializeBody(mediaType, supplied, {
    boundary: inputs.boundary ?? DEFAULT_BOUNDARY,
    maxBodyBytes: inputs.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
  });

  // THE MULTIPART CONTENT TYPE OVERRIDES A HEADER PARAMETER AND THE OTHERS DEFER TO ONE. The
  // boundary is not something a reader can know, because the body is built here; a declared
  // `Content-Type: multipart/form-data` with no boundary on it describes a body no parser can
  // read, so it is replaced rather than honoured.
  //
  // THE SPELLING IS LOOKED FOR WITHOUT REGARD TO CASE, per SPEC 14.3 as `T059` wrote it, because
  // HTTP field names are case insensitive and an exact key test was not. Measured before the fix:
  // an operation whose only header parameter is `content-type` produced a plan carrying both that
  // and `Content-Type`, and `new Headers` joined them, so one field went out with the declared
  // value written twice. The spelling the document chose is the one that stays, on both branches.
  const declaredSpelling = Object.keys(headers).find(
    (name) => name.toLowerCase() === 'content-type',
  );

  if (isMultipart(mediaType)) headers[declaredSpelling ?? 'Content-Type'] = encoded.contentType;
  else if (declaredSpelling === undefined) headers['Content-Type'] = encoded.contentType;

  return encoded.body;
}

/**
 * The boundary used when the caller names none.
 *
 * Long enough and odd enough that no ordinary payload holds it, and checked against the payloads
 * regardless, because "no ordinary payload" is not a guarantee.
 */
export const DEFAULT_BOUNDARY = 'OpenRefFormBoundary7MA4YWxkTrZu0gW';

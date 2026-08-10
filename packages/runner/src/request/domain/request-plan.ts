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

import { ErrorCode, SerializationError } from '@openref/core';
import { assertRequired, assertRunnable, encodeValue, parameterKey } from './parameters';
import type { RunnableParameter } from './parameters';

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
  /** Media types the request body is declared with, in document order. */
  readonly bodyMediaTypes: readonly string[];
}

/** What the reader filled in. */
export interface RequestInputs {
  /** Values keyed by `${location}:${name}`, exactly as typed. */
  readonly values: Readonly<Record<string, string>>;
  /** Server the request goes to, one of {@link RunnableOperation.servers}. */
  readonly serverUrl: string;
  /** Request body as typed. Absent or empty sends no body. */
  readonly body?: string;
  /** Media type of the body. Defaults to the operation's first declared one. */
  readonly mediaType?: string;
}

/** A request, fully resolved and ready to hand to a transport. */
export interface RequestPlan {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  /** Body as it will be sent, or null when the request carries none. */
  readonly body: string | null;
}

/** A header or query value auth wants added, produced by the credential layer. */
export interface AuthContribution {
  readonly headers: Readonly<Record<string, string>>;
  readonly query: readonly (readonly [string, string])[];
}

function valueOf(inputs: RequestInputs, parameter: RunnableParameter): string {
  return inputs.values[parameterKey(parameter.in, parameter.name)] ?? '';
}

/**
 * Substitutes path parameters into the path template.
 *
 * A template placeholder left unfilled is a refusal rather than a literal `{id}` in the url:
 * a request to `/orders/%7Bid%7D` is a request to a route that does not exist, and the 404 it
 * comes back with would read as the API's answer rather than as the runner's mistake.
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
    if (value === '') {
      throw new SerializationError(
        `path parameter '${parameter.name}' is required and has no value`,
        ErrorCode.RUN_SERIALIZATION_FAILED,
        undefined,
        { parameter: parameter.name, in: 'path' },
      );
    }

    filled = filled.split(`{${parameter.name}}`).join(encodeValue(value, false));
  }

  const leftover = /\{([^}]+)\}/.exec(filled);
  if (leftover !== null) {
    throw new SerializationError(
      `path template holds '{${leftover[1] ?? ''}}', which the operation declares no parameter for`,
      ErrorCode.RUN_SERIALIZATION_FAILED,
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
      ErrorCode.RUN_SERIALIZATION_FAILED,
      undefined,
      { serverUrl: inputs.serverUrl, servers: [...operation.servers] },
    );
  }

  for (const parameter of operation.parameters) {
    assertRunnable(parameter);
    assertRequired(parameter, valueOf(inputs, parameter));
  }

  const path = fillPath(operation.path, inputs, operation.parameters);

  const query: string[] = [];
  const headers: Record<string, string> = {};

  for (const parameter of operation.parameters) {
    const value = valueOf(inputs, parameter);
    if (value === '') continue;

    if (parameter.in === 'query') {
      const allowReserved = parameter.allowReserved ?? false;
      query.push(`${encodeValue(parameter.name, false)}=${encodeValue(value, allowReserved)}`);
      continue;
    }

    if (parameter.in === 'header') headers[parameter.name] = value;
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
 * M0 is JSON only, per SPEC 14.1. A body typed against an operation that declares only
 * `multipart/form-data` is refused rather than sent as JSON, since the server would reject it
 * and the reader would read the rejection as an API defect.
 */
function resolveBody(
  operation: RunnableOperation,
  inputs: RequestInputs,
  headers: Record<string, string>,
): string | null {
  const body = inputs.body ?? '';
  if (body.trim() === '') return null;

  const declared = operation.bodyMediaTypes;
  const mediaType = inputs.mediaType ?? declared[0] ?? 'application/json';

  if (!isJsonMediaType(mediaType)) {
    throw new SerializationError(
      `media type '${mediaType}' is outside the M0 runner, which sends JSON bodies only; ` +
        'form, multipart, octet stream and text bodies arrive in M2',
      ErrorCode.RUN_SERIALIZATION_FAILED,
      undefined,
      { mediaType },
    );
  }

  try {
    JSON.parse(body);
  } catch (cause) {
    throw new SerializationError(
      'the request body is not valid JSON',
      ErrorCode.RUN_SERIALIZATION_FAILED,
      cause instanceof Error ? cause : undefined,
      { mediaType },
    );
  }

  headers['Content-Type'] ??= mediaType;

  return body;
}

/** Whether a media type is one M0 sends, which is JSON and its `+json` structured suffixes. */
export function isJsonMediaType(mediaType: string): boolean {
  return /^application\/(?:[\w.+-]+\+)?json\b/i.test(mediaType.trim());
}

/**
 * Parameter serialization, M0 subset.
 *
 * SPEC 14.1 scopes M0 to plain path, query and header parameters and puts the full
 * `style x explode x location x value type` matrix in M2, where a contract test covers every
 * cell of it. This file therefore handles exactly one column of that matrix, the default style
 * for each location with a scalar value, AND REFUSES EVERYTHING ELSE BY NAME.
 *
 * Refusing is the whole point. A parameter declared `deepObject` that is quietly serialized as
 * `form` produces a request that looks sent and is wrong, and the reader has no way to tell.
 * A `SerializationError` naming the style and the milestone is a worse demo and a true one.
 */

import { ErrorCode, SerializationError } from '@openref/core';
import type { IRParameter, IRParameterLocation, IRParameterStyle } from '@openref/core';

/**
 * A parameter as sending it requires.
 *
 * The fields of `IRParameter` the runner reads, and nothing else. Picked from the IR type
 * rather than restated, so a rename in core reaches this file as a compile error instead of as
 * a parameter that silently stops being serialized.
 */
export type RunnableParameter = Pick<
  IRParameter,
  'name' | 'in' | 'required' | 'style' | 'explode'
> & {
  readonly allowReserved?: boolean;
};

/** Style OpenAPI defaults to at each location, which is the only one M0 serializes. */
const DEFAULT_STYLE: Readonly<Record<IRParameterLocation, IRParameterStyle>> = {
  path: 'simple',
  query: 'form',
  header: 'simple',
  cookie: 'form',
};

/**
 * Reserved characters of RFC 3986, which `allowReserved` leaves as they are.
 *
 * `encodeURIComponent` escapes all of them, so honouring the flag means putting these back
 * rather than writing a second encoder. Doing neither and encoding regardless would change the
 * request, which is the same defect as guessing at a style.
 */
const RESERVED = new Map<string, string>([
  ['%3A', ':'],
  ['%2F', '/'],
  ['%3F', '?'],
  ['%23', '#'],
  ['%5B', '['],
  ['%5D', ']'],
  ['%40', '@'],
  ['%21', '!'],
  ['%24', '$'],
  ['%26', '&'],
  ['%27', "'"],
  ['%28', '('],
  ['%29', ')'],
  ['%2A', '*'],
  ['%2B', '+'],
  ['%2C', ','],
  ['%3B', ';'],
  ['%3D', '='],
]);

/**
 * Percent encodes one value.
 *
 * @param value - The value as the reader typed it
 * @param allowReserved - Whether the parameter declares `allowReserved`
 * @returns The encoded value
 */
export function encodeValue(value: string, allowReserved: boolean): string {
  const encoded = encodeURIComponent(value);
  if (!allowReserved) return encoded;

  return encoded.replace(/%[0-9A-F]{2}/g, (match) => RESERVED.get(match) ?? match);
}

/**
 * Refuses a parameter M0 cannot serialize faithfully.
 *
 * @param parameter - The parameter as the IR carries it
 * @throws {SerializationError} When the location or the style is outside the M0 subset
 */
export function assertRunnable(parameter: RunnableParameter): void {
  if (parameter.in === 'cookie') {
    throw new SerializationError(
      `parameter '${parameter.name}' is a cookie parameter, which a browser will not let a ` +
        'script set; cookie parameters arrive with the same origin proxy in M2',
      ErrorCode.RUN_SERIALIZATION_FAILED,
      undefined,
      { parameter: parameter.name, in: parameter.in },
    );
  }

  const expected = DEFAULT_STYLE[parameter.in];
  if (parameter.style !== expected) {
    throw new SerializationError(
      `parameter '${parameter.name}' declares style '${parameter.style}', and M0 serializes ` +
        `only the default style '${expected}' for a ${parameter.in} parameter; the full ` +
        'serialization matrix arrives in M2',
      ErrorCode.RUN_SERIALIZATION_FAILED,
      undefined,
      { parameter: parameter.name, in: parameter.in, style: parameter.style },
    );
  }
}

/**
 * Refuses a required parameter the reader left empty.
 *
 * Fail closed rather than sending the request without it. A path parameter left empty would
 * send a request to a different route, and a required query parameter left empty asks the
 * server a question the operation says it cannot answer.
 *
 * @param parameter - The parameter as the IR carries it
 * @param value - The value the reader typed, empty when they typed nothing
 * @throws {SerializationError} When a required parameter has no value
 */
export function assertRequired(parameter: RunnableParameter, value: string): void {
  if (parameter.required && value === '') {
    throw new SerializationError(
      `parameter '${parameter.name}' is required and has no value`,
      ErrorCode.RUN_SERIALIZATION_FAILED,
      undefined,
      { parameter: parameter.name, in: parameter.in },
    );
  }
}

/** Key a typed value is held under, so two parameters of the same name in two locations differ. */
export function parameterKey(location: IRParameterLocation, name: string): string {
  return `${location}:${name}`;
}

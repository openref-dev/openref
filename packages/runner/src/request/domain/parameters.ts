/**
 * What a parameter is, and what has to be true of it before the matrix renders it.
 *
 * The rendering itself is `serialize.ts`, which is the whole of SPEC 14.2. This file holds the
 * two questions that are about the reader rather than about the style: did they fill in something
 * that is required, and where is what they filled in kept.
 */

import { SerializationError } from '@openref/core';
import type { IRParameter, IRParameterLocation } from '@openref/core';
import type { RunnerValue, SerializableParameter } from './serialize';

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
  /** `allowEmptyValue` of OpenAPI, which is what lets a required parameter be sent empty. */
  readonly allowEmptyValue?: boolean;
} & SerializableParameter;

/**
 * Refuses a required parameter the reader left out, and tells that apart from an empty one.
 *
 * TWO DIFFERENT REQUESTS, AND UNTIL T026 THEY WERE ONE. The M0 runner held one string per
 * parameter and dropped the empty ones, so a reader who cleared a field and a reader who never
 * touched it sent the same request. Absent now means there is no entry at all and the parameter
 * does not appear; empty means the reader supplied a value with nothing in it, and `q=` is what
 * the server is asked.
 *
 * AN EMPTY VALUE STILL DOES NOT SATISFY `required`, UNLESS THE DOCUMENT SAYS IT DOES. That is
 * what `allowEmptyValue` is for, and reading it is better than inventing a rule: a parameter the
 * operation says it cannot answer without is not answered by an empty string, and the one
 * document that can overrule that is the one that declared the parameter.
 *
 * @param parameter - The parameter as the IR carries it
 * @param value - What the reader supplied, or undefined when they supplied nothing
 * @throws {SerializationError} When a required parameter has no usable value
 */
export function assertRequired(parameter: RunnableParameter, value: RunnerValue | undefined): void {
  if (!parameter.required) return;

  if (value === undefined) {
    throw new SerializationError(
      `parameter '${parameter.name}' is required and has no value`,
      'RUN_SERIALIZATION_FAILED',
      undefined,
      { parameter: parameter.name, in: parameter.in },
    );
  }

  const empty = value.kind === 'primitive' ? value.value === '' : value.value.length === 0;
  if (empty && parameter.allowEmptyValue !== true) {
    throw new SerializationError(
      `parameter '${parameter.name}' is required and was left empty; the operation declares no ` +
        'allowEmptyValue for it',
      'RUN_SERIALIZATION_FAILED',
      undefined,
      { parameter: parameter.name, in: parameter.in, kind: value.kind },
    );
  }
}

/** Key a typed value is held under, so two parameters of the same name in two locations differ. */
export function parameterKey(location: IRParameterLocation, name: string): string {
  return `${location}:${name}`;
}

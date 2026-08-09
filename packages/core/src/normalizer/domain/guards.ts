import type { IRJsonSchemaType, IRJsonValue } from '../../ir/domain/schema.types';

/**
 * Narrowing guards for untrusted specification input.
 *
 * A specification document arrives as `unknown` and is narrowed by these guards, never by a
 * type assertion, per STANDARDS 6.
 */

const JSON_SCHEMA_TYPES = [
  'null',
  'boolean',
  'object',
  'array',
  'number',
  'integer',
  'string',
] as const satisfies readonly IRJsonSchemaType[];

/**
 * Reports whether a value is a plain object, as opposed to an array or `null`.
 *
 * @param value - Untrusted value
 * @returns True when the value can be read as a record of members
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reports whether a value is an array of unknown members.
 *
 * @param value - Untrusted value
 * @returns True when the value is an array
 */
export function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * Returns a value when it is a string, and `undefined` otherwise.
 *
 * @param value - Untrusted value
 * @returns The string, or `undefined`
 */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Returns a value when it is a finite number, and `undefined` otherwise.
 *
 * A non finite number is dropped rather than carried, because it has no canonical form and
 * would make the document unhashable.
 *
 * @param value - Untrusted value
 * @returns The number, or `undefined`
 */
export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Returns a value when it is a boolean, and `undefined` otherwise.
 *
 * @param value - Untrusted value
 * @returns The boolean, or `undefined`
 */
export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Returns the members of a value that are strings, or `undefined` when it is not an array.
 *
 * @param value - Untrusted value
 * @returns The strings, or `undefined`
 */
export function asStringArray(value: unknown): string[] | undefined {
  if (!isUnknownArray(value)) return undefined;
  return value.filter((member): member is string => typeof member === 'string');
}

/**
 * Returns a record whose members are strings, dropping members that are not.
 *
 * @param value - Untrusted value
 * @returns The record, or `undefined` when the value is not a plain object
 */
export function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) return undefined;

  const record: Record<string, string> = {};
  for (const [key, member] of Object.entries(value)) {
    if (typeof member === 'string') record[key] = member;
  }
  return record;
}

/**
 * Returns a value when it names a JSON Schema type.
 *
 * @param value - Untrusted value
 * @returns The type name, or `undefined`
 */
export function asJsonSchemaType(value: unknown): IRJsonSchemaType | undefined {
  return JSON_SCHEMA_TYPES.find((candidate) => candidate === value);
}

/**
 * Converts an untrusted value into an {@link IRJsonValue}, dropping what cannot be represented.
 *
 * Functions, symbols, `undefined` members and non finite numbers are dropped rather than
 * carried, so that anything reaching the IR is hashable.
 *
 * @param value - Untrusted value
 * @returns A JSON value, or `undefined` when nothing can be kept
 */
export function asJsonValue(value: unknown): IRJsonValue | undefined {
  if (value === null) return null;

  switch (typeof value) {
    case 'boolean':
      return value;
    case 'string':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : undefined;
    default:
      break;
  }

  if (isUnknownArray(value)) {
    return value.map((member) => asJsonValue(member) ?? null);
  }

  if (isPlainObject(value)) {
    const record: Record<string, IRJsonValue> = {};
    for (const [key, member] of Object.entries(value)) {
      const converted = asJsonValue(member);
      if (converted !== undefined) record[key] = converted;
    }
    return record;
  }

  return undefined;
}

import { compareByCodePoint } from '../../hashing/domain/canonical';
import type {
  IRJsonSchema,
  IRJsonSchemaType,
  IRJsonValue,
  IRSchemaView,
} from '../../ir/domain/schema.types';
import {
  GENERIC_STRING,
  numberForFieldName,
  numberForFormat,
  stringForFieldName,
  stringForFormat,
} from './field-heuristics';
import { matchesPattern, sampleFromPattern } from './pattern';

/**
 * Deterministic example generation, per SPEC 5.5.
 *
 * Deterministic means a pure function of the schema: no clock, no randomness, no counter that
 * survives a call. The output is part of the document and therefore part of its hash, so a
 * generator that varied would produce a diff on every build and make the hash useless as a
 * cache key. Every ordering decision here is the canonical one, keys by code point, so the
 * result does not depend on the order a document happened to be written in.
 *
 * Values come, in order: from `const`, from the first declared example, from `default`, from
 * the first `enum` member, then from `format`, then from the field name dictionary, then from
 * the type. Constraints are applied last, to whatever was chosen.
 */

/** How many elements an array example holds, per SPEC 5.5. */
export const ARRAY_EXAMPLE_LENGTH = 2;

/**
 * Depth at which generation stops and emits `null`.
 *
 * A normalized schema is already finite, because the normalizer folds a cycle into `$cycle`
 * before it can repeat. This is the second line of defence, for a schema assembled by hand or
 * by a future normalizer, so that the generator can never be the thing that hangs.
 */
export const MAX_EXAMPLE_DEPTH = 12;

/** Options for {@link generateExample}. */
export interface GenerateExampleOptions {
  /**
   * View to generate for. `request` drops `readOnly` fields, `response` drops `writeOnly`
   * ones, and the default keeps everything.
   */
  readonly view?: IRSchemaView;
  /** Name of the field this schema sits under, which the heuristics dictionary reads. */
  readonly fieldName?: string;
  /** Depth limit, defaults to {@link MAX_EXAMPLE_DEPTH}. */
  readonly maxDepth?: number;
  /**
   * The document's named schemas, so that a `$ref` node can be followed, per SPEC 5.1.1.
   *
   * Without it a reference has nothing to resolve against and the position becomes `null`,
   * which is honest: the generator will not invent a value for a type it cannot see.
   */
  readonly schemas?: ReadonlyMap<string, IRJsonSchema>;
}

interface Context {
  readonly view: IRSchemaView;
  readonly maxDepth: number;
  readonly schemas: ReadonlyMap<string, IRJsonSchema>;
  /** Schema ids currently being generated, so a reference cycle terminates. */
  readonly open: Set<string>;
}

/**
 * Generates a deterministic example for a normalized schema.
 *
 * @param schema - Normalized schema
 * @param options - View, field name and depth limit
 * @returns A value the schema accepts, identical on every call for the same input
 *
 * @example
 * generateExample({ type: 'string', format: 'date-time' }); // '2026-01-01T00:00:00Z'
 * generateExample({ type: 'array', items: { type: 'integer' } }); // [1, 1]
 */
export function generateExample(
  schema: IRJsonSchema,
  options: GenerateExampleOptions = {},
): IRJsonValue {
  const context: Context = {
    view: options.view ?? 'both',
    maxDepth: options.maxDepth ?? MAX_EXAMPLE_DEPTH,
    schemas: options.schemas ?? new Map(),
    open: new Set(),
  };

  return build(schema, context, options.fieldName, 0);
}

function build(
  schema: IRJsonSchema,
  context: Context,
  fieldName: string | undefined,
  depth: number,
): IRJsonValue {
  if (depth >= context.maxDepth) return null;
  if (schema.$cycle !== undefined) return null;

  // BEFORE THE REFERENCE IS FOLLOWED, and the order is the rule rather than a preference. A
  // value written beside a `$ref` belongs to this use site, and after T003-R2 a use site that
  // reads `allOf: [{ $ref }]` with a `default` beside it is an ordinary shape rather than a
  // curiosity: 40 of the 180 wrapped properties of `kubernetes-apps-v1.json` carry one. Follow
  // first and the sample shows the target's value where the document stated another.
  const declared = declaredValue(schema);
  if (declared !== undefined) return declared;

  if (schema.$ref !== undefined) return followReference(schema.$ref, context, fieldName, depth);

  const branch = firstBranch(schema);
  if (branch !== undefined) return build(branch, context, fieldName, depth + 1);

  switch (resolveType(schema)) {
    case 'object':
      return buildObject(schema, context, depth);
    case 'array':
      return buildArray(schema, context, fieldName, depth);
    case 'string':
      return buildString(schema, fieldName);
    case 'integer':
      return buildNumber(schema, fieldName, true);
    case 'number':
      return buildNumber(schema, fieldName, false);
    case 'boolean':
      return true;
    case 'null':
      return null;
    default:
      return null;
  }
}

/**
 * Follows a reference into the document's named schemas, per SPEC 5.1.1.
 *
 * A reference already being generated further up is a cycle and stops at `null`. That is what
 * makes a recursive type produce a finite example without the generator having to know which
 * references close a loop.
 */
function followReference(
  id: string,
  context: Context,
  fieldName: string | undefined,
  depth: number,
): IRJsonValue {
  if (context.open.has(id)) return null;

  const target = context.schemas.get(id);
  if (target === undefined) return null;

  context.open.add(id);
  try {
    return build(target, context, fieldName, depth + 1);
  } finally {
    context.open.delete(id);
  }
}

/**
 * Takes the value the document itself states, if it states one.
 *
 * A written example beats anything generated, and `enum` taking its first member is the rule
 * SPEC 5.5 names outright.
 */
function declaredValue(schema: IRJsonSchema): IRJsonValue | undefined {
  if (schema.const !== undefined) return schema.const;
  if (schema.examples !== undefined && schema.examples.length > 0) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (schema.enum !== undefined && schema.enum.length > 0) return schema.enum[0];
  return undefined;
}

/** Picks the branch a composed schema is exemplified by: the first one, deterministically. */
function firstBranch(schema: IRJsonSchema): IRJsonSchema | undefined {
  if (schema.variants !== undefined && schema.variants.length > 0)
    return schema.variants[0]?.schema;
  if (schema.oneOf !== undefined && schema.oneOf.length > 0) return schema.oneOf[0];
  if (schema.anyOf !== undefined && schema.anyOf.length > 0) return schema.anyOf[0];
  return undefined;
}

/**
 * Decides which type to generate.
 *
 * A union of types takes its first non `null` member, so a nullable field still shows what it
 * holds when it is not null. A schema with no `type` is read from its keywords, which is what
 * most hand written specifications rely on.
 */
function resolveType(schema: IRJsonSchema): IRJsonSchemaType | undefined {
  if (typeof schema.type === 'string') return schema.type;

  if (Array.isArray(schema.type)) {
    const types = schema.type as readonly IRJsonSchemaType[];
    return types.find((type) => type !== 'null') ?? types[0];
  }

  if (schema.properties !== undefined || schema.additionalProperties !== undefined) return 'object';
  if (schema.items !== undefined || schema.prefixItems !== undefined) return 'array';
  if (
    schema.minLength !== undefined ||
    schema.maxLength !== undefined ||
    schema.pattern !== undefined ||
    schema.format !== undefined
  ) {
    return 'string';
  }
  if (
    schema.minimum !== undefined ||
    schema.maximum !== undefined ||
    schema.exclusiveMinimum !== undefined ||
    schema.exclusiveMaximum !== undefined ||
    schema.multipleOf !== undefined
  ) {
    return 'number';
  }

  return undefined;
}

/** Reports whether a property belongs to the view being generated. */
function inView(schema: IRJsonSchema, view: IRSchemaView): boolean {
  if (view === 'request' && schema.readOnly === true) return false;
  if (view === 'response' && schema.writeOnly === true) return false;
  return true;
}

function buildObject(
  schema: IRJsonSchema,
  context: Context,
  depth: number,
): Record<string, IRJsonValue> {
  const properties = schema.properties ?? {};
  const names = Object.keys(properties)
    .sort(compareByCodePoint)
    .filter((name) => {
      const property = properties[name];
      return property !== undefined && inView(property, context.view);
    });

  const limited =
    schema.maxProperties !== undefined ? names.slice(0, Math.max(0, schema.maxProperties)) : names;

  const result: Record<string, IRJsonValue> = {};
  for (const name of limited) {
    const property = properties[name];
    if (property === undefined) continue;
    result[name] = build(property, context, name, depth + 1);
  }

  // A schema that declares no properties but does declare a shape for additional ones still
  // has something to show, so one entry is generated under a neutral key.
  if (
    limited.length === 0 &&
    typeof schema.additionalProperties === 'object' &&
    schema.maxProperties !== 0
  ) {
    result.additionalProp = build(schema.additionalProperties, context, undefined, depth + 1);
  }

  return result;
}

function buildArray(
  schema: IRJsonSchema,
  context: Context,
  fieldName: string | undefined,
  depth: number,
): IRJsonValue[] {
  const prefix = schema.prefixItems ?? [];
  const wanted = clampCount(prefix.length === 0 ? ARRAY_EXAMPLE_LENGTH : prefix.length, schema);

  const elements: IRJsonValue[] = [];

  for (let index = 0; index < wanted; index += 1) {
    const item = prefix[index] ?? schema.items;
    if (item === undefined) break;
    elements.push(build(item, context, singularOf(fieldName), depth + 1));
  }

  if (schema.uniqueItems !== true) return elements;

  // Duplicates would break `uniqueItems`, and the generator is not allowed to emit a value the
  // schema rejects. Dropping to the smallest legal length is the honest fix; inventing a second
  // distinct value would mean guessing at the field's meaning.
  const distinct = [...new Map(elements.map((value) => [stableKey(value), value])).values()];
  const minimum = schema.minItems ?? 0;

  return distinct.length >= minimum ? distinct : elements;
}

/** Decides how many elements an array holds, honouring `minItems` and `maxItems`. */
function clampCount(preferred: number, schema: IRJsonSchema): number {
  let count = preferred;
  if (schema.minItems !== undefined) count = Math.max(count, schema.minItems);
  if (schema.maxItems !== undefined) count = Math.min(count, schema.maxItems);
  return Math.max(0, count);
}

/**
 * Turns a plural field name into the singular the heuristics dictionary knows.
 *
 * `items` under `orderIds` should read as an id, not as a plural nothing.
 */
function singularOf(fieldName: string | undefined): string | undefined {
  if (fieldName === undefined) return undefined;
  if (fieldName.endsWith('ies') && fieldName.length > 3) return `${fieldName.slice(0, -3)}y`;
  if (fieldName.endsWith('ses') && fieldName.length > 3) return fieldName.slice(0, -2);
  if (fieldName.endsWith('s') && !fieldName.endsWith('ss')) return fieldName.slice(0, -1);
  return fieldName;
}

/** A structural key used only to spot duplicates inside one generated array. */
function stableKey(value: IRJsonValue): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') return `${typeof value}:${String(value)}`;
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;

  const record = value as Readonly<Record<string, IRJsonValue>>;
  return `{${Object.keys(record)
    .sort(compareByCodePoint)
    .map((key) => `${key}:${stableKey(record[key] ?? null)}`)
    .join(',')}}`;
}

function buildString(schema: IRJsonSchema, fieldName: string | undefined): string {
  const candidate =
    stringForFormat(schema.format) ??
    stringForFieldName(fieldName) ??
    (typeof GENERIC_STRING === 'string' ? GENERIC_STRING : 'string');

  const constrained = applyLength(schema, candidate);

  if (schema.pattern === undefined) return constrained;
  if (matchesPattern(schema.pattern, constrained)) return constrained;

  const sampled = sampleFromPattern(schema.pattern);
  if (sampled !== undefined) return sampled;

  // The pattern is neither satisfied by the candidate nor trivially satisfiable. Returning the
  // candidate is wrong in a way the reader can see, which is better than returning something
  // that looks generated and is equally wrong.
  return constrained;
}

/** Applies `minLength` and `maxLength` to a candidate string. */
function applyLength(schema: IRJsonSchema, candidate: string): string {
  let value = candidate;

  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    value = value.slice(0, Math.max(0, schema.maxLength));
  }

  if (schema.minLength !== undefined && value.length < schema.minLength) {
    const filler = value === '' ? 'x' : value;
    while (value.length < schema.minLength) value += filler;
    value = value.slice(0, schema.minLength);
  }

  return value;
}

function buildNumber(
  schema: IRJsonSchema,
  fieldName: string | undefined,
  integral: boolean,
): number {
  const preferred =
    numberForFormat(schema.format) ?? numberForFieldName(fieldName) ?? (integral ? 1 : 1.5);

  return applyBounds(schema, integral ? Math.round(preferred) : preferred, integral);
}

/**
 * Brings a number inside `minimum`, `maximum`, the exclusive bounds and `multipleOf`.
 *
 * The order is deliberate: the lower bound first, then the upper one, then the multiple, then
 * the bounds again, because snapping to a multiple can step back outside the range.
 */
function applyBounds(schema: IRJsonSchema, preferred: number, integral: boolean): number {
  const lower = lowerBound(schema, integral);
  const upper = upperBound(schema, integral);

  let value = preferred;
  if (lower !== undefined) value = Math.max(value, lower);
  if (upper !== undefined) value = Math.min(value, upper);

  if (schema.multipleOf !== undefined && schema.multipleOf > 0) {
    const stepped = Math.ceil(value / schema.multipleOf) * schema.multipleOf;
    value = roundToStep(stepped, schema.multipleOf);
    if (upper !== undefined && value > upper) {
      value = roundToStep(
        Math.floor(upper / schema.multipleOf) * schema.multipleOf,
        schema.multipleOf,
      );
    }
  }

  return integral ? Math.round(value) : value;
}

/**
 * Removes the floating point noise a multiplication leaves behind.
 *
 * `0.1 * 3` is `0.30000000000000004`, and an example carrying that would be both wrong looking
 * and a source of hash churn if the step ever changed shape.
 */
function roundToStep(value: number, step: number): number {
  const decimals = decimalPlaces(step);
  return decimals === 0 ? value : Number(value.toFixed(Math.min(decimals + 2, 15)));
}

function decimalPlaces(step: number): number {
  if (Number.isInteger(step)) return 0;
  const text = String(step);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

function lowerBound(schema: IRJsonSchema, integral: boolean): number | undefined {
  if (schema.minimum !== undefined) return schema.minimum;
  if (schema.exclusiveMinimum === undefined) return undefined;
  return integral ? schema.exclusiveMinimum + 1 : nextAbove(schema.exclusiveMinimum);
}

function upperBound(schema: IRJsonSchema, integral: boolean): number | undefined {
  if (schema.maximum !== undefined) return schema.maximum;
  if (schema.exclusiveMaximum === undefined) return undefined;
  return integral ? schema.exclusiveMaximum - 1 : nextBelow(schema.exclusiveMaximum);
}

/** A value strictly above `bound`, chosen to stay readable rather than to be the nearest one. */
function nextAbove(bound: number): number {
  return Number.isInteger(bound) ? bound + 1 : bound + Math.abs(bound) * Number.EPSILON * 8 + 1e-9;
}

/** A value strictly below `bound`, chosen on the same principle. */
function nextBelow(bound: number): number {
  return Number.isInteger(bound) ? bound - 1 : bound - Math.abs(bound) * Number.EPSILON * 8 - 1e-9;
}

import type { IRSchema, IRSchemaDialect } from '../../ir/domain/schema.types';
import { ErrorCode, UnsupportedDialectError } from '../../shared/errors/index';
import { isPlainObject } from './guards';
import { normalizeSchema, type NormalizeSchemaOptions } from './schema-normalizer';

/**
 * Schema dialects, per SPEC 5.2 and STANDARDS 7.3.
 *
 * AsyncAPI describes a payload through the Multi Format Schema Object, which names the schema
 * language in `schemaFormat`. Only JSON Schema compatible languages go through the common
 * pipeline and fill `normalized`. Everything else keeps `raw` and is rendered as annotated
 * source with its dialect named.
 *
 * Avro and Protobuf are ordinary inputs on that second path, not failures.
 * {@link UnsupportedDialectError} is for the case where there is nothing to identify the
 * schema language by at all: a `schemaFormat` that is not a string, or is blank. The
 * normalizer is fail closed, and a document that asserts a format it cannot express is
 * broken rather than merely unfamiliar.
 */

/** Dialects whose schemas can be reduced to {@link IRJsonSchema}. */
export const JSON_SCHEMA_DIALECTS: readonly IRSchemaDialect[] = [
  'json-schema-2020-12',
  'openapi-3.0',
  'asyncapi-schema',
];

/**
 * Reports whether a dialect goes through the common schema pipeline.
 *
 * @param dialect - Dialect to test
 * @returns True when the dialect fills `normalized`, false when it takes the raw path
 */
export function isJsonSchemaCompatible(dialect: IRSchemaDialect): boolean {
  return JSON_SCHEMA_DIALECTS.includes(dialect);
}

/**
 * Media type prefixes that name a schema language, longest first so that a more specific
 * vendor tree wins over a shorter one that is a prefix of it.
 */
const FORMAT_PREFIXES: readonly (readonly [string, IRSchemaDialect])[] = [
  ['application/vnd.apache.avro', 'avro'],
  ['application/vnd.google.protobuf', 'protobuf'],
  ['application/vnd.oai.openapi', 'openapi-3.0'],
  ['application/vnd.aai.asyncapi', 'asyncapi-schema'],
  ['application/schema+json', 'json-schema-2020-12'],
  ['application/schema', 'json-schema-2020-12'],
  ['application/protobuf', 'protobuf'],
  ['application/avro', 'avro'],
  ['avro', 'avro'],
  ['protobuf', 'protobuf'],
];

/**
 * Reduces a `schemaFormat` value to the media type, dropping parameters and case.
 *
 * `application/vnd.apache.avro+json;version=1.9.0` and `APPLICATION/VND.APACHE.AVRO;version=1.9.0`
 * name the same language, so the version and the structured suffix are not part of the answer.
 *
 * @param schemaFormat - Raw `schemaFormat` value
 * @returns Lowercase media type with parameters and any `+suffix` removed
 */
export function normalizeSchemaFormat(schemaFormat: string): string {
  const withoutParameters = schemaFormat.split(';')[0] ?? '';
  return withoutParameters.trim().toLowerCase();
}

/**
 * Identifies the schema language a `schemaFormat` value names.
 *
 * A format that is well formed but not one this version knows becomes `unknown`, which takes
 * the raw path exactly like Avro and Protobuf do. The dialect is still identified, in the
 * sense that the document named it and the value survives in `raw` for the renderer.
 *
 * @param schemaFormat - Value of `schemaFormat`, as written in the document
 * @returns The dialect the format names
 * @throws {UnsupportedDialectError} When the value is not a usable identifier at all
 *
 * @example
 * dialectFromSchemaFormat('application/vnd.apache.avro;version=1.9.0'); // 'avro'
 */
export function dialectFromSchemaFormat(schemaFormat: unknown): IRSchemaDialect {
  if (typeof schemaFormat !== 'string' || schemaFormat.trim() === '') {
    throw new UnsupportedDialectError(
      'schemaFormat names no schema language, so the payload cannot be identified',
      ErrorCode.NORM_UNSUPPORTED_DIALECT,
      undefined,
      { schemaFormat },
    );
  }

  const mediaType = normalizeSchemaFormat(schemaFormat);

  if (mediaType === '') {
    throw new UnsupportedDialectError(
      `schemaFormat "${schemaFormat}" carries parameters but names no media type`,
      ErrorCode.NORM_UNSUPPORTED_DIALECT,
      undefined,
      { schemaFormat },
    );
  }

  for (const [prefix, dialect] of FORMAT_PREFIXES) {
    if (mediaType.startsWith(prefix)) return dialect;
  }

  return 'unknown';
}

/** A payload as written by a Multi Format Schema Object, or a bare schema. */
export interface SchemaSource {
  readonly id: string;
  readonly name?: string;
  /** Raw payload. For a Multi Format Schema Object this is the whole object. */
  readonly payload: unknown;
  /** Dialect to assume when the payload declares no `schemaFormat`. */
  readonly defaultDialect: IRSchemaDialect;
  readonly normalizeOptions: NormalizeSchemaOptions;
}

/**
 * Builds an {@link IRSchema} from a payload, choosing the pipeline by dialect.
 *
 * A JSON Schema compatible dialect fills `normalized` and nothing else. Any other dialect
 * keeps the payload verbatim in `raw`, including the `schemaFormat` string, so the renderer
 * can show annotated source and name the language it is in.
 *
 * @param source - Payload, its id and the dialect to assume when none is declared
 * @returns The schema, with exactly one of `normalized` and `raw` filled
 * @throws {UnsupportedDialectError} When a declared `schemaFormat` identifies nothing
 *
 * @example
 * buildSchema({
 *   id: 'OrderPlaced',
 *   payload: { schemaFormat: 'application/vnd.apache.avro;version=1.9.0', schema: { type: 'record' } },
 *   defaultDialect: 'asyncapi-schema',
 *   normalizeOptions: { rootDocument: {} },
 * });
 * // { id: 'OrderPlaced', dialect: 'avro', raw: { schemaFormat: ..., schema: ... } }
 */
export function buildSchema(source: SchemaSource): IRSchema {
  const multiFormat =
    isPlainObject(source.payload) && 'schemaFormat' in source.payload ? source.payload : undefined;

  const dialect =
    multiFormat === undefined
      ? source.defaultDialect
      : dialectFromSchemaFormat(multiFormat.schemaFormat);

  const base = source.name === undefined ? { id: source.id } : { id: source.id, name: source.name };

  if (!isJsonSchemaCompatible(dialect)) {
    return { ...base, dialect, raw: source.payload };
  }

  const body = multiFormat === undefined ? source.payload : multiFormat.schema;

  return { ...base, dialect, normalized: normalizeSchema(body, source.normalizeOptions) };
}

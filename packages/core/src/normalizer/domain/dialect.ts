import type { IRSchema, IRSchemaDialect } from '../../ir/domain/schema.types';
import type { IRDiscoveryProblem } from '../../ir/domain/runtime.types';
import { ErrorCode } from '../../shared/errors/codes';
import { UnsupportedDialectError } from '../../shared/errors/index';
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
  /**
   * Where a subject this reader found and could not state is written, per SPEC 5.4.
   *
   * Supplied by the normalizer that owns the document; a caller that passes none gets the same
   * schema and no finding, which is what every existing direct caller of this wants.
   */
  readonly readerProblems?: IRDiscoveryProblem[];
}

/**
 * Signals that a body is written in a schema language this reader knows is not JSON Schema.
 *
 * ENUMERATED, WITH SOURCES, AND NOT A HEURISTIC, per SPEC 5.4. Each condition is decisive on its
 * own: `record`, `enum` and `fixed` are not among JSON Schema's seven type names, `symbols` and
 * `size` are not JSON Schema keywords, and a `syntax` declaration naming proto2 or proto3 is the
 * first statement of a Protocol Buffers file, so none of the four can be satisfied by a JSON Schema
 * document of any vocabulary.
 *
 * A BARE STRING IS NOT ONE OF THESE, and the split is the second blind review's correction of
 * 2026-08-30. One condition used to read "the body is a string", which refused `''` and `hello`
 * while naming them a Protocol Buffers definition and citing the Protocol Buffers Language Guide,
 * a source that says nothing about either. Refusing is right and the reason is not this list's:
 * {@link refuseBodyThatIsNoSchema} carries it, citing the rule that actually settles it.
 *
 * WHY THE LIST EXISTS AT ALL is the correction of 2026-08-30, made the day the first version was
 * written. The first condition was "the reader took nothing from this body", and a blind review
 * measured it: twelve of fifteen standard 2020-12 bodies under a truthful `application/schema+json`
 * were refused, including `{ contentEncoding, contentMediaType }`, whose refusal said that neither
 * member is a JSON Schema keyword when both are. "The reader took nothing" and "the body is not
 * JSON Schema" differ by exactly this reader's unimplemented vocabulary, which is the one thing
 * SPEC 5.4 says must never be refused.
 */
const FOREIGN_DIALECT_SIGNALS: readonly {
  readonly name: string;
  readonly source: string;
  readonly matches: (body: unknown) => boolean;
}[] = [
  {
    name: 'an Avro record',
    source: 'Apache Avro Specification 1.11, Complex Types, Records',
    matches: (body) =>
      isPlainObject(body) && body.type === 'record' && ('fields' in body || 'name' in body),
  },
  {
    name: 'an Avro enum',
    source: 'Apache Avro Specification 1.11, Complex Types, Enums',
    matches: (body) => isPlainObject(body) && body.type === 'enum' && 'symbols' in body,
  },
  {
    name: 'an Avro fixed',
    source: 'Apache Avro Specification 1.11, Complex Types, Fixed',
    matches: (body) => isPlainObject(body) && body.type === 'fixed' && 'size' in body,
  },
  {
    name: 'a Protocol Buffers definition',
    source: 'Protocol Buffers Language Guide (proto3), the syntax declaration',
    matches: (body) =>
      (typeof body === 'string' && PROTO_SYNTAX.test(body)) ||
      (isPlainObject(body) && (body.syntax === 'proto3' || body.syntax === 'proto2')),
  },
];

/** The `syntax` declaration a Protocol Buffers file opens with, per its Language Guide. */
const PROTO_SYNTAX = /\bsyntax\s*=\s*["'](?:proto2|proto3)["']/;

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

  // ASKED BEFORE THE BODY IS READ, because a body that is not an object at all is refused by the
  // JSON Schema reader with a message about a schema object rather than about the dialect the
  // document named, and the document naming a dialect is the fact a reader here has to act on.
  if (multiFormat !== undefined) {
    refuseForeignDialect(multiFormat.schemaFormat, body, source.id);
    refuseBodyThatIsNoSchema(multiFormat.schemaFormat, body, source.id);
  }

  const normalized = normalizeSchema(body, source.normalizeOptions);

  if (multiFormat !== undefined) {
    recordEmptyRead(multiFormat.schemaFormat, body, normalized, source);
  }

  return { ...base, dialect, normalized };
}

/**
 * Refuses a body that carries a positive signal of another schema language, per SPEC 5.4.
 *
 * WHAT MAKES THIS CHECKABLE IS THE DECLARATION. A Multi Format Schema Object is the one place a
 * document NAMES the schema language, so naming JSON Schema over a body that is recognisably Avro
 * or Protocol Buffers is a statement the document made and got wrong. Measured 2026-08-29 on an
 * Avro record under `application/schema+json`: `normalized` came out `{}`, the reader was shown a
 * payload constraining nothing, and there was no finding anywhere.
 *
 * ONLY A SIGNAL FROM {@link FOREIGN_DIALECT_SIGNALS} REFUSES. An empty read is not one, and that is
 * the whole of the 2026-08-30 correction: the vocabulary this reader has not implemented also reads
 * as empty, and refusing it would refuse a valid document. An empty read with no signal goes to
 * {@link recordEmptyRead} instead, which is loud and is not a refusal.
 *
 * @param schemaFormat - The `schemaFormat` value exactly as the document wrote it
 * @param body - The `schema` member of the Multi Format Schema Object, untrusted
 * @param id - The schema's deterministic id, which is where it stands in the document
 * @throws {UnsupportedDialectError} When the body carries a signal of a known other dialect
 */
function refuseForeignDialect(schemaFormat: unknown, body: unknown, id: string): void {
  const signal = FOREIGN_DIALECT_SIGNALS.find((candidate) => candidate.matches(body));
  if (signal === undefined) return;

  throw new UnsupportedDialectError(
    `${id} declares schemaFormat ${JSON.stringify(schemaFormat)}, which names a JSON Schema ` +
      `compatible dialect, and its body is written as ${signal.name}, per ${signal.source}, so ` +
      'the body is not in the dialect the document named',
    ErrorCode.NORM_UNSUPPORTED_DIALECT,
    undefined,
    { schemaFormat, position: id, signal: signal.name, source: signal.source },
  );
}

/**
 * Refuses a body that is not a JSON Schema at all, per SPEC 5.4, citing the rule that settles it.
 *
 * SEPARATE FROM {@link FOREIGN_DIALECT_SIGNALS} BECAUSE THE REASON IS DIFFERENT, which is the whole
 * of the split made on 2026-08-30. A string body was refused as "a Protocol Buffers definition, per
 * Protocol Buffers Language Guide", which is true of `syntax = "proto3"; ...` and a guess about
 * `hello` or the empty string. What is true of every string is that JSON Schema 2020-12 Core says a
 * schema is an object or a boolean, so a string is not a schema in any dialect this pipeline reads,
 * and that is what the refusal says. A string that does carry the proto marker is caught above and
 * keeps the more specific naming, because the more specific true statement is the more useful one.
 *
 * @param schemaFormat - The `schemaFormat` value exactly as the document wrote it
 * @param body - The `schema` member of the Multi Format Schema Object, untrusted
 * @param id - The schema's deterministic id, which is where it stands in the document
 * @throws {UnsupportedDialectError} When the body is neither an object nor a boolean
 */
function refuseBodyThatIsNoSchema(schemaFormat: unknown, body: unknown, id: string): void {
  if (isPlainObject(body) || typeof body === 'boolean') return;
  // A BODY THAT WAS NEVER WRITTEN IS A MISSING MEMBER, NOT A DIALECT THE DOCUMENT GOT WRONG, so it
  // goes on being refused by the schema reader, in the words that reader already used for it.
  if (body === undefined) return;

  const written = Array.isArray(body) ? 'an array' : `a ${typeof body}`;

  throw new UnsupportedDialectError(
    `${id} declares schemaFormat ${JSON.stringify(schemaFormat)}, which names a JSON Schema ` +
      `compatible dialect, and its body is written as ${written}; per JSON Schema 2020-12 ` +
      'Core, section 4.3, a schema is an object or a boolean, so this body is not one',
    ErrorCode.NORM_UNSUPPORTED_DIALECT,
    undefined,
    {
      schemaFormat,
      position: id,
      bodyType: Array.isArray(body) ? 'array' : typeof body,
      source: 'JSON Schema 2020-12 Core, section 4.3',
    },
  );
}

/**
 * Records a labelled body the reader took nothing from, per SPEC 5.4 and SPEC 7.1.
 *
 * LOUD AND NOT A REFUSAL, which is the disposition SPEC 5.4 narrowed to. The document named a
 * dialect this reader supports and the reader produced an empty schema out of a body that wrote
 * members, so the page would show a payload that constrains nothing; that is a subject found and
 * not stated, which is exactly what `discovery-incomplete` asks about. It is not a refusal because
 * the commonest cause is a 2020-12 keyword this reader has not implemented, and a valid document
 * must not be refused for the reader's own gap.
 *
 * THE MEMBERS ARE NAMED, so a reader can see which of them went unread rather than being told only
 * that something did.
 *
 * @param schemaFormat - The `schemaFormat` value exactly as the document wrote it
 * @param body - The `schema` member of the Multi Format Schema Object, untrusted
 * @param normalized - What the JSON Schema reader made of that body
 * @param source - The payload's own description, whose problem list is written into
 */
function recordEmptyRead(
  schemaFormat: unknown,
  body: unknown,
  normalized: IRSchema['normalized'],
  source: SchemaSource,
): void {
  if (source.readerProblems === undefined) return;
  if (!isPlainObject(body) || Object.keys(body).length === 0) return;
  if (normalized === undefined || Object.keys(normalized).length > 0) return;

  const members = Object.keys(body).sort();

  source.readerProblems.push({
    subject: source.id,
    reason:
      `the body declares schemaFormat ${JSON.stringify(schemaFormat)} and this reader took ` +
      'nothing from it, so the payload shown constrains nothing; unread member(s): ' +
      members.join(', '),
  });
}

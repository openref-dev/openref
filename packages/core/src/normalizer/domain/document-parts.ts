import { compareByCodePoint } from '../../hashing/domain/canonical';
import type {
  IRContact,
  IRInfo,
  IRLicense,
  IRServerVariable,
} from '../../ir/domain/document.types';
import type { IRDiscoveryProblem } from '../../ir/domain/runtime.types';
import type {
  IRJsonValue,
  IRSchema,
  IRSchemaDialect,
  IRSchemaSlot,
} from '../../ir/domain/schema.types';
import { ErrorCode, NormalizeError } from '../../shared/errors/index';
import { buildSchema } from './dialect';
import { asJsonValue, asString, asStringArray, isPlainObject, isUnknownArray } from './guards';
import { schemaNameFromReference } from './json-pointer';
import type { NavigationTag } from './navigation';
import { normalizeSchema } from './schema-normalizer';
import type { SchemaRegistry } from './schema-registry';

/**
 * The parts of a specification document that read the same whichever specification it is.
 *
 * WRITTEN OUT OF `openapi-normalizer.ts` AT `T048`, WHEN THE SECOND NORMALIZER ARRIVED. `info`,
 * the `x-` extension block, the tag list, server variables and the whole named schema mechanism
 * of SPEC 5.1.1 are defined by OpenAPI and AsyncAPI in the same words, so a second copy of them
 * would be a second thing to keep true. Nothing here knows which specification it is reading;
 * everything that differs between the two stays in the normalizer that owns it.
 */

/**
 * Builds the error a malformed document is refused with.
 *
 * @param message - What is wrong, in the words a reader can act on
 * @param context - Values worth carrying to whoever catches it
 * @returns The error, for the caller to throw
 */
export function invalidDocument(
  message: string,
  context?: Record<string, unknown>,
): NormalizeError {
  return new NormalizeError(message, ErrorCode.NORM_DOCUMENT_INVALID, undefined, context);
}

/**
 * Reduces a title to the shape a document id is written in.
 *
 * @param text - Any human text
 * @returns A lowercase slug, `document` when nothing is left
 */
export function documentSlug(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned === '' ? 'document' : cleaned;
}

/**
 * Reads the Info Object, which both specifications define identically.
 *
 * @param raw - The `info` member, untrusted
 * @returns The document metadata
 * @throws {NormalizeError} When there is no info object, or it lacks a title or a version
 */
export function readInfo(raw: unknown): IRInfo {
  if (!isPlainObject(raw)) throw invalidDocument('the document has no info object');

  const title = asString(raw.title);
  const version = asString(raw.version);
  if (title === undefined || version === undefined) {
    throw invalidDocument('info requires both a title and a version');
  }

  const info: { -readonly [Key in keyof IRInfo]: IRInfo[Key] } = { title, version };

  const summary = asString(raw.summary);
  const description = asString(raw.description);
  const terms = asString(raw.termsOfService);
  if (summary !== undefined) info.summary = summary;
  if (description !== undefined) info.description = description;
  if (terms !== undefined) info.termsOfService = terms;

  if (isPlainObject(raw.contact)) {
    const contact: { -readonly [Key in keyof IRContact]: IRContact[Key] } = {};
    const name = asString(raw.contact.name);
    const url = asString(raw.contact.url);
    const email = asString(raw.contact.email);
    if (name !== undefined) contact.name = name;
    if (url !== undefined) contact.url = url;
    if (email !== undefined) contact.email = email;
    if (Object.keys(contact).length > 0) info.contact = contact;
  }

  if (isPlainObject(raw.license)) {
    const name = asString(raw.license.name);
    if (name !== undefined) {
      const license: { -readonly [Key in keyof IRLicense]: IRLicense[Key] } = { name };
      const identifier = asString(raw.license.identifier);
      const url = asString(raw.license.url);
      if (identifier !== undefined) license.identifier = identifier;
      if (url !== undefined) license.url = url;
      info.license = license;
    }
  }

  return info;
}

/**
 * Reads every `x-` member of an object, in canonical key order.
 *
 * @param source - The object as the document wrote it
 * @returns The extensions, or nothing when there are none
 */
export function readExtensions(
  source: Record<string, unknown>,
): Record<string, IRJsonValue> | undefined {
  const extensions: Record<string, IRJsonValue> = {};

  for (const key of Object.keys(source).sort(compareByCodePoint)) {
    if (!key.startsWith('x-')) continue;
    const value = asJsonValue(source[key]);
    if (value !== undefined) extensions[key] = value;
  }

  return Object.keys(extensions).length > 0 ? extensions : undefined;
}

/**
 * Reads a tag list in the order the document declares it.
 *
 * OpenAPI writes tags at the document root and AsyncAPI writes them under `info`, but the object
 * is the same one, so the two differ in where this is called from rather than in what it reads.
 * `parent` is OpenAPI 3.2's hierarchy and is simply absent from an AsyncAPI tag.
 *
 * @param raw - The `tags` member, untrusted
 * @returns The tags, in declaration order
 */
export function readTags(raw: unknown): NavigationTag[] {
  if (!isUnknownArray(raw)) return [];

  const tags: NavigationTag[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    const name = asString(entry.name);
    if (name === undefined) continue;

    const tag: { -readonly [Key in keyof NavigationTag]: NavigationTag[Key] } = { name };
    const summary = asString(entry.summary);
    const parent = asString(entry.parent);
    if (summary !== undefined) tag.summary = summary;
    if (parent !== undefined) tag.parent = parent;

    tags.push(tag);
  }

  return tags;
}

/**
 * Reads the names out of a tag list, for the `tags` field of a node.
 *
 * @param raw - The `tags` member of a node, untrusted
 * @returns The tag names, in the order the document wrote them, without repeats
 */
export function readTagNames(raw: unknown): string[] {
  const names: string[] = [];
  for (const tag of readTags(raw)) {
    if (!names.includes(tag.name)) names.push(tag.name);
  }
  return names;
}

/**
 * Reads a Server Variables map, which both specifications define identically.
 *
 * @param raw - The `variables` member, untrusted
 * @returns The variables, or nothing when none could be read
 */
export function readServerVariables(raw: unknown): Record<string, IRServerVariable> | undefined {
  if (!isPlainObject(raw)) return undefined;

  const variables: Record<string, IRServerVariable> = {};
  for (const name of Object.keys(raw).sort(compareByCodePoint)) {
    const source = raw[name];
    if (!isPlainObject(source)) continue;
    const fallback = asString(source.default);
    if (fallback === undefined) continue;

    const variable: { -readonly [Key in keyof IRServerVariable]: IRServerVariable[Key] } = {
      default: fallback,
    };
    const allowed = asStringArray(source.enum);
    const description = asString(source.description);
    if (allowed !== undefined && allowed.length > 0) variable.enum = allowed;
    if (description !== undefined) variable.description = description;
    variables[name] = variable;
  }

  return Object.keys(variables).length > 0 ? variables : undefined;
}

/** What a normalizer has to hold for the named schema mechanism of SPEC 5.1.1 to work. */
export interface SchemaContext {
  /** The whole document, which internal references are resolved against. */
  readonly document: Record<string, unknown>;
  /** Dialect a schema is assumed to be in when it declares no `schemaFormat`. */
  readonly dialect: IRSchemaDialect;
  /** Keys of `components.schemas`, which are the only ids a use site may refer to by name. */
  readonly namedSchemas: ReadonlySet<string>;
  /** Where every named schema reached anywhere in the document is collected. */
  readonly registry: SchemaRegistry;
  /**
   * Where a subject this reader found and could not state is collected, per SPEC 5.4 and 7.1.
   *
   * ONE ARRAY PER DOCUMENT, WRITTEN INTO IN PLACE, for the reason the registry is one: the finding
   * is made where the schema is built, several levels below the normalizer that owns the document,
   * and threading it back up as a return value would change the signature of every reader between.
   */
  readonly readerProblems: IRDiscoveryProblem[];
  readonly externalDocuments: Readonly<Record<string, unknown>>;
  readonly cycleDepth: number | undefined;
}

/**
 * Builds the options one schema normalization runs under.
 *
 * @param context - The normalizer's schema context
 * @returns Options for {@link normalizeSchema}
 */
export function schemaOptions(context: SchemaContext): Parameters<typeof normalizeSchema>[1] {
  const options: {
    rootDocument: unknown;
    externalDocuments?: Readonly<Record<string, unknown>>;
    cycleDepth?: number;
    registry: SchemaRegistry;
  } = { rootDocument: context.document, registry: context.registry };

  if (Object.keys(context.externalDocuments).length > 0) {
    options.externalDocuments = context.externalDocuments;
  }
  if (context.cycleDepth !== undefined) options.cycleDepth = context.cycleDepth;

  return options;
}

/**
 * Resolves a schema at a use site to a slot.
 *
 * A reference into `components/schemas` becomes a named slot, so the schema is stored once and
 * referred to everywhere. Anything else is normalized in place under a deterministic id, which
 * is also where an AsyncAPI Multi Format Schema Object takes its raw path, per SPEC 5.2.
 *
 * @param raw - The schema as written at the use site, untrusted
 * @param context - The normalizer's schema context
 * @param id - Deterministic id for an inline schema, derived from where it stands
 * @returns The slot, or nothing when the document wrote no schema here
 */
export function schemaSlot(
  raw: unknown,
  context: SchemaContext,
  id: string,
): IRSchemaSlot | undefined {
  if (raw === undefined) return undefined;

  if (isPlainObject(raw)) {
    const reference = asString(raw.$ref);
    if (reference !== undefined && Object.keys(raw).length === 1) {
      const name = schemaNameFromReference(reference);
      if (reference.startsWith('#/components/schemas/') && context.namedSchemas.has(name)) {
        return { kind: 'named', schemaId: name };
      }
    }
  }

  return {
    kind: 'inline',
    schema: buildSchema({
      id,
      payload: raw,
      defaultDialect: context.dialect,
      normalizeOptions: schemaOptions(context),
      readerProblems: context.readerProblems,
    }),
  };
}

/**
 * Normalizes every schema the document declares by name, in canonical name order.
 *
 * Order is deliberate rather than incidental. A named schema is produced once and referred to
 * afterwards, so whichever schema is reached first is the one that gets expanded; sorting the
 * declared names makes that choice the same on every run and for every input ordering.
 *
 * @param context - The normalizer's schema context
 * @param names - The declared names to produce, which is every one for OpenAPI and only the JSON
 *        Schema compatible ones for AsyncAPI, since a raw dialect has no normalized form
 */
export function produceDeclaredSchemas(context: SchemaContext, names: Iterable<string>): void {
  for (const name of [...names].sort(compareByCodePoint)) {
    normalizeSchema({ $ref: `#/components/schemas/${name}` }, schemaOptions(context));
  }
}

/**
 * Reads the registry into the document's schema map.
 *
 * Runs last, because an external reference anywhere in the document registers a named schema
 * too, and those are only known once everything has been walked.
 *
 * @param context - The normalizer's schema context
 * @returns The schemas, ordered by id
 */
export function collectNamedSchemas(context: SchemaContext): IRSchema[] {
  return [...context.registry.entries()].map(([id, normalized]) => {
    const schema: { -readonly [Key in keyof IRSchema]: IRSchema[Key] } = {
      id,
      dialect: context.dialect,
      normalized,
    };
    if (context.namedSchemas.has(id)) schema.name = id;
    return schema;
  });
}

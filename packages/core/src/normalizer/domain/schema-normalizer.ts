import type {
  IRDiscriminator,
  IRJsonSchema,
  IRJsonValue,
  IRSchemaVariant,
} from '../../ir/domain/schema.types';
import {
  CycleDepthError,
  ErrorCode,
  NormalizeError,
  RefResolutionError,
} from '../../shared/errors/index';
import { mergeAllOf } from './compose';
import {
  asBoolean,
  asJsonSchemaType,
  asJsonValue,
  asNumber,
  asString,
  asStringArray,
  asStringRecord,
  isPlainObject,
  isUnknownArray,
} from './guards';
import { parseReference, resolveJsonPointer, schemaNameFromReference } from './json-pointer';
import { createSchemaRegistry, type SchemaRegistry } from './schema-registry';

/**
 * Schema normalization: reference resolution, cycles, composition, per SPEC 5.4.
 *
 * The normalizer is fail closed. A reference that cannot be resolved, a reference chain deeper
 * than the configured limit, or two `allOf` branches that contradict each other all raise. A
 * broken specification must not render as if it were fine.
 */

/** Default limit on how deep a chain of references may be expanded, per SPEC 5.4. */
export const DEFAULT_CYCLE_DEPTH = 12;

/**
 * How deeply one registered schema may nest inside itself, per SPEC 5.3.
 *
 * This bounds the shape of what is WRITTEN OUT, which is what has to stay hashable. Producing
 * a named schema does not count against it: that body becomes its own entry in
 * `document.schemas` and starts a fresh nesting of its own, which is exactly why a chain of
 * named references costs nothing here.
 *
 * The deepest document in the corpus of SPEC 21 is Stripe, at 26 levels counted from the root
 * of the source document, so the limit is an order of magnitude above anything real that has
 * been measured, and an order of magnitude below where the canonical serializer stops.
 */
export const DEFAULT_MAX_SCHEMA_NESTING = 256;

/**
 * How many nested calls normalization may make in total, per SPEC 5.3.
 *
 * Separate from the nesting limit because the two bound different things. Nesting bounds the
 * shape of the output. This bounds the stack, and after the registry began queuing named
 * schemas rather than making them in place, the one shape that still consumes stack in
 * proportion to the document is a chain of `allOf` branches: merging is the single case that
 * SPEC 5.1.1 requires to resolve its target rather than point at it.
 *
 * Measured on the development machine, with the limit lifted: a chain of plain named
 * references no longer has a ceiling at all, and a chain of `allOf` merges exhausted the stack
 * at about 1200 links. This limit stops such a chain at roughly a seventh of that, and it
 * stops it with a code. Before T016 the bound was the engine's, and it arrived as a bare
 * `RangeError`, so the fail closed policy held by accident. Found as F2.
 */
export const MAX_NORMALIZE_RECURSION = 512;

/** Options for {@link normalizeSchema}. */
export interface NormalizeSchemaOptions {
  /** Document that internal references, the ones starting with `#`, point into. */
  readonly rootDocument: unknown;
  /**
   * Documents an external reference can point at, keyed by the URI written before the `#`.
   *
   * `core` performs no input or output, so external documents are supplied by the caller. A
   * reference to a document that is not here raises rather than resolving to nothing.
   */
  readonly externalDocuments?: Readonly<Record<string, unknown>>;
  /**
   * Limit on how deeply schemas without a name may nest.
   *
   * It is no longer a limit on reference chains: a reference to a named schema does not
   * expand, so a chain of them has no depth to exceed. Per SPEC 5.1.1 it bounds the
   * expansion of anonymous targets, which is the only thing left that can nest without end.
   */
  readonly cycleDepth?: number;
  /**
   * Where named schemas are collected, per SPEC 5.1.1.
   *
   * Supply one to see the targets a schema points at. Without it, references still become
   * references, they are simply resolved into a registry the caller never sees. Use
   * {@link normalizeSchemaGraph} to get both halves back.
   */
  readonly registry?: SchemaRegistry;
}

/** A mutable draft of a schema. */
type Draft = { -readonly [Key in keyof IRJsonSchema]: IRJsonSchema[Key] };

interface Context {
  readonly rootDocument: unknown;
  readonly externalDocuments: Readonly<Record<string, unknown>>;
  readonly cycleDepth: number;
  /** Unnamed references currently being expanded, innermost last. */
  readonly stack: string[];
  readonly registry: SchemaRegistry;
  /** How deep the value being written out is, and how deep the call stack is. */
  readonly depth: { nesting: number; total: number };
}

function assign<Key extends keyof Draft>(
  draft: Draft,
  key: Key,
  value: Exclude<Draft[Key], undefined> | undefined,
): void {
  if (value === undefined) return;
  draft[key] = value;
}

function resolveTarget(reference: string, context: Context, path: string): unknown {
  const parsed = parseReference(reference);

  if (!parsed.external) {
    return resolveJsonPointer(context.rootDocument, parsed.pointer);
  }

  if (!Object.hasOwn(context.externalDocuments, parsed.uri)) {
    throw new RefResolutionError(
      `external document ${parsed.uri} was not supplied, so ${reference} cannot be resolved`,
      ErrorCode.NORM_REF_UNRESOLVED,
      undefined,
      { path, reference, uri: parsed.uri },
    );
  }

  return resolveJsonPointer(context.externalDocuments[parsed.uri], parsed.pointer);
}

function labelVariants(
  branches: readonly { readonly reference: string | undefined; readonly schema: IRJsonSchema }[],
  discriminator: IRDiscriminator | undefined,
): IRSchemaVariant[] {
  const mapping = discriminator?.mapping ?? {};

  return branches.map((branch, index) => {
    const discriminatorValue = Object.entries(mapping).find(([, target]) => {
      if (branch.reference === undefined) return false;
      return target === branch.reference || target === schemaNameFromReference(branch.reference);
    })?.[0];

    const fallback =
      branch.schema.title ??
      branch.schema.$id ??
      (branch.reference === undefined
        ? `Variant ${String(index + 1)}`
        : schemaNameFromReference(branch.reference));

    const variant: { -readonly [Key in keyof IRSchemaVariant]: IRSchemaVariant[Key] } = {
      label: discriminatorValue ?? fallback,
      schema: branch.schema,
    };

    if (discriminatorValue !== undefined) variant.discriminatorValue = discriminatorValue;
    return variant;
  });
}

function referenceOf(input: unknown): string | undefined {
  if (!isPlainObject(input)) return undefined;
  return asString(input.$ref);
}

function convertBranchList(
  input: unknown,
  context: Context,
  path: string,
): { readonly reference: string | undefined; readonly schema: IRJsonSchema }[] {
  if (!isUnknownArray(input)) return [];

  return input.map((branch, index) => ({
    reference: referenceOf(branch),
    schema: convert(branch, context, `${path}[${String(index)}]`),
  }));
}

function convertRecord(
  input: unknown,
  context: Context,
  path: string,
): Record<string, IRJsonSchema> | undefined {
  if (!isPlainObject(input)) return undefined;

  const record: Record<string, IRJsonSchema> = {};
  for (const [name, member] of Object.entries(input)) {
    record[name] = convert(member, context, `${path}.${name}`);
  }
  return record;
}

function extensionsOf(source: Record<string, unknown>): Record<string, IRJsonValue> | undefined {
  const extensions: Record<string, IRJsonValue> = {};

  for (const [key, member] of Object.entries(source)) {
    if (!key.startsWith('x-')) continue;
    const value = asJsonValue(member);
    if (value !== undefined) extensions[key] = value;
  }

  return Object.keys(extensions).length > 0 ? extensions : undefined;
}

/**
 * Keywords that describe a position rather than constrain a type.
 *
 * These may sit beside a `$ref` without changing what the target is, so they stay where they
 * are written. Anything else beside a `$ref` narrows the target and has to be merged.
 */
const ANNOTATION_KEYWORDS: readonly string[] = [
  'title',
  'description',
  'deprecated',
  'readOnly',
  'writeOnly',
  'examples',
  'example',
  'default',
];

function annotationsBeside(
  source: Record<string, unknown>,
  context: Context,
  path: string,
): { readonly annotations: IRJsonSchema; readonly constraints: Record<string, unknown> } {
  const constraints: Record<string, unknown> = {};
  const annotationSource: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (key === '$ref') continue;
    if (ANNOTATION_KEYWORDS.includes(key)) {
      annotationSource[key] = value;
    } else {
      constraints[key] = value;
    }
  }

  const annotations =
    Object.keys(annotationSource).length === 0 ? {} : convert(annotationSource, context, path);

  return { annotations, constraints };
}

/**
 * Resolves a reference, per SPEC 5.1.1.
 *
 * A reference to a named schema stays a reference. The target is normalized once, into the
 * registry, and this position holds its id. A reference to anything else has no name to point
 * at and is expanded where it stands, which is also where the cycle marker and the depth
 * limit still apply.
 */
function convertReference(
  source: Record<string, unknown>,
  reference: string,
  context: Context,
  path: string,
): IRJsonSchema {
  const id = context.registry.idFor(reference);

  if (id !== undefined) {
    // Producing the target before pointing at it, so a reference never dangles. The registry
    // is re-entrant: a schema reached from inside its own production stops here.
    //
    // Nesting restarts at zero for the body, because the body becomes an entry of its own in
    // `document.schemas` rather than part of the value being written here. The stack does not
    // restart, because it is genuinely this deep.
    context.registry.ensure(id, reference, () => {
      const outerNesting = context.depth.nesting;
      context.depth.nesting = 0;
      try {
        return convert(resolveTarget(reference, context, path), context, `${path} -> ${reference}`);
      } finally {
        context.depth.nesting = outerNesting;
      }
    });

    const { annotations, constraints } = annotationsBeside(source, context, path);

    if (Object.keys(constraints).length === 0) return { $ref: id, ...annotations };

    // OpenAPI 3.1 allows keywords beside a `$ref`. Anything that narrows the target makes this
    // position a different type from the target, so it can no longer be a bare reference. The
    // merge is against the registered body, per SPEC 5.1.1, rather than against a fresh
    // expansion of the source, which is what keeps its cost bounded. Annotations go into the
    // merge as well, so nothing written beside the reference is lost.
    const siblings = Object.fromEntries(Object.entries(source).filter(([key]) => key !== '$ref'));

    return mergeAllOf(
      [resolveForMerge(id, reference, path, context), convert(siblings, context, path)],
      path,
    );
  }

  const identifier = schemaNameFromReference(reference);

  // An unnamed target is expanded here, so a repeat on the stack is a cycle and folds.
  if (context.stack.includes(reference)) {
    return { $cycle: identifier };
  }

  if (context.stack.length >= context.cycleDepth) {
    throw new CycleDepthError(
      `reference chain deeper than ${String(context.cycleDepth)} at ${path}`,
      ErrorCode.NORM_CYCLE_DEPTH_EXCEEDED,
      undefined,
      { path, reference, depth: context.stack.length, chain: [...context.stack] },
    );
  }

  const target = resolveTarget(reference, context, path);

  context.stack.push(reference);
  let resolved: IRJsonSchema;
  try {
    resolved = convert(target, context, `${path} -> ${reference}`);
  } finally {
    context.stack.pop();
  }

  const named: IRJsonSchema = { $id: identifier, ...resolved };

  const siblings = Object.fromEntries(Object.entries(source).filter(([key]) => key !== '$ref'));
  if (Object.keys(siblings).length === 0) return named;

  return mergeAllOf([named, convert(siblings, context, path)], path);
}

/**
 * Reads a registered body so that an `allOf` branch can be merged into.
 *
 * Merging needs the target: `required` and `properties` cannot be combined without knowing
 * them. Taking the already normalized body rather than expanding the source again is what
 * keeps the cost of that bounded, because the body itself still holds references for its own
 * named members and none of those are expanded.
 *
 * @throws {NormalizeError} When the target is still being produced, which means the document
 *         asks to merge a schema into itself and no resolved form exists
 */
function resolveForMerge(
  id: string,
  reference: string,
  path: string,
  context: Context,
): IRJsonSchema {
  // Forced rather than read, because a named body is queued and not made until the walk
  // returns. Merging is the one caller that cannot wait for that, so it makes the body now.
  const body = context.registry.force(id);
  if (body !== undefined) return body;

  throw new NormalizeError(
    `${reference} takes part in a composition that refers back to itself at ${path}, so it has no merged form`,
    ErrorCode.NORM_COMPOSITION_CONFLICT,
    undefined,
    { path, reference, schemaId: id },
  );
}

/**
 * Counts the two depths, then converts.
 *
 * Both limits are declared rather than left to the engine, per SPEC 5.3. A schema that ran out
 * of stack used to arrive as a bare `RangeError`, which satisfied the fail closed policy by
 * accident, and it did so LATER than canonical serialization gave out, which left a band of
 * documents that normalized and could not then be hashed.
 */
function convert(input: unknown, context: Context, path: string): IRJsonSchema {
  const { depth } = context;

  if (depth.nesting >= DEFAULT_MAX_SCHEMA_NESTING) {
    throw new NormalizeError(
      `a schema nests deeper than the limit of ${String(DEFAULT_MAX_SCHEMA_NESTING)} at ${path}`,
      ErrorCode.NORM_DEPTH_EXCEEDED,
      undefined,
      { path, nesting: depth.nesting, limit: DEFAULT_MAX_SCHEMA_NESTING },
    );
  }

  if (depth.total >= MAX_NORMALIZE_RECURSION) {
    throw new NormalizeError(
      `normalization recursed deeper than the limit of ${String(MAX_NORMALIZE_RECURSION)} at ${path}`,
      ErrorCode.NORM_DEPTH_EXCEEDED,
      undefined,
      { path, total: depth.total, limit: MAX_NORMALIZE_RECURSION },
    );
  }

  depth.nesting += 1;
  depth.total += 1;
  try {
    return convertNode(input, context, path);
  } finally {
    depth.nesting -= 1;
    depth.total -= 1;
  }
}

function convertNode(input: unknown, context: Context, path: string): IRJsonSchema {
  // JSON Schema allows a boolean in place of a schema object.
  if (input === true) return {};
  if (input === false) return { not: {} };

  if (!isPlainObject(input)) {
    throw new NormalizeError(
      `expected a schema object at ${path}`,
      ErrorCode.NORM_DOCUMENT_INVALID,
      undefined,
      { path },
    );
  }

  if (Object.hasOwn(input, '$ref')) {
    const reference = asString(input.$ref);
    if (reference === undefined) {
      throw new NormalizeError(
        `$ref at ${path} is not a string`,
        ErrorCode.NORM_DOCUMENT_INVALID,
        undefined,
        { path },
      );
    }
    return convertReference(input, reference, context, path);
  }

  const draft: Draft = {};

  assign(draft, '$id', asString(input.$id));
  assign(draft, 'title', asString(input.title));
  assign(draft, 'description', asString(input.description));
  assign(draft, 'format', asString(input.format));
  assign(draft, 'pattern', asString(input.pattern));

  const rawType = input.type;
  const singleType = asJsonSchemaType(rawType);
  if (singleType !== undefined) {
    draft.type = singleType;
  } else if (isUnknownArray(rawType)) {
    const types = rawType
      .map((member) => asJsonSchemaType(member))
      .filter((member): member is NonNullable<typeof member> => member !== undefined);
    if (types.length > 0) draft.type = types;
  }

  // OpenAPI 3.0 uplift: `nullable: true` is `type: [..., 'null']` in 3.1.
  if (asBoolean(input.nullable) === true) {
    const current = draft.type;
    if (typeof current === 'string') {
      draft.type = current === 'null' ? current : [current, 'null'];
    } else if (current !== undefined && !current.includes('null')) {
      draft.type = [...current, 'null'];
    }
  }

  assign(draft, 'const', asJsonValue(input.const));
  assign(draft, 'default', asJsonValue(input.default));

  const rawEnum = input.enum;
  if (isUnknownArray(rawEnum)) {
    draft.enum = rawEnum.map((member) => asJsonValue(member) ?? null);
  }

  const rawExamples = input.examples;
  if (isUnknownArray(rawExamples)) {
    draft.examples = rawExamples.map((member) => asJsonValue(member) ?? null);
  } else {
    // OpenAPI 3.0 uplift: a Schema Object's single `example` is `examples[]` in 3.1.
    const single = asJsonValue(input.example);
    if (single !== undefined) draft.examples = [single];
  }

  assign(draft, 'deprecated', asBoolean(input.deprecated));
  assign(draft, 'readOnly', asBoolean(input.readOnly));
  assign(draft, 'writeOnly', asBoolean(input.writeOnly));
  assign(draft, 'uniqueItems', asBoolean(input.uniqueItems));

  assign(draft, 'minProperties', asNumber(input.minProperties));
  assign(draft, 'maxProperties', asNumber(input.maxProperties));
  assign(draft, 'minItems', asNumber(input.minItems));
  assign(draft, 'maxItems', asNumber(input.maxItems));
  assign(draft, 'minLength', asNumber(input.minLength));
  assign(draft, 'maxLength', asNumber(input.maxLength));
  assign(draft, 'minimum', asNumber(input.minimum));
  assign(draft, 'maximum', asNumber(input.maximum));
  assign(draft, 'exclusiveMinimum', asNumber(input.exclusiveMinimum));
  assign(draft, 'exclusiveMaximum', asNumber(input.exclusiveMaximum));
  assign(draft, 'multipleOf', asNumber(input.multipleOf));

  assign(draft, 'required', asStringArray(input.required));
  assign(draft, 'properties', convertRecord(input.properties, context, `${path}.properties`));
  assign(
    draft,
    'patternProperties',
    convertRecord(input.patternProperties, context, `${path}.patternProperties`),
  );

  if (Object.hasOwn(input, 'propertyNames')) {
    draft.propertyNames = convert(input.propertyNames, context, `${path}.propertyNames`);
  }
  if (Object.hasOwn(input, 'items')) {
    draft.items = convert(input.items, context, `${path}.items`);
  }
  if (Object.hasOwn(input, 'not')) {
    draft.not = convert(input.not, context, `${path}.not`);
  }

  const rawPrefixItems = input.prefixItems;
  if (isUnknownArray(rawPrefixItems)) {
    draft.prefixItems = rawPrefixItems.map((member, index) =>
      convert(member, context, `${path}.prefixItems[${String(index)}]`),
    );
  }

  const rawAdditional = input.additionalProperties;
  const additionalBoolean = asBoolean(rawAdditional);
  if (additionalBoolean !== undefined) {
    draft.additionalProperties = additionalBoolean;
  } else if (rawAdditional !== undefined) {
    draft.additionalProperties = convert(rawAdditional, context, `${path}.additionalProperties`);
  }

  const discriminatorSource = input.discriminator;
  let discriminator: IRDiscriminator | undefined;
  if (isPlainObject(discriminatorSource)) {
    const propertyName = asString(discriminatorSource.propertyName);
    if (propertyName !== undefined) {
      const mapping = asStringRecord(discriminatorSource.mapping);
      discriminator =
        mapping === undefined || Object.keys(mapping).length === 0
          ? { propertyName }
          : { propertyName, mapping };
      draft.discriminator = discriminator;
    }
  }

  if (Object.hasOwn(input, 'oneOf')) {
    const branches = convertBranchList(input.oneOf, context, `${path}.oneOf`);
    if (branches.length > 0) {
      draft.oneOf = branches.map((branch) => branch.schema);
      draft.variants = labelVariants(branches, discriminator);
    }
  }

  if (Object.hasOwn(input, 'anyOf')) {
    const branches = convertBranchList(input.anyOf, context, `${path}.anyOf`);
    if (branches.length > 0) {
      draft.anyOf = branches.map((branch) => branch.schema);
      draft.variants = labelVariants(branches, discriminator);
    }
  }

  assign(draft, 'extensions', extensionsOf(input));

  if (Object.hasOwn(input, 'allOf')) {
    const branches = convertBranchList(input.allOf, context, `${path}.allOf`).map((branch) =>
      // A branch that is a bare reference has to be resolved to be merged, per the decision
      // recorded in SPEC 5.1.1. Only a branch the document explicitly asked to merge is
      // resolved; a reference used anywhere else stays a reference.
      branch.schema.$ref === undefined || branch.reference === undefined
        ? branch.schema
        : resolveForMerge(branch.schema.$ref, branch.reference, `${path}.allOf`, context),
    );
    return mergeAllOf([draft, ...branches], `${path}.allOf`);
  }

  return draft;
}

/**
 * Normalizes one schema: resolves references, folds cycles, merges `allOf`, labels variants.
 *
 * @param input - Schema exactly as the source document wrote it, untrusted
 * @param options - Root document, external documents and the cycle depth limit
 * @returns A fully resolved schema, with every cycle replaced by a `$cycle` marker
 * @throws {RefResolutionError} When a reference cannot be resolved
 * @throws {CycleDepthError} When a chain of references is deeper than the limit
 * @throws {NormalizeError} When the input is not a schema, or an `allOf` contradicts itself
 *
 * @example
 * const document = { components: { schemas: { Order: { type: 'object' } } } };
 * normalizeSchema({ $ref: '#/components/schemas/Order' }, { rootDocument: document });
 */
export function normalizeSchema(input: unknown, options: NormalizeSchemaOptions): IRJsonSchema {
  const cycleDepth = options.cycleDepth ?? DEFAULT_CYCLE_DEPTH;

  if (!Number.isInteger(cycleDepth) || cycleDepth < 1) {
    throw new NormalizeError(
      `cycleDepth must be a positive integer, received ${String(cycleDepth)}`,
      ErrorCode.NORM_DOCUMENT_INVALID,
      undefined,
      { cycleDepth },
    );
  }

  const context: Context = {
    rootDocument: options.rootDocument,
    externalDocuments: options.externalDocuments ?? {},
    cycleDepth,
    stack: [],
    registry: options.registry ?? createSchemaRegistry(),
    depth: { nesting: 0, total: 0 },
  };

  const schema = convert(input, context, '$');

  // Drained here rather than left to whoever reads the registry, because a broken reference
  // inside a named schema has to be found before this returns. A deferred production that
  // nobody makes is a normalizer that fails open, which is the one thing it may not do.
  context.registry.drain();

  return schema;
}

/**
 * A schema together with every named schema it reaches.
 *
 * `schema` holds `{ $ref: id }` at each named position and `schemas` holds the bodies those
 * ids resolve to, so the two are only meaningful together, per SPEC 5.2.
 */
export interface NormalizedSchemaGraph {
  readonly schema: IRJsonSchema;
  readonly schemas: Map<string, IRJsonSchema>;
}

/**
 * Normalizes a schema and returns the named schemas it reaches alongside it.
 *
 * @param input - Schema exactly as the source document wrote it, untrusted
 * @param options - Root document, external documents and the depth limit
 * @returns The schema, with references intact, and the map they point into
 * @throws {RefResolutionError} When a reference cannot be resolved
 * @throws {NormalizeError} When the input is not a schema, or an `allOf` contradicts itself
 *
 * @example
 * const document = { components: { schemas: { Order: { type: 'object' } } } };
 * const graph = normalizeSchemaGraph({ $ref: '#/components/schemas/Order' }, {
 *   rootDocument: document,
 * });
 * graph.schema;             // { $ref: 'Order' }
 * graph.schemas.get('Order'); // { type: 'object' }
 */
export function normalizeSchemaGraph(
  input: unknown,
  options: NormalizeSchemaOptions,
): NormalizedSchemaGraph {
  const registry = options.registry ?? createSchemaRegistry();
  const schema = normalizeSchema(input, { ...options, registry });
  return { schema, schemas: registry.entries() };
}

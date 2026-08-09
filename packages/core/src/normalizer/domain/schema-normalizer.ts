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

/**
 * Schema normalization: reference resolution, cycles, composition, per SPEC 5.4.
 *
 * The normalizer is fail closed. A reference that cannot be resolved, a reference chain deeper
 * than the configured limit, or two `allOf` branches that contradict each other all raise. A
 * broken specification must not render as if it were fine.
 */

/** Default limit on how deep a chain of references may be expanded, per SPEC 5.4. */
export const DEFAULT_CYCLE_DEPTH = 12;

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
  /** Limit on reference chain depth. Defaults to {@link DEFAULT_CYCLE_DEPTH}. */
  readonly cycleDepth?: number;
}

/** A mutable draft of a schema. */
type Draft = { -readonly [Key in keyof IRJsonSchema]: IRJsonSchema[Key] };

interface Context {
  readonly rootDocument: unknown;
  readonly externalDocuments: Readonly<Record<string, unknown>>;
  readonly cycleDepth: number;
  /** References currently being expanded, innermost last. */
  readonly stack: string[];
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

function convertReference(
  source: Record<string, unknown>,
  reference: string,
  context: Context,
  path: string,
): IRJsonSchema {
  const identifier = schemaNameFromReference(reference);

  // A reference already being expanded is a cycle. It folds to a marker rather than looping.
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

  // OpenAPI 3.1 allows keywords beside a `$ref`. They constrain the target further.
  const siblings = Object.fromEntries(Object.entries(source).filter(([key]) => key !== '$ref'));
  if (Object.keys(siblings).length === 0) return named;

  return mergeAllOf([named, convert(siblings, context, path)], path);
}

function convert(input: unknown, context: Context, path: string): IRJsonSchema {
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
    const branches = convertBranchList(input.allOf, context, `${path}.allOf`).map(
      (branch) => branch.schema,
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

  return convert(
    input,
    {
      rootDocument: options.rootDocument,
      externalDocuments: options.externalDocuments ?? {},
      cycleDepth,
      stack: [],
    },
    '$',
  );
}

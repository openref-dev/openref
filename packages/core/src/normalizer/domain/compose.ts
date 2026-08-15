import { canonicalize } from '../../hashing/domain/canonical';
import type { IRJsonSchema, IRJsonSchemaType, IRJsonValue } from '../../ir/domain/schema.types';
import { ErrorCode, NormalizeError } from '../../shared/errors/index';

/**
 * Composition: `allOf` merge, per SPEC 5.4.
 *
 * The merge is fail closed. Two branches that disagree about `type`, `const` or `enum` describe
 * a schema nothing can satisfy, and picking one of them would render a document that lies.
 */

/** A mutable draft of a schema, so members can be filled in one at a time. */
type Draft = { -readonly [Key in keyof IRJsonSchema]: IRJsonSchema[Key] };

/** Assigns a member only when there is one, so no optional member is set to `undefined`. */
function assign<Key extends keyof Draft>(
  draft: Draft,
  key: Key,
  value: Exclude<Draft[Key], undefined> | undefined,
): void {
  if (value === undefined) return;
  draft[key] = value;
}

function conflict(what: string, left: unknown, right: unknown, path: string): NormalizeError {
  return new NormalizeError(
    `allOf branches disagree about ${what} at ${path}`,
    ErrorCode.NORM_COMPOSITION_CONFLICT,
    undefined,
    { path, left: canonicalize(left ?? null), right: canonicalize(right ?? null) },
  );
}

function toTypeSet(
  type: IRJsonSchemaType | readonly IRJsonSchemaType[] | undefined,
): Set<IRJsonSchemaType> | undefined {
  if (type === undefined) return undefined;
  return new Set(typeof type === 'string' ? [type] : type);
}

/**
 * Intersects the `type` of two branches.
 *
 * `integer` is the narrower of `integer` and `number`, since every integer is a number. Any
 * other empty intersection is a conflict.
 *
 * @param left - Type of the first branch
 * @param right - Type of the second branch
 * @param path - Location in the document, for the error
 * @returns The intersected type, or `undefined` when neither branch constrains the type
 * @throws {NormalizeError} When the intersection is empty
 */
export function intersectTypes(
  left: IRJsonSchemaType | readonly IRJsonSchemaType[] | undefined,
  right: IRJsonSchemaType | readonly IRJsonSchemaType[] | undefined,
  path: string,
): IRJsonSchemaType | readonly IRJsonSchemaType[] | undefined {
  const leftSet = toTypeSet(left);
  const rightSet = toTypeSet(right);

  if (leftSet === undefined) return right;
  if (rightSet === undefined) return left;

  const shared = new Set([...leftSet].filter((type) => rightSet.has(type)));

  if (shared.size === 0) {
    const numericNarrowing =
      (leftSet.has('integer') && rightSet.has('number')) ||
      (leftSet.has('number') && rightSet.has('integer'));

    if (!numericNarrowing) throw conflict('type', left, right, path);
    shared.add('integer');
  }

  const ordered = [...shared].sort();
  const only = ordered[0];
  if (ordered.length === 1 && only !== undefined) return only;
  return ordered;
}

/**
 * Unions two `required` lists in order of first appearance.
 *
 * @param left - First list
 * @param right - Second list
 * @returns The union, or `undefined` when neither branch requires anything
 */
export function mergeRequired(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): readonly string[] | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;

  const union = [...left];
  for (const name of right) {
    if (!union.includes(name)) union.push(name);
  }
  return union;
}

function mergeEnums(
  left: readonly IRJsonValue[] | undefined,
  right: readonly IRJsonValue[] | undefined,
  path: string,
): readonly IRJsonValue[] | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;

  const rightForms = new Set(right.map((member) => canonicalize(member)));
  const shared = left.filter((member) => rightForms.has(canonicalize(member)));

  if (shared.length === 0) throw conflict('enum', left, right, path);
  return shared;
}

function mergeAdditional(
  left: boolean | IRJsonSchema | undefined,
  right: boolean | IRJsonSchema | undefined,
  path: string,
): boolean | IRJsonSchema | undefined {
  if (left === false || right === false) return false;
  if (left === undefined) return right;
  if (right === undefined) return left;
  if (left === true) return right;
  if (right === true) return left;
  return mergeTwo(left, right, `${path}.additionalProperties`);
}

function mergeSchemaRecord(
  left: Readonly<Record<string, IRJsonSchema>> | undefined,
  right: Readonly<Record<string, IRJsonSchema>> | undefined,
  path: string,
): Readonly<Record<string, IRJsonSchema>> | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;

  const merged: Record<string, IRJsonSchema> = { ...left };
  for (const [name, schema] of Object.entries(right)) {
    const existing = merged[name];
    merged[name] = existing === undefined ? schema : mergeTwo(existing, schema, `${path}.${name}`);
  }
  return merged;
}

function largest(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.max(left, right);
}

function smallest(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.min(left, right);
}

function eitherTrue(left: boolean | undefined, right: boolean | undefined): boolean | undefined {
  if (left === undefined && right === undefined) return undefined;
  return left === true || right === true;
}

/**
 * Extracts the keywords that cannot be flattened into a single schema.
 *
 * @param schema - Branch to inspect
 * @returns A schema holding only those keywords, or `undefined` when the branch has none
 */
function remainderOf(schema: IRJsonSchema): IRJsonSchema | undefined {
  const draft: Draft = {};
  let held = false;

  if (schema.oneOf !== undefined) {
    draft.oneOf = schema.oneOf;
    held = true;
  }
  if (schema.anyOf !== undefined) {
    draft.anyOf = schema.anyOf;
    held = true;
  }
  if (schema.not !== undefined) {
    draft.not = schema.not;
    held = true;
  }
  if (schema.variants !== undefined) {
    draft.variants = schema.variants;
    held = true;
  }
  if (schema.discriminator !== undefined) {
    draft.discriminator = schema.discriminator;
    held = true;
  }

  // A conditional is a unit: flattening `then.required` into `required` would turn required
  // at a value into required always, per SPEC 5.4. One branch's conditional rides the merged
  // schema whole; two conditionals stay two, as allOf members, because each keeps its own if.
  if (schema.if !== undefined || schema.then !== undefined || schema.else !== undefined) {
    if (schema.if !== undefined) draft.if = schema.if;
    if (schema.then !== undefined) draft.then = schema.then;
    if (schema.else !== undefined) draft.else = schema.else;
    held = true;
  }

  return held ? draft : undefined;
}

/**
 * Unions two `dependentRequired` maps by key, the `required` rule applied per key.
 *
 * Both sides state names that become required when the keying property is present, and both
 * statements hold under `allOf`, so the union loses nothing and invents nothing.
 */
function mergeDependentRequired(
  left: Readonly<Record<string, readonly string[]>> | undefined,
  right: Readonly<Record<string, readonly string[]>> | undefined,
): Readonly<Record<string, readonly string[]>> | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;

  const merged: Record<string, readonly string[]> = { ...left };
  for (const [name, names] of Object.entries(right)) {
    merged[name] = mergeRequired(merged[name], names) ?? names;
  }
  return merged;
}

function mergeTwo(left: IRJsonSchema, right: IRJsonSchema, path: string): IRJsonSchema {
  // A folded cycle carries no members, so the other branch wins outright.
  if (left.$cycle !== undefined) return right;
  if (right.$cycle !== undefined) return left;

  const draft: Draft = {};

  assign(draft, 'type', intersectTypes(left.type, right.type, path));

  if (
    left.const !== undefined &&
    right.const !== undefined &&
    canonicalize(left.const) !== canonicalize(right.const)
  ) {
    throw conflict('const', left.const, right.const, path);
  }

  assign(draft, '$id', left.$id ?? right.$id);
  assign(draft, 'title', left.title ?? right.title);
  assign(draft, 'description', left.description ?? right.description);
  assign(draft, 'format', left.format ?? right.format);
  assign(draft, 'const', left.const ?? right.const);
  assign(draft, 'default', left.default ?? right.default);
  assign(draft, 'examples', left.examples ?? right.examples);
  assign(draft, 'pattern', left.pattern ?? right.pattern);
  assign(draft, 'multipleOf', left.multipleOf ?? right.multipleOf);
  assign(draft, 'propertyNames', left.propertyNames ?? right.propertyNames);
  assign(draft, 'prefixItems', left.prefixItems ?? right.prefixItems);
  assign(draft, 'view', left.view ?? right.view);

  assign(draft, 'deprecated', eitherTrue(left.deprecated, right.deprecated));
  assign(draft, 'readOnly', eitherTrue(left.readOnly, right.readOnly));
  assign(draft, 'writeOnly', eitherTrue(left.writeOnly, right.writeOnly));
  assign(draft, 'uniqueItems', eitherTrue(left.uniqueItems, right.uniqueItems));

  assign(draft, 'enum', mergeEnums(left.enum, right.enum, path));
  assign(draft, 'required', mergeRequired(left.required, right.required));
  assign(
    draft,
    'dependentRequired',
    mergeDependentRequired(left.dependentRequired, right.dependentRequired),
  );
  assign(
    draft,
    'properties',
    mergeSchemaRecord(left.properties, right.properties, `${path}.properties`),
  );
  assign(
    draft,
    'patternProperties',
    mergeSchemaRecord(left.patternProperties, right.patternProperties, `${path}.patternProperties`),
  );

  assign(draft, 'minProperties', largest(left.minProperties, right.minProperties));
  assign(draft, 'maxProperties', smallest(left.maxProperties, right.maxProperties));
  assign(draft, 'minItems', largest(left.minItems, right.minItems));
  assign(draft, 'maxItems', smallest(left.maxItems, right.maxItems));
  assign(draft, 'minLength', largest(left.minLength, right.minLength));
  assign(draft, 'maxLength', smallest(left.maxLength, right.maxLength));
  assign(draft, 'minimum', largest(left.minimum, right.minimum));
  assign(draft, 'maximum', smallest(left.maximum, right.maximum));
  assign(draft, 'exclusiveMinimum', largest(left.exclusiveMinimum, right.exclusiveMinimum));
  assign(draft, 'exclusiveMaximum', smallest(left.exclusiveMaximum, right.exclusiveMaximum));

  assign(
    draft,
    'additionalProperties',
    mergeAdditional(left.additionalProperties, right.additionalProperties, path),
  );

  if (left.items !== undefined && right.items !== undefined) {
    draft.items = mergeTwo(left.items, right.items, `${path}.items`);
  } else {
    assign(draft, 'items', left.items ?? right.items);
  }

  const extensions = { ...left.extensions, ...right.extensions };
  if (Object.keys(extensions).length > 0) draft.extensions = extensions;

  const remainders = [remainderOf(left), remainderOf(right)].filter(
    (value): value is IRJsonSchema => value !== undefined,
  );
  const onlyRemainder = remainders[0];

  if (remainders.length === 1 && onlyRemainder !== undefined) {
    Object.assign(draft, onlyRemainder);
  } else if (remainders.length > 1) {
    draft.allOf = remainders;
  }

  return draft;
}

/**
 * Merges the branches of an `allOf` into one schema.
 *
 * `required` is the union in order of first appearance, `properties` merge recursively, and the
 * most restrictive `additionalProperties` wins. Keywords that cannot be flattened, `oneOf`,
 * `anyOf` and `not`, are kept: if only one branch has them they move up, and if several do they
 * stay under `allOf`, so nothing is silently dropped.
 *
 * @param branches - Already normalized branches
 * @param path - Location in the document, for error messages
 * @returns One schema equivalent to the conjunction of the branches
 * @throws {NormalizeError} When two branches disagree about `type`, `const` or `enum`
 *
 * @example
 * mergeAllOf([{ required: ['a'] }, { required: ['b'] }]).required; // ['a', 'b']
 */
export function mergeAllOf(branches: readonly IRJsonSchema[], path = '$'): IRJsonSchema {
  let merged: IRJsonSchema = branches[0] ?? {};

  for (let index = 1; index < branches.length; index += 1) {
    merged = mergeTwo(merged, branches[index] ?? {}, path);
  }

  return merged;
}

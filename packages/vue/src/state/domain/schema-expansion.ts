import { schemaNameFromId } from '@openref/core';
import type { IRJsonSchema, IRSchema, IRSchemaView } from '@openref/core';

/**
 * Lazy expansion of a schema tree, with cycle protection the expander owns.
 *
 * SPEC 5.1.1 splits the responsibility, and the split is the whole reason this file exists.
 * Core marks a cycle among targets that have no name, because such a target is substituted in
 * place and normalization would not terminate without the marker. A cycle among named schemas
 * carries no marker and never will: a chain of `{ $ref: id }` does not expand, so there is
 * nothing to terminate, and choosing which schema of the cycle to mark would have made the IR
 * depend on traversal order and the document hash with it.
 *
 * So the expander keeps its own path of visited schema ids and detects a revisit itself. It
 * must not ask the IR, and it must not wait for a `$cycle` node that will not arrive.
 *
 * Expansion is lazy in the literal sense: {@link expandSchemaNode} produces one level of
 * children per call. A tree of six hundred schemas costs nothing until something opens it.
 */

/** How a position in the tree came to exist, which is what a theme labels it with. */
export type SchemaTreeRelation =
  | 'root'
  | 'property'
  | 'patternProperty'
  | 'propertyNames'
  | 'additionalProperties'
  | 'items'
  | 'prefixItem'
  | 'allOf'
  | 'oneOf'
  | 'anyOf'
  | 'not'
  | 'variant';

/** One position in an expanded schema tree. */
export interface SchemaTreeNode {
  /**
   * Stable key of this position, unique within its tree.
   *
   * Built from the labels on the way down, so it survives a re-render and can key the set of
   * open positions without holding on to the nodes themselves.
   */
  readonly path: string;
  readonly label: string;
  readonly relation: SchemaTreeRelation;
  /** The schema body at this position, already dereferenced when the position names a schema. */
  readonly schema: IRJsonSchema;
  /** Id in `document.schemas`, set when this position holds a named schema. */
  readonly schemaId?: string;
  /** Display name of the named schema, which is never the deterministic id suffix. */
  readonly schemaName?: string;
  readonly required: boolean;
  /** True when this position revisits a schema already on the path from the root. */
  readonly cycle: boolean;
  /** Id the revisit points back to, set when {@link SchemaTreeNode.cycle} is true. */
  readonly cycleTarget?: string;
  /** Whether {@link expandSchemaNode} would produce children here. */
  readonly expandable: boolean;
  /** Named schema ids on the path from the root, this position included. The cycle guard. */
  readonly refPath: readonly string[];
}

/** What expansion needs besides the node: the schema map, and the view being shown. */
export interface SchemaExpansionOptions {
  readonly schemas: ReadonlyMap<string, IRSchema>;
  /** Drop positions that do not belong to this view. `both` keeps everything. */
  readonly view?: IRSchemaView;
}

/**
 * Human part of a schema id.
 *
 * An external schema is registered under a marked id that carries 8 hex of its document URI,
 * per SPEC 5.1.1. The marker is an identity mechanism, not a display string, so nothing
 * rendered shows it.
 *
 * The splitting itself belongs to `core`, which owns the construction of the id. It used to be
 * a regular expression here, and that regular expression could not tell an external target
 * apart from an internal schema the document had named to look like one, which is the display
 * side of F1.
 */
export function schemaDisplayName(schema: IRSchema | undefined, id: string): string {
  return schemaNameFromId(schema?.name ?? id);
}

/** Resolve a position that holds `$ref` to the body it names, or leave it alone. */
function dereference(
  schema: IRJsonSchema,
  schemas: ReadonlyMap<string, IRSchema>,
): { readonly body: IRJsonSchema; readonly schemaId?: string } {
  if (schema.$ref === undefined) return { body: schema };

  const target = schemas.get(schema.$ref);
  const body = target?.normalized;
  if (body === undefined) {
    // A reference into nothing is not this layer's to diagnose: the normalizer is fail closed
    // and already refused it. Showing the bare reference is honest about what is here.
    return { body: schema, schemaId: schema.$ref };
  }

  // Annotations written beside the reference belong to the use site, not to the target, so
  // they win over the target's own. Everything else at a `$ref` position is absent by SPEC.
  return {
    body: {
      ...body,
      ...(schema.title === undefined ? {} : { title: schema.title }),
      ...(schema.description === undefined ? {} : { description: schema.description }),
      ...(schema.deprecated === undefined ? {} : { deprecated: schema.deprecated }),
      ...(schema.readOnly === undefined ? {} : { readOnly: schema.readOnly }),
      ...(schema.writeOnly === undefined ? {} : { writeOnly: schema.writeOnly }),
      ...(schema.view === undefined ? {} : { view: schema.view }),
    },
    schemaId: schema.$ref,
  };
}

/** Whether a body has anything below it worth opening. */
function hasChildren(schema: IRJsonSchema): boolean {
  return (
    (schema.properties !== undefined && Object.keys(schema.properties).length > 0) ||
    (schema.patternProperties !== undefined && Object.keys(schema.patternProperties).length > 0) ||
    schema.propertyNames !== undefined ||
    typeof schema.additionalProperties === 'object' ||
    schema.items !== undefined ||
    (schema.prefixItems?.length ?? 0) > 0 ||
    (schema.allOf?.length ?? 0) > 0 ||
    (schema.oneOf?.length ?? 0) > 0 ||
    (schema.anyOf?.length ?? 0) > 0 ||
    schema.not !== undefined ||
    (schema.variants?.length ?? 0) > 0
  );
}

/**
 * Whether a position belongs to the view being rendered.
 *
 * Two sources say so and both are consulted. `view` is the stamp `applyView` leaves on a
 * schema that has already been split, per SPEC 5.4. `readOnly` and `writeOnly` are what the
 * document itself wrote, and they are what the schema map carries, because the map holds one
 * neutral copy of each named schema rather than a request copy and a response copy.
 */
function inView(schema: IRJsonSchema, view: IRSchemaView | undefined): boolean {
  if (view === undefined || view === 'both') return true;

  const own = schema.view;
  if (own !== undefined && own !== 'both' && own !== view) return false;

  if (view === 'request' && schema.readOnly === true) return false;
  if (view === 'response' && schema.writeOnly === true) return false;
  return true;
}

interface ChildInput {
  readonly label: string;
  readonly relation: SchemaTreeRelation;
  readonly schema: IRJsonSchema;
  readonly required?: boolean;
}

/** Children of a body, in the order a theme shows them. */
function childInputs(schema: IRJsonSchema): ChildInput[] {
  const children: ChildInput[] = [];
  const required = new Set(schema.required ?? []);

  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    children.push({
      label: name,
      relation: 'property',
      schema: child,
      required: required.has(name),
    });
  }
  for (const [pattern, child] of Object.entries(schema.patternProperties ?? {})) {
    children.push({ label: pattern, relation: 'patternProperty', schema: child });
  }
  if (schema.propertyNames !== undefined) {
    children.push({
      label: 'propertyNames',
      relation: 'propertyNames',
      schema: schema.propertyNames,
    });
  }
  if (typeof schema.additionalProperties === 'object') {
    children.push({
      label: 'additionalProperties',
      relation: 'additionalProperties',
      schema: schema.additionalProperties,
    });
  }
  if (schema.items !== undefined) {
    children.push({ label: 'items', relation: 'items', schema: schema.items });
  }
  schema.prefixItems?.forEach((child, index) => {
    children.push({
      label: `prefixItems[${String(index)}]`,
      relation: 'prefixItem',
      schema: child,
    });
  });
  schema.allOf?.forEach((child, index) => {
    children.push({ label: `allOf[${String(index)}]`, relation: 'allOf', schema: child });
  });

  // Variants carry the readable labels the normalizer produced, so they stand in for the raw
  // `oneOf` and `anyOf` branches wherever they exist.
  if (schema.variants !== undefined && schema.variants.length > 0) {
    schema.variants.forEach((variant) => {
      children.push({ label: variant.label, relation: 'variant', schema: variant.schema });
    });
  } else {
    schema.oneOf?.forEach((child, index) => {
      children.push({ label: `oneOf[${String(index)}]`, relation: 'oneOf', schema: child });
    });
    schema.anyOf?.forEach((child, index) => {
      children.push({ label: `anyOf[${String(index)}]`, relation: 'anyOf', schema: child });
    });
  }

  if (schema.not !== undefined) {
    children.push({ label: 'not', relation: 'not', schema: schema.not });
  }

  return children;
}

/** Build one tree node from a position, applying the cycle guard the expander owns. */
function toTreeNode(
  input: ChildInput,
  parentPath: string,
  parentRefPath: readonly string[],
  options: SchemaExpansionOptions,
): SchemaTreeNode {
  const path = parentPath === '' ? input.label : `${parentPath}/${input.label}`;
  const { body, schemaId } = dereference(input.schema, options.schemas);

  // The guard. A named target already on the path from the root is a revisit, and no marker in
  // the IR says so, because a reference never expanded in the first place.
  const revisit = schemaId !== undefined && parentRefPath.includes(schemaId);
  const unnamedCycle = input.schema.$cycle;
  const cycle = revisit || unnamedCycle !== undefined;
  const cycleTarget = revisit ? schemaId : unnamedCycle;

  const refPath = schemaId === undefined || revisit ? parentRefPath : [...parentRefPath, schemaId];

  return {
    path,
    label: input.label,
    relation: input.relation,
    schema: body,
    ...(schemaId === undefined ? {} : { schemaId }),
    ...(schemaId === undefined
      ? {}
      : { schemaName: schemaDisplayName(options.schemas.get(schemaId), schemaId) }),
    required: input.required ?? false,
    cycle,
    ...(cycleTarget === undefined ? {} : { cycleTarget }),
    expandable: !cycle && hasChildren(body),
    refPath,
  };
}

/**
 * Root of a tree over a named schema.
 *
 * @param schemaId - Key into the schema map
 * @param options - The schema map and the view
 * @returns The root position, or `undefined` when the id names nothing
 *
 * @example
 * const root = schemaTreeRoot('Order', { schemas: document.schemas });
 */
export function schemaTreeRoot(
  schemaId: string,
  options: SchemaExpansionOptions,
): SchemaTreeNode | undefined {
  const entry = options.schemas.get(schemaId);
  if (entry?.normalized === undefined) return undefined;

  return toTreeNode(
    { label: schemaDisplayName(entry, schemaId), relation: 'root', schema: { $ref: schemaId } },
    '',
    [],
    options,
  );
}

/**
 * Root of a tree over a schema written inline at a use site.
 *
 * @param schema - The inline body
 * @param label - Label of the root position, for example the media type
 * @param options - The schema map and the view
 * @returns The root position
 */
export function inlineSchemaTreeRoot(
  schema: IRJsonSchema,
  label: string,
  options: SchemaExpansionOptions,
): SchemaTreeNode {
  return toTreeNode({ label, relation: 'root', schema }, '', [], options);
}

/**
 * One level of children of a position.
 *
 * Called when a position is opened, never before, which is what makes expansion lazy.
 *
 * @param node - The position being opened
 * @param options - The schema map and the view
 * @returns Children in display order, empty when the position closes a cycle
 *
 * @example
 * const children = expandSchemaNode(root, { schemas: document.schemas, view: 'request' });
 */
export function expandSchemaNode(
  node: SchemaTreeNode,
  options: SchemaExpansionOptions,
): readonly SchemaTreeNode[] {
  // A revisit stops here. This is the termination condition, and it comes from the expander's
  // own path rather than from anything the IR carries.
  if (node.cycle) return [];

  return childInputs(node.schema)
    .filter((child) => inView(child.schema, options.view))
    .map((child) => toTreeNode(child, node.path, node.refPath, options));
}

/**
 * The reading half of the shapes page: every branch of a schema, expanded at once, as rows.
 *
 * THIS IS NOT THE SCHEMA TREE. The tree on the schema page is lazy, collapsible and complete;
 * these rows are flat, all present in the server markup, and selective: they answer one
 * question, which fields exist under which branch and when each is required, in the layout's
 * own columns. Structure past that, nested objects among it, is the schema page's job, and a
 * named position links there rather than repeating it.
 *
 * THE DESIGNER'S LINE IS THE CONTRACT OF THIS MODULE: a reader must never conclude a field is
 * always required when it is required only sometimes. Requiredness comes out in three sorts,
 * and the conditional sort always carries its condition in words, from `shape-conditions`.
 */

import type { IRJsonSchema, IRSchema, IRSchemaVariant } from '@openref/core';
import {
  conditionsOf,
  isNeverSchema,
  leadingValueOf,
  requirednessOf,
  selectingValueOf,
  type ShapeRequiredness,
} from './shape-conditions';

/** One row of the reading half. */
export interface ShapeRow {
  /** Stable key, the field path down the walk. */
  readonly path: string;
  /** Nesting level, 0 for the root's own fields. */
  readonly depth: number;
  /** What the row is: a field, a branch of a oneOf, or a pattern of patternProperties. */
  readonly kind: 'field' | 'variant' | 'pattern';
  /** Field name, branch label, or the pattern itself. */
  readonly name: string;
  /** The type in words: `integer`, `enum: EUR, USD`, `oneOf, 4 variants`, `tuple [number, number]`. */
  readonly type: string;
  /** Schema page address when the position names a named schema. */
  readonly href?: string;
  /** Requiredness column. Empty on variant and pattern rows, which are not fields. */
  readonly requiredness: '' | ShapeRequiredness;
  /** The condition line: requiredness conditions, branch selectors, patterns, tuple tails. */
  readonly when: string;
}

/** How deep the rows descend before handing the rest to the schema page. */
const DEPTH_LIMIT = 6;

interface WalkContext {
  readonly schemas: Readonly<Record<string, IRSchema>>;
  readonly basePath: string;
  /** Named schemas on the current descent, the T008 rule: the walker tracks its own path. */
  readonly refPath: string[];
  readonly rows: ShapeRow[];
}

/** The address of a schema's own page. */
function schemaHrefOf(context: WalkContext, id: string): string {
  return `${context.basePath}/schema/${encodeURIComponent(id)}`;
}

/** Resolves a position to the body to read, following one named reference. */
function dereference(
  schema: IRJsonSchema,
  context: WalkContext,
): { readonly body: IRJsonSchema; readonly id?: string; readonly name?: string } {
  if (schema.$ref === undefined) return { body: schema };

  const target = context.schemas[schema.$ref];
  if (target?.normalized === undefined) {
    // Outside the page's bounded payload: the recorded degradation is the link.
    return { body: schema, id: schema.$ref, name: schema.$ref };
  }

  return { body: target.normalized, id: target.id, name: target.name ?? target.id };
}

/** The type of a position, in words. */
function typeWordsOf(body: IRJsonSchema): string {
  if (body.$cycle !== undefined) return `cycle to ${body.$cycle}`;

  const variants = body.variants;
  if (variants !== undefined && variants.length > 0) {
    const keyword = body.oneOf !== undefined ? 'oneOf' : 'anyOf';
    return `${keyword}, ${String(variants.length)} ${variants.length === 1 ? 'variant' : 'variants'}`;
  }

  if (body.const !== undefined) return `constant ${JSON.stringify(body.const)}`;
  if (body.enum !== undefined) {
    return `enum: ${body.enum.map((member) => (typeof member === 'string' ? member : JSON.stringify(member))).join(', ')}`;
  }

  if (body.prefixItems !== undefined) {
    return `tuple [${body.prefixItems.map((member) => typeWordsOf(member)).join(', ')}]`;
  }

  const type = typeof body.type === 'string' ? body.type : body.type?.join(' | ');

  if (type === 'array' || (type === undefined && body.items !== undefined)) {
    return body.items === undefined ? 'array' : `array of ${typeWordsOf(body.items)}`;
  }

  if (
    (type === 'object' || type === undefined) &&
    body.patternProperties !== undefined &&
    Object.keys(body.patternProperties).length > 0
  ) {
    return 'object, keys by pattern';
  }

  if (type === 'string') {
    if (body.format !== undefined) return `string, ${body.format}`;
    if (body.minLength !== undefined || body.maxLength !== undefined) {
      return `string ${String(body.minLength ?? '')}..${String(body.maxLength ?? '')}`;
    }
  }

  return type ?? 'any';
}

/** The tuple's condition line: position titles, and the closed tail when it is closed. */
function tupleWords(body: IRJsonSchema): string {
  const titles = (body.prefixItems ?? []).map(
    (member, index) => member.title ?? `[${String(index)}]`,
  );
  const closed = isNeverSchema(body.items) ? '; no items beyond the tuple' : '';

  return `prefixItems: ${titles.join(', ')}${closed}`;
}

/** The condition line of one field row: its requiredness condition first, else its shape's. */
function whenOf(when: string | undefined, body: IRJsonSchema): string {
  if (when !== undefined) return when;
  if (body.prefixItems !== undefined) return tupleWords(body);

  const patterns = Object.keys(body.patternProperties ?? {});
  return patterns.length > 0 ? patterns.join(', ') : '';
}

/** Emits the rows of one branch of a `oneOf`, selector line first, fields under it. */
function walkVariant(
  variant: IRSchemaVariant,
  leading: string | null,
  path: string,
  depth: number,
  context: WalkContext,
): void {
  const { body, id, name } = dereference(variant.schema, context);
  const selecting = selectingValueOf(body, leading, variant.discriminatorValue);

  context.rows.push({
    path: `${path}/${variant.label}`,
    depth,
    kind: 'variant',
    name: variant.label,
    type: 'variant',
    ...(id === undefined ? {} : { href: schemaHrefOf(context, id) }),
    requiredness: '',
    when: selecting === null || leading === null ? '' : `${leading} = ${selecting}`,
  });

  if (id !== undefined && context.refPath.includes(id)) {
    context.rows.push({
      path: `${path}/${variant.label}/cycle`,
      depth: depth + 1,
      kind: 'field',
      name: name ?? id,
      type: `cycle to ${id}`,
      requiredness: '',
      when: '',
    });
    return;
  }

  if (id !== undefined) context.refPath.push(id);
  walkObject(body, `${path}/${variant.label}`, depth + 1, context, leading);
  if (id !== undefined) context.refPath.pop();
}

/** Emits the variant rows of a position that holds them. */
function walkVariants(body: IRJsonSchema, path: string, depth: number, context: WalkContext): void {
  const variants = body.variants ?? [];
  if (variants.length === 0 || depth > DEPTH_LIMIT) return;

  const leading = leadingValueOf(
    body,
    variants.map((variant) => dereference(variant.schema, context).body),
  );

  for (const variant of variants) {
    walkVariant(variant, leading, path, depth, context);
  }
}

/**
 * Emits the rows of one object schema: its fields, and the branches attached to them.
 *
 * @param body - The object schema, dereferenced
 * @param path - Path prefix of the rows
 * @param depth - Nesting level of the fields
 * @param context - The walk
 * @param skipProperty - A leading value the enclosing variant already stated, not repeated
 */
function walkObject(
  body: IRJsonSchema,
  path: string,
  depth: number,
  context: WalkContext,
  skipProperty: string | null = null,
): void {
  if (depth > DEPTH_LIMIT) return;

  const conditions = conditionsOf(body);
  const ownLeading =
    body.variants === undefined || body.variants.length === 0
      ? null
      : leadingValueOf(
          body,
          body.variants.map((variant) => dereference(variant.schema, context).body),
        );

  for (const [name, member] of Object.entries(body.properties ?? {})) {
    // The selecting constant of the branch the reader is already inside: its row is the
    // variant's own `when` line, and printing it again would be the F15 class.
    if (name === skipProperty) continue;
    // The reading half reads the request view's story: what a reader can send.
    if (member.readOnly === true) continue;

    const resolved = dereference(member, context);
    const { sort, when } = requirednessOf(name, body, conditions);
    const isLeadingRow = name === ownLeading;
    const hasOwnVariants = (resolved.body.variants?.length ?? 0) > 0;

    context.rows.push({
      path: `${path}/${name}`,
      depth,
      kind: 'field',
      name,
      type: isLeadingRow
        ? `oneOf, ${String(body.variants?.length ?? 0)} variants`
        : resolved.name !== undefined && resolved.id !== undefined && !hasOwnVariants
          ? resolved.name
          : typeWordsOf(resolved.body),
      ...(resolved.id === undefined ? {} : { href: schemaHrefOf(context, resolved.id) }),
      requiredness: sort,
      when: whenOf(when, resolved.body),
    });

    // The branches of the whole object attach under the row of the value that selects them.
    if (isLeadingRow) {
      walkVariants(body, `${path}/${name}`, depth + 1, context);
      continue;
    }

    // A property that is itself a choice: its branches nest under it, however deep.
    if (hasOwnVariants) {
      const guarded = resolved.id !== undefined;
      if (guarded && context.refPath.includes(resolved.id ?? '')) continue;
      if (guarded) context.refPath.push(resolved.id ?? '');
      walkVariants(resolved.body, `${path}/${name}`, depth + 1, context);
      if (guarded) context.refPath.pop();
      continue;
    }

    // Pattern keys: one row per pattern, under the object that admits them.
    for (const [pattern, value] of Object.entries(resolved.body.patternProperties ?? {})) {
      context.rows.push({
        path: `${path}/${name}/${pattern}`,
        depth: depth + 1,
        kind: 'pattern',
        name: pattern,
        type: typeWordsOf(value),
        requiredness: '',
        when: '',
      });
    }
  }

  // A oneOf with no leading property among the fields still shows its branches: they attach
  // under the keyword itself, since no field's value selects them.
  if (body.variants !== undefined && body.variants.length > 0 && ownLeading === null) {
    context.rows.push({
      path: `${path}/oneOf`,
      depth,
      kind: 'field',
      name: body.oneOf !== undefined ? 'oneOf' : 'anyOf',
      type: typeWordsOf(body),
      requiredness: '',
      when: '',
    });
    walkVariants(body, `${path}/oneOf`, depth + 1, context);
  }

  if (
    body.variants !== undefined &&
    body.variants.length > 0 &&
    ownLeading !== null &&
    body.properties?.[ownLeading] === undefined
  ) {
    // A discriminator naming a property the schema does not declare: the branches still show,
    // headed by the leading value's name.
    context.rows.push({
      path: `${path}/${ownLeading}`,
      depth,
      kind: 'field',
      name: ownLeading,
      type: typeWordsOf(body),
      requiredness: '',
      when: '',
    });
    walkVariants(body, `${path}/${ownLeading}`, depth + 1, context);
  }
}

/**
 * The rows of the reading half, for one named schema.
 *
 * @param schemaId - Id of the schema the page shows
 * @param schemas - The page's bounded schema payload
 * @param basePath - Mount point, for schema page links
 * @returns The rows, empty when the schema is not in the payload or is not an object
 */
export function shapeRowsOf(
  schemaId: string,
  schemas: Readonly<Record<string, IRSchema>>,
  basePath: string,
): readonly ShapeRow[] {
  const root = schemas[schemaId]?.normalized;
  if (root === undefined) return [];

  const context: WalkContext = {
    schemas,
    basePath,
    refPath: [schemaId],
    rows: [],
  };

  walkObject(root, '', 0, context);
  return context.rows;
}

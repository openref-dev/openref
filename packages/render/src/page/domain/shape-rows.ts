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
import { schemaHref } from './links';
import {
  conditionsOf,
  isNeverSchema,
  leadingValueOf,
  requirednessOf,
  selectingValueOf,
  undrawnConditionWords,
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

/** The address of a schema's own page, through the one function `links.ts` states. */
function schemaHrefOf(context: WalkContext, id: string): string {
  return schemaHref(id, context.basePath);
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
    // BOTH KINDS OF KEY ARE NAMED WHEN BOTH EXIST, per the T039 filing: `object, keys by
    // pattern` alone read as if the declared properties were not there.
    return Object.keys(body.properties ?? {}).length > 0
      ? 'object, declared keys and keys by pattern'
      : 'object, keys by pattern';
  }

  if (type === 'string') {
    if (body.format !== undefined) return `string, ${body.format}`;
    if (body.minLength !== undefined || body.maxLength !== undefined) {
      return `string ${String(body.minLength ?? '')}..${String(body.maxLength ?? '')}`;
    }
  }

  return type ?? 'any';
}

/** The tuple's condition line: position titles, and whether the tail is open or closed. */
function tupleWords(body: IRJsonSchema): string {
  // AN OPEN TUPLE READS AS OPEN, per the T039 filing. Silence used to mean open, but a reader
  // cannot tell a stated closure apart from a line that simply ended, so both states say so.
  const tail = isNeverSchema(body.items)
    ? '; no items beyond the tuple'
    : '; open: items beyond the tuple are allowed';
  const titles = (body.prefixItems ?? []).map(
    (member, index) => member.title ?? `[${String(index)}]`,
  );

  return `prefixItems: ${titles.join(', ')}${tail}`;
}

/** The condition line of one field row: its requiredness condition first, else its shape's. */
function whenOf(when: string | undefined, body: IRJsonSchema): string {
  if (when !== undefined) return when;
  if (body.prefixItems !== undefined) return tupleWords(body);

  const patterns = Object.keys(body.patternProperties ?? {});
  return patterns.length > 0 ? patterns.join(', ') : '';
}

/**
 * The field names a body's conditions can honestly test at its own instance.
 *
 * The body's declared properties, plus the leading value's name when its branches share one:
 * both are names a reader meets at this level of the rows. A branch's fields join the set of
 * the instance it constrains, because a `oneOf` branch of an object constrains that same
 * object rather than a nested one.
 *
 * @param body - The object schema
 * @param leading - The leading value's name, when the body holds variants
 * @param inherited - Fields of the instance this body joins, for a branch
 * @returns The names
 */
function instanceFieldsOf(
  body: IRJsonSchema,
  leading: string | null,
  inherited: ReadonlySet<string>,
): ReadonlySet<string> {
  const fields = new Set(inherited);
  for (const name of Object.keys(body.properties ?? {})) fields.add(name);
  if (leading !== null) fields.add(leading);
  return fields;
}

/** Emits the rows of one branch of a `oneOf`, selector line first, fields under it. */
function walkVariant(
  variant: IRSchemaVariant,
  leading: string | null,
  path: string,
  depth: number,
  context: WalkContext,
  instanceFields: ReadonlySet<string>,
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
  // THE BRANCH JOINS THE INSTANCE IT CONSTRAINS: its conditions may honestly name the
  // enclosing object's own fields, which is the fixture's `CardMethod` writing a condition on
  // a root field from inside a root `oneOf` branch.
  walkObject(
    body,
    `${path}/${variant.label}`,
    depth + 1,
    context,
    leading,
    instanceFieldsOf(body, leading, instanceFields),
  );
  if (id !== undefined) context.refPath.pop();
}

/** Emits the variant rows of a position that holds them. */
function walkVariants(
  body: IRJsonSchema,
  path: string,
  depth: number,
  context: WalkContext,
  instanceFields: ReadonlySet<string>,
): void {
  const variants = body.variants ?? [];
  if (variants.length === 0 || depth > DEPTH_LIMIT) return;

  const leading = leadingValueOf(
    body,
    variants.map((variant) => dereference(variant.schema, context).body),
  );

  for (const variant of variants) {
    walkVariant(variant, leading, path, depth, context, instanceFields);
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
 * @param inheritedFields - Fields of the instance this body joins, for a branch
 */
function walkObject(
  body: IRJsonSchema,
  path: string,
  depth: number,
  context: WalkContext,
  skipProperty: string | null = null,
  inheritedFields: ReadonlySet<string> = new Set<string>(),
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

  // WHAT A CONDITION MAY HONESTLY NAME HERE, per the T039 filing. A condition testing a field
  // outside this set can never be satisfied at this level, and the row says so rather than
  // printing a requiredness a reader could never trigger. The reading half asks the same
  // question the filling half asks through `readCondition`, over the names it draws rather
  // than over the paths a form drew, because these rows have no values in them.
  const instanceFields = instanceFieldsOf(body, ownLeading, inheritedFields);
  const undrawnOf = (name: string): string => {
    const condition = conditions.find((candidate) => candidate.requires.includes(name));
    if (condition === undefined) return '';

    const missing = condition.clauses
      .map((clause) => clause.field)
      .filter(
        (field, index, all) =>
          field !== '' && !instanceFields.has(field) && all.indexOf(field) === index,
      );

    return missing.length === 0 ? '' : undrawnConditionWords(missing);
  };

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
    const undrawn = sort === 'conditional' ? undrawnOf(name) : '';

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
      when: undrawn === '' ? whenOf(when, resolved.body) : `${when ?? ''} ${undrawn}`.trim(),
    });

    // The branches of the whole object attach under the row of the value that selects them.
    if (isLeadingRow) {
      walkVariants(body, `${path}/${name}`, depth + 1, context, instanceFields);
      continue;
    }

    // A property that is itself a choice: its branches nest under it, however deep.
    if (hasOwnVariants) {
      const guarded = resolved.id !== undefined;
      if (guarded && context.refPath.includes(resolved.id ?? '')) continue;
      if (guarded) context.refPath.push(resolved.id ?? '');
      // A NESTED CHOICE CONSTRAINS ITS OWN INSTANCE, not this one, so its branches start from
      // that property's own fields rather than inheriting this object's.
      walkVariants(
        resolved.body,
        `${path}/${name}`,
        depth + 1,
        context,
        new Set(Object.keys(resolved.body.properties ?? {})),
      );
      if (guarded) context.refPath.pop();
      continue;
    }

    // Pattern keys: one row per pattern, under the object that admits them. Drawn beside the
    // declared properties rather than instead of them, per the T039 filing: `typeWordsOf`
    // names both kinds of key and the schema page holds the declared ones in full.
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

  // THE BODY'S OWN PATTERN KEYS, per the T039 filing: both walkers reached a pattern only
  // through a member of `properties`, so root level `patternProperties` was invisible in both
  // halves. Emitted after the declared fields, at their depth, so both kinds of key are here.
  for (const [pattern, value] of Object.entries(body.patternProperties ?? {})) {
    context.rows.push({
      path: `${path}/${pattern}`,
      depth,
      kind: 'pattern',
      name: pattern,
      type: typeWordsOf(value),
      requiredness: '',
      when: '',
    });
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
    walkVariants(body, `${path}/oneOf`, depth + 1, context, instanceFields);
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
    walkVariants(body, `${path}/${ownLeading}`, depth + 1, context, instanceFields);
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

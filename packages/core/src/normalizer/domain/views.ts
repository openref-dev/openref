import type { IRJsonSchema, IRSchemaView } from '../../ir/domain/schema.types';

/**
 * Request and response views, per SPEC 5.4.
 *
 * The same schema describes two different shapes. A `readOnly` field is present in a response
 * and must not be sent in a request; a `writeOnly` field is the other way round. Rendering one
 * schema for both is the most common way an API reference misleads its reader.
 */

/** A mutable draft of a schema. */
type Draft = { -readonly [Key in keyof IRJsonSchema]: IRJsonSchema[Key] };

function isDroppedIn(schema: IRJsonSchema, view: IRSchemaView): boolean {
  if (view === 'request') return schema.readOnly === true;
  if (view === 'response') return schema.writeOnly === true;
  return false;
}

function applyToRecord(
  record: Readonly<Record<string, IRJsonSchema>>,
  view: IRSchemaView,
  seen: Set<IRJsonSchema>,
): { readonly kept: Record<string, IRJsonSchema>; readonly dropped: readonly string[] } {
  const kept: Record<string, IRJsonSchema> = {};
  const dropped: string[] = [];

  for (const [name, member] of Object.entries(record)) {
    if (isDroppedIn(member, view)) {
      dropped.push(name);
      continue;
    }
    kept[name] = walk(member, view, seen);
  }

  return { kept, dropped };
}

function walk(schema: IRJsonSchema, view: IRSchemaView, seen: Set<IRJsonSchema>): IRJsonSchema {
  if (schema.$cycle !== undefined) return schema;
  if (seen.has(schema)) return schema;

  seen.add(schema);

  try {
    const draft: Draft = { ...schema, view };

    if (schema.properties !== undefined) {
      const { kept, dropped } = applyToRecord(schema.properties, view, seen);
      draft.properties = kept;

      if (schema.required !== undefined) {
        draft.required = schema.required.filter((name) => !dropped.includes(name));
      }
    }

    if (schema.patternProperties !== undefined) {
      draft.patternProperties = applyToRecord(schema.patternProperties, view, seen).kept;
    }

    if (schema.items !== undefined) draft.items = walk(schema.items, view, seen);
    if (schema.propertyNames !== undefined) {
      draft.propertyNames = walk(schema.propertyNames, view, seen);
    }
    if (schema.not !== undefined) draft.not = walk(schema.not, view, seen);

    if (schema.if !== undefined) draft.if = walk(schema.if, view, seen);
    if (schema.then !== undefined) draft.then = walk(schema.then, view, seen);
    if (schema.else !== undefined) draft.else = walk(schema.else, view, seen);

    if (typeof schema.additionalProperties === 'object') {
      draft.additionalProperties = walk(schema.additionalProperties, view, seen);
    }

    if (schema.prefixItems !== undefined) {
      draft.prefixItems = schema.prefixItems.map((member) => walk(member, view, seen));
    }
    if (schema.allOf !== undefined) {
      draft.allOf = schema.allOf.map((member) => walk(member, view, seen));
    }
    if (schema.oneOf !== undefined) {
      draft.oneOf = schema.oneOf.map((member) => walk(member, view, seen));
    }
    if (schema.anyOf !== undefined) {
      draft.anyOf = schema.anyOf.map((member) => walk(member, view, seen));
    }
    if (schema.variants !== undefined) {
      draft.variants = schema.variants.map((variant) => ({
        ...variant,
        schema: walk(variant.schema, view, seen),
      }));
    }

    return draft;
  } finally {
    seen.delete(schema);
  }
}

/**
 * Produces the view of a schema that a given direction of traffic actually has.
 *
 * Dropping a property also drops its name from `required`, since requiring a field that is not
 * in the shape would be unsatisfiable.
 *
 * @param schema - Normalized schema
 * @param view - Which view to produce; `both` marks the schema without removing anything
 * @returns The schema for that view, with `view` set on every level
 */
export function applyView(schema: IRJsonSchema, view: IRSchemaView): IRJsonSchema {
  return walk(schema, view, new Set<IRJsonSchema>());
}

/**
 * Produces the request view: `readOnly` properties removed.
 *
 * @param schema - Normalized schema
 * @returns The shape a client is expected to send
 */
export function toRequestView(schema: IRJsonSchema): IRJsonSchema {
  return applyView(schema, 'request');
}

/**
 * Produces the response view: `writeOnly` properties removed.
 *
 * @param schema - Normalized schema
 * @returns The shape a client is expected to receive
 */
export function toResponseView(schema: IRJsonSchema): IRJsonSchema {
  return applyView(schema, 'response');
}

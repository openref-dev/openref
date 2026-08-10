/**
 * The schemas one page carries, and the bound on how many of them it carries.
 *
 * THE VIEWER EXPANDS ON THE CLIENT, so the client needs schema bodies, and a page that shipped
 * the document's whole schema map would ship the document. Measured over the corpus, the worst
 * page of `stripe.yaml` reaches 1075 of its 1440 schemas and 1265 KB of JSON, with a mean of
 * 1097 KB per page: the graph is dense enough that "everything this node can reach" is very
 * nearly "everything". Two thirds of the corpus reaches under 1 KB. A closure is therefore the
 * right shape and the wrong size, and it needs a bound rather than a different shape.
 *
 * The bound is breadth first from the use sites, so what ships is what is nearest to what the
 * reader is looking at, and what is dropped is what they would have had to open several levels
 * to see. A dropped target is not lost: the viewer renders it as a link to that schema's own
 * page, which is a page because the navigation already ends in a `Schemas` group.
 *
 * WHAT IS DROPPED IS RECORDED, never silently missing. `truncated` names every id that was
 * referenced and not shipped, so the viewer can tell "this target is on another page" from
 * "this target has nothing under it", and so a test can assert which case it is in.
 */

import type { IRDocument, IRJsonSchema, IRSchema, IRSchemaSlot } from '@openref/core';

/**
 * Greatest serialized size of one page's schema payload.
 *
 * 128 KB, and the number is measured rather than felt. The whole closure of the worst page fits
 * under it in fifteen of the seventeen corpus documents; `stripe.yaml` at 1265 KB and
 * `kubernetes-apps-v1.json` at 293 KB do not, and those are exactly the two where an unbounded
 * payload would dominate the page. For scale, the navigation of a Stripe page is 427 KB on its
 * own, so this keeps the schemas from becoming the largest thing on a page they are only part
 * of.
 */
export const SCHEMA_PAYLOAD_LIMIT = 128 * 1024;

/** The schemas a page ships, and what it had to leave behind. */
export interface SchemaPayload {
  /** Bodies keyed by schema id, in the order they were reached. */
  readonly schemas: Readonly<Record<string, IRSchema>>;
  /** Ids referenced from something that shipped, and not themselves shipped. */
  readonly truncated: readonly string[];
  /** Serialized size of {@link SchemaPayload.schemas}, so a test can assert the bound holds. */
  readonly bytes: number;
}

/** Every schema id a body references, at any depth. */
function referencesIn(schema: IRJsonSchema): Set<string> {
  const found = new Set<string>();

  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;

    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    for (const [key, item] of Object.entries(value)) {
      if (key === '$ref' && typeof item === 'string') found.add(item);
      else visit(item);
    }
  };

  visit(schema);
  return found;
}

/**
 * The schema entry as it travels: no `raw`.
 *
 * `raw` is the untouched source of a schema in a dialect that is not JSON Schema, kept so a
 * renderer can show it. Nothing in the tree viewer reads it, and on a document that carries one
 * it is the largest field there is.
 */
function shipped(schema: IRSchema): IRSchema {
  return {
    id: schema.id,
    ...(schema.name === undefined ? {} : { name: schema.name }),
    dialect: schema.dialect,
    ...(schema.normalized === undefined ? {} : { normalized: schema.normalized }),
  };
}

/** The ids a use site starts from: the target it names, or the targets its inline body names. */
function seedsOf(slot: IRSchemaSlot): readonly string[] {
  if (slot.kind === 'named') return [slot.schemaId];
  const body = slot.schema.normalized;
  return body === undefined ? [] : [...referencesIn(body)];
}

/**
 * Builds the bounded schema closure of a set of use sites.
 *
 * Breadth first, so the payload fills with what is nearest to the page. The walk does not stop
 * at the first schema that does not fit: a large body early on would otherwise hide every small
 * one behind it, and the reader would lose the cheap ones for the sake of one expensive one.
 *
 * @param document - The normalized document
 * @param slots - Use sites on the page, in the order they are shown
 * @param limit - Greatest serialized size, defaults to {@link SCHEMA_PAYLOAD_LIMIT}
 * @returns The schemas to ship and the ids left behind
 *
 * @example
 * const payload = buildSchemaPayload(document, [{ kind: 'named', schemaId: 'Order' }]);
 * payload.truncated; // ids the viewer renders as links to their own pages
 */
export function buildSchemaPayload(
  document: IRDocument,
  slots: readonly IRSchemaSlot[],
  limit: number = SCHEMA_PAYLOAD_LIMIT,
): SchemaPayload {
  const schemas: Record<string, IRSchema> = {};
  const truncated = new Set<string>();
  const queued = new Set<string>();
  const queue: string[] = [];

  for (const slot of slots) {
    for (const id of seedsOf(slot)) {
      if (queued.has(id)) continue;
      queued.add(id);
      queue.push(id);
    }
  }

  let bytes = 2;

  // A plain index rather than an iterator, because the queue grows while it is being walked:
  // every schema that fits appends the ids it references.
  let at = 0;

  while (at < queue.length) {
    const id = queue[at] ?? '';
    at += 1;
    const entry = document.schemas.get(id);

    if (entry === undefined) {
      // The normalizer is fail closed and already refused a reference into nothing, so this is
      // reachable only for an id that is not a schema at all. Recording it keeps the viewer
      // honest: it shows a link rather than an empty expansion.
      truncated.add(id);
      continue;
    }

    const body = shipped(entry);
    const cost = JSON.stringify(body).length + id.length + 4;

    if (bytes + cost > limit) {
      truncated.add(id);
      continue;
    }

    schemas[id] = body;
    bytes += cost;

    for (const reference of referencesIn(entry.normalized ?? {})) {
      if (queued.has(reference)) continue;
      queued.add(reference);
      queue.push(reference);
    }
  }

  // An id that both fitted and was queued again cannot be truncated: the first branch is what
  // decides, and a later reference to it reaches a schema that is already here.
  for (const id of Object.keys(schemas)) truncated.delete(id);

  return { schemas, truncated: [...truncated].sort(), bytes };
}

/**
 * Rebuilds the map the schema expander takes.
 *
 * The payload travels as a plain object, because that is what JSON has, and the expander takes
 * a `Map`, because that is what the IR has. One place converts.
 *
 * @param payload - Schemas as they travel
 * @returns The map `expandSchemaNode` and `schemaTreeRoot` expect
 */
export function schemaMapOf(
  payload: Readonly<Record<string, IRSchema>>,
): ReadonlyMap<string, IRSchema> {
  return new Map(Object.entries(payload));
}

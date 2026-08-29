import { hash } from '@openref/core';
import type { IRSchema } from '@openref/core';
import { mapSchemaReferences } from './rewrite';

/**
 * Deciding when two services are describing one component, per SPEC 15.
 *
 * SPEC 15 SAYS "sha256 OF THE NORMALIZED SCHEMA", AND THE HONEST READING OF THAT IS NOT ONE HASH.
 * A named schema in the IR does not contain the schemas it uses; it points at them, because SPEC
 * 5.1.1 made references stay references. So `User` in two services can hash identically while one
 * of them means an `Address` the other does not have. Hashing the body alone would merge the two
 * and every reader of the second service would be shown the first service's model.
 *
 * SO THE SIGNATURE IS COMPUTED OVER THE CLOSURE, BY REFINEMENT. Round zero hashes each schema
 * with every reference blanked, which is the coarsest possible answer; each later round hashes it
 * again with each reference replaced by the previous round's signature of its target. The
 * partition only ever splits, so the rounds stop as soon as the number of distinct signatures
 * stops growing, and cycles fall out of it for free: a self referential pair reaches a fixed point
 * instead of recursing.
 *
 * THE NAME IS PART OF THE IDENTITY. Two structurally identical schemas called `Money` and `Price`
 * are two components, and collapsing them would delete a name a document uses. That also follows
 * the letter of SPEC 15, since what is stored and hashed is the whole `IRSchema` record, of which
 * the name is a field, with only the id blanked because the id is what the merge is deciding.
 */

/** One named schema, and which service's document it came from. */
export interface SchemaEntry {
  readonly serviceId: string;
  /** Id in that service's own document. */
  readonly schemaId: string;
  readonly schema: IRSchema;
}

/** Every schema that turned out to be the same component. */
export interface SchemaClass {
  /** Members, sorted by service id and then by source schema id. Never empty. */
  readonly members: readonly SchemaEntry[];
}

/** Stands for a reference target in round zero, before any target has a signature. */
const UNKNOWN_TARGET = '?';

/**
 * Groups schemas from several services into one class per distinct component.
 *
 * @param entries - Every named schema of every service, in a deterministic order
 * @returns One class per component, in the order its first member appears in `entries`
 */
export function classifySchemas(entries: readonly SchemaEntry[]): SchemaClass[] {
  if (entries.length === 0) return [];

  const index = indexEntries(entries);
  let signatures = entries.map((entry) => signatureOf(entry, () => UNKNOWN_TARGET));
  let distinct = new Set(signatures).size;

  while (distinct < entries.length) {
    const previous = signatures;
    const next = entries.map((entry) =>
      signatureOf(entry, (target) => {
        // A reference into a service's own schema map; a target that is not in it was already
        // broken in the source, and keeping the target's own text apart from a real signature is
        // what stops two differently broken schemas from reading as one.
        const found = index.get(entry.serviceId)?.get(target);
        if (found === undefined) return `${UNKNOWN_TARGET}${target}`;
        return previous[found] ?? UNKNOWN_TARGET;
      }),
    );

    const nextDistinct = new Set(next).size;
    signatures = next;
    if (nextDistinct === distinct) break;
    distinct = nextDistinct;
  }

  return groupBySignature(entries, signatures);
}

/**
 * Signature of one schema with every reference target replaced.
 *
 * A SCHEMA WHOSE `raw` CANNOT BE HASHED IS ITS OWN CLASS RATHER THAN AN ERROR. `raw` carries the
 * source of a dialect the pipeline does not normalize, and canonical serialization is fail closed
 * about values it cannot represent. Refusing the merge over one would be a heavy answer to a
 * question whose conservative one costs nothing: an unhashable schema is never deduplicated, which
 * loses no information at all, since deduplication is a saving rather than a fact.
 */
function signatureOf(entry: SchemaEntry, target: (id: string) => string): string {
  const { schema } = entry;
  const shape = {
    name: schema.name,
    dialect: schema.dialect,
    raw: schema.raw,
    normalized:
      schema.normalized === undefined ? undefined : mapSchemaReferences(schema.normalized, target),
  };

  try {
    return hash(shape);
  } catch {
    // The fallback is length prefixed rather than joined by a separator, because a separator is a
    // character an id can contain: `a` plus `b-c` and `a-b` plus `c` would otherwise be one class.
    return `!${String(entry.serviceId.length)}:${entry.serviceId}${entry.schemaId}`;
  }
}

/** Position of every entry, by service and then by source schema id. */
function indexEntries(entries: readonly SchemaEntry[]): Map<string, Map<string, number>> {
  const index = new Map<string, Map<string, number>>();

  for (const [position, entry] of entries.entries()) {
    let perService = index.get(entry.serviceId);
    if (perService === undefined) {
      perService = new Map<string, number>();
      index.set(entry.serviceId, perService);
    }
    perService.set(entry.schemaId, position);
  }

  return index;
}

/** Collects the entries that reached one signature, keeping first appearance order of the classes. */
function groupBySignature(
  entries: readonly SchemaEntry[],
  signatures: readonly string[],
): SchemaClass[] {
  const classes = new Map<string, SchemaEntry[]>();

  for (const [position, entry] of entries.entries()) {
    const signature = signatures[position] ?? '';
    const members = classes.get(signature);
    if (members === undefined) classes.set(signature, [entry]);
    else members.push(entry);
  }

  return [...classes.values()].map((members) => ({
    members: [...members].sort(
      (left, right) =>
        compare(left.serviceId, right.serviceId) || compare(left.schemaId, right.schemaId),
    ),
  }));
}

/** Code point comparison, the one the canonical form uses. */
function compare(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

import { sha256Hex } from '../../hashing/domain/sha256';
import type { IRJsonSchema } from '../../ir/domain/schema.types';
import { compareByCodePoint } from '../../hashing/domain/canonical';
import { parseReference, schemaNameFromReference } from './json-pointer';

/**
 * Where named schemas live, per SPEC 5.1.1.
 *
 * A named schema exists once. Every use site holds `{ $ref: id }` pointing here, rather than
 * a copy of the body. That is a model decision before it is a size one: federation
 * deduplicates by schema hash, the schema viewer shows a field as being of a named type, and
 * diff classifies a change to a named schema once. A copy has lost the name all three need.
 *
 * It also happens to be the only tractable shape. Expanding each `$ref` occurrence
 * independently grows combinatorially on a graph that is both deep and wide, which is why
 * `stripe.yaml` in the corpus could not be normalized at any depth before this existed.
 */

/** Pointer prefix under which a document keeps its named schemas. */
export const NAMED_SCHEMA_POINTER_PREFIX = '/components/schemas/';

/** The schema map being built, plus the bookkeeping that keeps ids deterministic. */
export interface SchemaRegistry {
  /**
   * The id a reference resolves to, or undefined when the target has no name and must be
   * expanded where it stands.
   */
  idFor(reference: string): string | undefined;
  /**
   * Normalizes the target of a named reference, once.
   *
   * Re-entrant by design: a schema that refers to itself, directly or through others, finds
   * its id already in production and stops, because a reference does not expand.
   */
  ensure(id: string, reference: string, produce: (reference: string) => IRJsonSchema): void;
  /** The registered body of an id, or undefined when it is absent or still being produced. */
  get(id: string): IRJsonSchema | undefined;
  /** Whether an id is currently being produced further up the stack. */
  isProducing(id: string): boolean;
  /** Everything registered, ordered by id, ready to become `document.schemas`. */
  entries(): Map<string, IRJsonSchema>;
}

/**
 * Decides the id a reference is filed under.
 *
 * Internal named schemas keep their own name. An external target always carries a suffix
 * derived from its document URI, unconditionally rather than only on collision: an id that
 * depended on which reference was seen first would make the whole document order dependent,
 * and the hash with it.
 *
 * @param reference - Reference exactly as the document wrote it
 * @returns The id, or undefined when the target is not a named schema
 *
 * @example
 * schemaIdForReference('#/components/schemas/Order');           // 'Order'
 * schemaIdForReference('common.yaml#/components/schemas/Order'); // 'Order__1b4f0e98'
 * schemaIdForReference('#/paths/~1orders/get');                  // undefined
 */
export function schemaIdForReference(reference: string): string | undefined {
  const parsed = parseReference(reference);
  const name = schemaNameFromReference(reference);

  if (parsed.external) {
    return `${name === '' ? 'schema' : name}__${sha256Hex(parsed.uri).slice(0, 8)}`;
  }

  if (!parsed.pointer.startsWith(NAMED_SCHEMA_POINTER_PREFIX)) return undefined;

  const rest = parsed.pointer.slice(NAMED_SCHEMA_POINTER_PREFIX.length);
  if (rest === '' || rest.includes('/')) return undefined;

  return name;
}

/**
 * Creates an empty registry.
 *
 * @returns A registry that collects named schemas as normalization walks the document
 */
export function createSchemaRegistry(): SchemaRegistry {
  const bodies = new Map<string, IRJsonSchema>();
  const producing = new Set<string>();

  return {
    idFor: schemaIdForReference,

    ensure(id, reference, produce): void {
      if (bodies.has(id) || producing.has(id)) return;

      producing.add(id);
      try {
        bodies.set(id, produce(reference));
      } finally {
        producing.delete(id);
      }
    },

    get(id): IRJsonSchema | undefined {
      return bodies.get(id);
    },

    isProducing(id): boolean {
      return producing.has(id);
    },

    entries(): Map<string, IRJsonSchema> {
      return new Map(
        [...bodies.entries()].sort(([left], [right]) => compareByCodePoint(left, right)),
      );
    },
  };
}

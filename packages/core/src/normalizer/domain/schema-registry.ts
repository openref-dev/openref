import { sha256Hex } from '../../hashing/domain/sha256';
import type { IRJsonSchema } from '../../ir/domain/schema.types';
import { compareByCodePoint } from '../../hashing/domain/canonical';
import { ErrorCode, NormalizeError } from '../../shared/errors/index';
import { parseJsonPointer, parseReference, schemaNameFromReference } from './json-pointer';

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
   * Accepts the target of a named reference for normalization, once.
   *
   * THE BODY IS NOT PRODUCED HERE. It is queued, and {@link drain} makes it later, at the
   * depth the document was entered at. Producing it in place made a chain of named references
   * cost stack in proportion to its length, which is the one shape that reached the engine's
   * own limit before any declared one could: a chain of about 900 links exhausted the stack on
   * the machine this was measured on, while nothing about the chain nests. Queuing makes the
   * chain cost constant stack, so the declared limits bound expansion, which is the only thing
   * that genuinely nests.
   *
   * Re-entrant by design: a schema that refers to itself, directly or through others, finds
   * its id already known and stops, because a reference does not expand.
   *
   * @throws {NormalizeError} When a second, different reference claims an id that is already
   *         held, which would silently drop one of the two bodies
   */
  ensure(id: string, reference: string, produce: (reference: string) => IRJsonSchema): void;
  /** The registered body of an id, or undefined when it is absent or still being produced. */
  get(id: string): IRJsonSchema | undefined;
  /**
   * The registered body of an id, producing it now if it is only queued.
   *
   * For the one caller that cannot wait: merging an `allOf` branch needs the target, per the
   * decision in SPEC 5.1.1, because `required` and `properties` cannot be combined without it.
   */
  force(id: string): IRJsonSchema | undefined;
  /** Whether an id is currently being produced further up the stack. */
  isProducing(id: string): boolean;
  /**
   * Produces every queued body, including those the productions themselves queue.
   *
   * Called before the normalizer returns, so that a broken reference inside a named schema is
   * still found. Deferring production without draining would make the normalizer fail open.
   */
  drain(): void;
  /**
   * Everything registered, ordered by id, ready to become `document.schemas`.
   *
   * Drains first, so that a registry read before its queue was emptied cannot report a
   * document as having fewer schemas than it has.
   */
  entries(): Map<string, IRJsonSchema>;
}

/**
 * Character reserved to mark which id space an id belongs to, per SPEC 5.1.1.
 *
 * Unreserved in RFC 3986, so it survives a URL untouched, and legal in a filename on every
 * target platform, which the static build of T039 will need.
 */
const SPACE_MARK = '~';

/** What an external id carries between its marker and the human part of the name. */
const EXTERNAL_PREFIX = `${SPACE_MARK}x`;

/**
 * Escapes the human part of a name so that it cannot start with the external marker.
 *
 * Doubling the reserved character is the whole mechanism: an escaped name begins with
 * `~` only when the original did, and then its second character is `~` as well. So an
 * escaped name never begins with `~x`, and every external id does.
 */
function escapeName(name: string): string {
  return name.split(SPACE_MARK).join(`${SPACE_MARK}${SPACE_MARK}`);
}

/**
 * The human part of a schema id, per SPEC 5.1.1.
 *
 * The hash of an external target is an identity mechanism and not a display string, so this is
 * what a reader is shown. Exported from `core` so that the renderer, the schema viewer and the
 * static build read one implementation rather than three regular expressions.
 *
 * @param id - Key into `IRDocument.schemas`
 * @returns The name the document gave the schema
 *
 * @example
 * schemaNameFromId('Order');              // 'Order'
 * schemaNameFromId('~x20b4b690~Order');   // 'Order'
 * schemaNameFromId('~~odd');              // '~odd'
 */
export function schemaNameFromId(id: string): string {
  const external = id.startsWith(EXTERNAL_PREFIX);
  const escaped = external ? id.slice(id.indexOf(SPACE_MARK, EXTERNAL_PREFIX.length) + 1) : id;
  return escaped.split(`${SPACE_MARK}${SPACE_MARK}`).join(SPACE_MARK);
}

/**
 * Decides the id a reference is filed under, per SPEC 5.1.1.
 *
 * THE TWO ID SPACES CANNOT MEET, AND THAT IS A PROPERTY OF THE CONSTRUCTION RATHER THAN OF A
 * CONVENTION. The previous scheme filed an external target as `Name__<8 hex>` and an internal
 * one under its bare name, both in the same space of strings, so a document that called its own
 * schema `Order__20b4b690` claimed the id `common.yaml#/components/schemas/Order` resolves to.
 * The registry dropped the second body in silence, and which body survived depended on which
 * reference the walk reached first, so ONE DOCUMENT PRODUCED TWO GRAPHS AND TWO HASHES from
 * nothing but the order of two properties. Found by T016 as F1, live since T002.
 *
 * A conditional suffix was rejected for the reason it always was: an id that depends on which
 * other documents happen to be loaded is order dependent again. Banning names that look like an
 * external id was rejected too, because it makes documents invalid that break no rule.
 *
 * The name is normalized to NFC first, per F5 of the same pass. `Café` written NFC and written
 * NFD are different strings that no browser tells apart, so filing them as two entries produces
 * two registry entries, two deep links and, from T039, two filenames that a reader cannot
 * distinguish. After normalization they claim one id, and the registry refuses the collision
 * rather than losing a body to it.
 *
 * @param reference - Reference exactly as the document wrote it
 * @returns The id, or undefined when the target is not a named schema
 *
 * @example
 * schemaIdForReference('#/components/schemas/Order');            // 'Order'
 * schemaIdForReference('common.yaml#/components/schemas/Order'); // '~x1b4f0e98~Order'
 * schemaIdForReference('#/paths/~1orders/get');                  // undefined
 */
export function schemaIdForReference(reference: string): string | undefined {
  const parsed = parseReference(reference);
  const name = schemaNameFromReference(reference).normalize('NFC');

  if (parsed.external) {
    const digest = sha256Hex(parsed.uri.normalize('NFC')).slice(0, 8);
    return `${EXTERNAL_PREFIX}${digest}${SPACE_MARK}${escapeName(name === '' ? 'schema' : name)}`;
  }

  if (!parsed.pointer.startsWith(NAMED_SCHEMA_POINTER_PREFIX)) return undefined;

  const rest = parsed.pointer.slice(NAMED_SCHEMA_POINTER_PREFIX.length);
  if (rest === '' || rest.includes('/')) return undefined;

  return escapeName(name);
}

/**
 * The target a reference names, as a string two references share exactly when they agree.
 *
 * Compared instead of the reference text so that percent encoding does not read as a second
 * target: `#/components/schemas/Order` and `#/components/schemas/Or%64er` are one target and
 * must not be reported as a collision.
 *
 * DELIBERATELY NOT NORMALIZED TO NFC, WHICH IS THE OPPOSITE OF WHAT THE ID DOES. `Café` written
 * NFC and written NFD are two different keys of `components.schemas` and therefore two
 * different targets with two different bodies. The id has to merge them, because no reader can
 * tell them apart. Identity has to keep them apart, because that merge is the collision worth
 * reporting. Normalizing here as well would make F5 pass silently under F1's mechanism.
 */
function referenceIdentity(reference: string): string {
  const parsed = parseReference(reference);
  const segments = parseJsonPointer(parsed.pointer)
    // Length prefixed rather than joined by a separator, so that a segment containing the
    // separator cannot fake a different split. `JSON.stringify` is not used anywhere `core`
    // can reach from hashing, and this module is one hop from it.
    .map((segment) => `${String(segment.length)}:${segment}`)
    .join('');
  return `${parsed.uri}#${segments}`;
}

/**
 * Creates an empty registry.
 *
 * @returns A registry that collects named schemas as normalization walks the document
 */
export function createSchemaRegistry(): SchemaRegistry {
  const bodies = new Map<string, IRJsonSchema>();
  const producing = new Set<string>();
  const claimedBy = new Map<string, string>();
  /** Ids accepted but not yet made, in the order they were first reached. */
  const queued = new Map<string, () => IRJsonSchema>();

  function drainAll(): void {
    // A production queues more work, so the queue is re-read rather than snapshotted. The
    // order bodies are made in changes nothing observable: each is filed under an id that does
    // not depend on when it was made, and `entries` sorts.
    for (;;) {
      const next = queued.keys().next();
      if (next.done === true) return;
      make(next.value);
    }
  }

  function make(id: string): IRJsonSchema | undefined {
    const produce = queued.get(id);
    if (produce === undefined) return bodies.get(id);

    queued.delete(id);
    producing.add(id);
    try {
      const body = produce();
      bodies.set(id, body);
      return body;
    } finally {
      producing.delete(id);
    }
  }

  return {
    idFor: schemaIdForReference,

    ensure(id, reference, produce): void {
      // A COLLISION IS AN ERROR HERE, BECAUSE SILENCE HERE ONCE COST A HASH.
      //
      // Internal and external ids can no longer meet: `schemaIdForReference` puts them in
      // spaces that cannot intersect. Two references can still arrive at one id inside a
      // single space, and the two ways are known: two pointers into the same external
      // document that differ only in where the target sits, and two names that agree after
      // NFC. The early return below used to read both as the re-entrant case and drop the
      // second body without a word, so every use site of the loser rendered the winner.
      //
      // Identity is compared on the parsed reference, not on its text, so that
      // `#/components/schemas/Or%64er` is recognised as the same target as
      // `#/components/schemas/Order` rather than reported as a collision with it. The text is
      // compared first because it settles the overwhelmingly common case without parsing.
      //
      // The two references are sorted into the message rather than reported as first and
      // second: an error that named them in walk order would describe one defect two ways and
      // reintroduce the order dependence one level up, in the text.
      const claim = claimedBy.get(id);
      if (claim !== undefined && claim !== reference) {
        if (referenceIdentity(claim) !== referenceIdentity(reference)) {
          const sorted = [claim, reference].sort(compareByCodePoint);
          const left = sorted[0] ?? claim;
          const right = sorted[1] ?? reference;
          throw new NormalizeError(
            `${left} and ${right} are different targets and are both filed under the schema id ${id}, so one of the two would be lost`,
            ErrorCode.NORM_SCHEMA_ID_COLLISION,
            undefined,
            { id, references: [left, right] },
          );
        }
      }

      if (bodies.has(id) || producing.has(id) || queued.has(id)) return;

      claimedBy.set(id, reference);
      queued.set(id, () => produce(reference));
    },

    get(id): IRJsonSchema | undefined {
      return bodies.get(id);
    },

    force(id): IRJsonSchema | undefined {
      return make(id);
    },

    isProducing(id): boolean {
      return producing.has(id);
    },

    drain: drainAll,

    entries(): Map<string, IRJsonSchema> {
      drainAll();
      return new Map(
        [...bodies.entries()].sort(([left], [right]) => compareByCodePoint(left, right)),
      );
    },
  };
}

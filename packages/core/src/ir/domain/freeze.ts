import type { IRDocument } from './document.types';

/**
 * Making a finished document unwritable, per SPEC 5.1 and the boundary rule of STANDARDS.
 *
 * WHY THIS EXISTS AT ALL. `readonly` in a type is a statement the compiler checks and nobody
 * else does. The document reaches two kinds of code this project does not own: a theme, which
 * receives `IRDocument` and `IRNodeRuntime` through slot props, and a collector, whose own
 * returned objects are carried into the document by reference. Either one can write to what it
 * was handed, and the write lands on the object the other pages of the same document render
 * from. The hash does not move, because it was taken over the value the edit came after, so
 * what is left is a hash that is correct for content it no longer describes. That is the one
 * failure a cache keyed by hash cannot see.
 *
 * THE INVARIANT IS TIED TO THE HASH RATHER THAN REMEMBERED. A document carrying a hash is
 * frozen, because the hash is a claim about content, and the claim stops being true the moment
 * the content can still change. `finalizeDocument` is where the two happen together, so there
 * is one place to get it right rather than a rule every producer has to recall.
 *
 * THE COST IS ONE WALK, AND IT IS SPENT WHERE A WALK IS ALREADY HAPPENING. SPEC 6.2 refused a
 * deep copy of every collector fact, and the reason was cost against a threat from code already
 * running with full rights. A freeze is not a copy: it allocates nothing, and it runs once per
 * document beside the canonical serialization the hash already walks the whole document to
 * build. So the trade that ruled out copying does not rule this out, and both open boundaries
 * close on one mechanism.
 *
 * WHAT IT DOES NOT CLAIM. It does not protect a value a producer keeps mutating before the
 * document is finalized, which is ordinary construction and correct. It does not reach through
 * a getter, and the IR has none. A `Map` needs more than `Object.freeze`, which is why the
 * mutators are replaced below: map contents live in internal slots that freezing does not
 * touch, so freezing a `Map` alone would read as protection and be none.
 */

/** Objects already visited, so a shared sub-object is frozen once and a cycle terminates. */
type Seen = WeakSet<object>;

/**
 * Refuses a mutation of a frozen collection.
 *
 * A `TypeError` rather than an `OpenRefError`, deliberately: this is the same refusal the
 * language gives for a write to a frozen property, and a caller catching one should catch
 * both. The message names the method rather than the value, because the value is a document
 * fragment whose printed form would be enormous.
 */
function refuseMutation(kind: string, method: string): never {
  throw new TypeError(
    `${kind}.${method} was called on a finalized IR document, which is frozen; ` +
      `build a new value instead of writing to the one that was handed over`,
  );
}

/**
 * Replaces the mutators of a collection with refusals, then freezes the collection object.
 *
 * SEALING TWICE IS ORDINARY AND MUST NOT THROW. The runtime pass builds its document by
 * spreading the normalized one, so `schemas` and `webhooks` are the same `Map` objects reaching
 * a second `finalizeDocument`. The refusal is installed as an own non-configurable property and
 * a `Map` has no own `set`, so the presence of one is proof this collection has been here
 * before. Re-freezing a plain object is already a no-op; this is the same for a collection.
 */
function sealCollection(value: object, kind: string, methods: readonly string[]): void {
  for (const method of methods) {
    if (Object.hasOwn(value, method)) continue;
    Object.defineProperty(value, method, {
      value: () => refuseMutation(kind, method),
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }
}

/**
 * Freezes a value and everything reachable from it.
 *
 * @param value - Value to freeze, of any shape the IR admits
 * @param seen - Objects already frozen on this walk
 */
function freezeDeep(value: unknown, seen: Seen): void {
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (value instanceof Map) {
    for (const [key, entry] of value) {
      freezeDeep(key, seen);
      freezeDeep(entry, seen);
    }
    sealCollection(value, 'Map', ['set', 'delete', 'clear']);
    Object.freeze(value);
    return;
  }

  if (value instanceof Set) {
    for (const entry of value) freezeDeep(entry, seen);
    sealCollection(value, 'Set', ['add', 'delete', 'clear']);
    Object.freeze(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) freezeDeep(entry, seen);
    Object.freeze(value);
    return;
  }

  for (const entry of Object.values(value)) freezeDeep(entry, seen);
  Object.freeze(value);
}

/**
 * Freezes a document and everything it holds.
 *
 * @param document - Document to freeze, returned as the same object
 * @returns The document, now unwritable at every depth
 *
 * @example
 * const frozen = freezeDocument(document);
 * frozen.nodes.set('x', node); // throws TypeError
 */
export function freezeDocument(document: IRDocument): IRDocument {
  freezeDeep(document, new WeakSet());
  return document;
}

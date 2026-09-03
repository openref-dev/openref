import { ErrorCode } from '../../shared/errors/codes';
import { NormalizeError } from '../../shared/errors/index';
import { canonicalVerdictOf } from './canonical-order';

/**
 * Canonical serialization, per SPEC 5.3.
 *
 * `JSON.stringify` is unusable as a hashing input for two reasons, and both are closed here:
 *
 * 1. Object key order is not guaranteed once a document is merged from several sources.
 * 2. Integer like keys are iterated in numeric order rather than insertion order. HTTP status
 *    codes are exactly such keys, so `{"200":..., "404":..., "default":...}` enumerates the
 *    same way no matter how it was written, and any restructuring silently changes the output.
 *
 * The canonical form is: keys sorted by code point, one normalized representation per number,
 * `Map` written as a sorted array of pairs, `undefined` omitted rather than turned into `null`.
 *
 * ONE EXCEPTION, AND IT IS THE ONLY ONE: a map whose key order the document wrote is written in
 * that order. `canonical-order.ts` carries the total record of which maps those are, along with
 * the principle that decides one it has not met. Without it the hash was not a function of
 * everything a page is drawn from: a thousand shuffled spellings of one document gave one hash,
 * one `llms.txt` and two different `llms-full.txt`.
 *
 * HOW THE SERIALIZER KNOWS, AND THE THREE STATES IT WALKS IN. The member name is the only thing
 * visible while walking a value. In `ir` the keys are this IR's and they sort, and each one is
 * looked up in the record. In `authored-keys` the keys are the document's and keep their order,
 * while the values are shapes this IR declares and go back to `ir`: an author who names a property
 * `properties` gets a schema written by the ordinary rule, which is what it is. In `authored-tree`
 * nothing below is this IR's, so every level keeps its order and the record is never consulted
 * again, which is what a vendor extension, a protocol binding and a raw path schema are.
 *
 * `JSON.stringify` is not called here or anywhere else reachable from the hashing path, which
 * `hashing-purity.spec.ts` checks on the module graph.
 */

/** Characters with a short escape in JSON string syntax. */
const SHORT_ESCAPES: Readonly<Record<number, string>> = {
  0x08: '\\b',
  0x09: '\\t',
  0x0a: '\\n',
  0x0c: '\\f',
  0x0d: '\\r',
  0x22: '\\"',
  0x5c: '\\\\',
};

/**
 * How deep a value may nest before canonical serialization refuses it, per SPEC 5.3.
 *
 * DECLARED, NOT INHERITED FROM THE CALL STACK. Before T016 there was no limit here at all, so
 * the effective one was whatever the engine's stack allowed, which was measured at about 4000
 * levels of plain object nesting on the development machine and is not a number any two
 * machines agree on. The normalizer gave out later than that, at roughly 2300 levels of schema
 * nesting, which is deeper again once each level is written out. So there was a band of
 * documents that NORMALIZED AND THEN COULD NOT BE HASHED, taking out the SSR cache key and the
 * whole render path, and the failure arrived as a bare `RangeError`: fail closed by accident
 * rather than by design. Found as F2.
 *
 * The number sits above what the normalizer can produce and well below what the stack allows.
 * A schema nested to the normalizer's own limit, `DEFAULT_MAX_SCHEMA_NESTING` of 256, writes
 * out as about twice that many levels, plus the fixed depth of the IR wrappers around it. The
 * rest is headroom. The two constants are checked against each other by a test rather than
 * kept in step by hand, because `core` may not import the normalizer from the hashing path.
 */
export const CANONICAL_MAX_DEPTH = 1024;

function notSerializable(what: string, path: string): NormalizeError {
  return new NormalizeError(
    `${what} has no deterministic canonical representation at ${path}`,
    ErrorCode.NORM_VALUE_NOT_SERIALIZABLE,
    undefined,
    { path },
  );
}

/**
 * Compares two strings by Unicode code point.
 *
 * The default comparison orders by UTF-16 code unit, which puts characters above the basic
 * multilingual plane before some characters below it. Key order has to be stable across
 * platforms and across property names that contain astral characters.
 *
 * @param left - First string
 * @param right - Second string
 * @returns Negative, zero or positive, in the manner of a sort comparator
 */
export function compareByCodePoint(left: string, right: string): number {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const shared = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < shared; index += 1) {
    const leftPoint = leftPoints[index]?.codePointAt(0) ?? 0;
    const rightPoint = rightPoints[index]?.codePointAt(0) ?? 0;
    if (leftPoint !== rightPoint) return leftPoint - rightPoint;
  }

  return leftPoints.length - rightPoints.length;
}

/**
 * Normalizes a number to one stable decimal representation.
 *
 * `-0` becomes `0`, and any two literals that denote the same double produce the same text,
 * so `1e3` and `1000` are indistinguishable once serialized. A non finite number has no
 * representation and is rejected rather than written as `null`.
 *
 * @param value - Number to normalize
 * @param path - Location in the value being serialized, for the error message
 * @returns Decimal text
 * @throws {NormalizeError} When the number is `NaN` or infinite
 */
export function normalizeNumber(value: number, path = '$'): string {
  if (!Number.isFinite(value)) {
    throw notSerializable(`the non finite number ${String(value)}`, path);
  }
  if (Object.is(value, -0)) return '0';
  return String(value);
}

/**
 * Quotes a string using JSON string syntax.
 *
 * Written out rather than delegating to `JSON.stringify` so that the hashing path has no
 * dependency on it at all. A lone surrogate is escaped, which keeps the output well formed
 * UTF-8 once encoded.
 *
 * @param text - String to quote
 * @returns Quoted, escaped string including the surrounding quotes
 */
export function quoteString(text: string): string {
  let quoted = '"';

  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const shortEscape = SHORT_ESCAPES[code];

    if (shortEscape !== undefined) {
      quoted += shortEscape;
    } else if (code < 0x20) {
      quoted += `\\u${code.toString(16).padStart(4, '0')}`;
    } else if (character.length === 1 && code >= 0xd800 && code <= 0xdfff) {
      quoted += `\\u${code.toString(16).padStart(4, '0')}`;
    } else {
      quoted += character;
    }
  }

  return `${quoted}"`;
}

function tooDeep(path: string, depth: number): NormalizeError {
  return new NormalizeError(
    `a value nests deeper than the canonical limit of ${String(CANONICAL_MAX_DEPTH)} at ${path}`,
    ErrorCode.NORM_DEPTH_EXCEEDED,
    undefined,
    { path, depth, limit: CANONICAL_MAX_DEPTH },
  );
}

/**
 * Whose keys the object at this position carries, per SPEC 5.3.
 *
 * `ir` sorts and consults the record; `authored-keys` keeps this level's order and returns to `ir`
 * below it; `authored-tree` keeps every level's order and never consults the record again.
 */
type KeySpace = 'ir' | 'authored-keys' | 'authored-tree';

/** Where a value sits when it is reached as a member of an object in the given key space. */
function spaceOfMember(space: KeySpace, key: string): KeySpace {
  if (space === 'authored-tree') return 'authored-tree';
  if (space === 'authored-keys') return 'ir';
  const verdict = canonicalVerdictOf(key);
  if (verdict === 'ordered-tree') return 'authored-tree';
  return verdict === 'ordered' ? 'authored-keys' : 'ir';
}

/** Where a value sits when it is reached as an element or an entry rather than as a member. */
function spaceBelow(space: KeySpace): KeySpace {
  return space === 'authored-tree' ? 'authored-tree' : 'ir';
}

function serialize(
  value: unknown,
  seen: Set<object>,
  path: string,
  depth: number,
  space: KeySpace,
): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return normalizeNumber(value, path);
    case 'string':
      return quoteString(value);
    case 'bigint':
      throw notSerializable('a bigint', path);
    case 'function':
      throw notSerializable('a function', path);
    case 'symbol':
      throw notSerializable('a symbol', path);
    case 'undefined':
      throw notSerializable('undefined', path);
    default:
      break;
  }

  const container: object = value;
  if (seen.has(container)) {
    throw notSerializable('a circular reference', path);
  }
  // Checked at the container rather than at every value, because only a container recurses.
  if (depth >= CANONICAL_MAX_DEPTH) {
    throw tooDeep(path, depth);
  }
  seen.add(container);

  try {
    if (container instanceof Date) {
      return quoteString(container.toISOString());
    }

    if (container instanceof Map) {
      return serializeMap(container, seen, path, depth, space);
    }

    if (container instanceof Set) {
      throw notSerializable('a Set', path);
    }

    if (Array.isArray(container)) {
      const source = container as readonly unknown[];
      const items: string[] = [];

      // Indexed rather than `map`, which skips holes instead of visiting them. A sparse array
      // would otherwise reach `join` as a hole and render as nothing at all, producing
      // `[1,,2]`, which is valid JavaScript and not valid JSON.
      for (let index = 0; index < source.length; index += 1) {
        if (!(index in source)) {
          throw notSerializable('a hole in an array', `${path}[${String(index)}]`);
        }

        const item = source[index];
        if (item === undefined) {
          throw notSerializable('undefined inside an array', `${path}[${String(index)}]`);
        }

        // An array element is a value of the array's own member, never a key bearing position of
        // its own, so it inherits the tree it sits in rather than the exception above it.
        items.push(
          serialize(item, seen, `${path}[${String(index)}]`, depth + 1, spaceBelow(space)),
        );
      }

      return `[${items.join(',')}]`;
    }

    return serializeObject(container as Record<string, unknown>, seen, path, depth, space);
  } finally {
    seen.delete(container);
  }
}

function serializeMap(
  source: Map<unknown, unknown>,
  seen: Set<object>,
  path: string,
  depth: number,
  space: KeySpace,
): string {
  const pairs: { readonly key: string; readonly entry: string }[] = [];
  const below = spaceBelow(space);

  for (const [key, mapValue] of source) {
    if (mapValue === undefined) continue;

    const canonicalKey = serialize(key, seen, `${path}.<key>`, depth + 1, 'ir');
    const canonicalValue = serialize(mapValue, seen, `${path}[${canonicalKey}]`, depth + 1, below);
    pairs.push({ key: canonicalKey, entry: `[${canonicalKey},${canonicalValue}]` });
  }

  if (space === 'ir') pairs.sort((left, right) => compareByCodePoint(left.key, right.key));
  return `[${pairs.map((pair) => pair.entry).join(',')}]`;
}

/**
 * Serializes a plain object, either by the rule or by the exception.
 *
 * `space` says whose keys these are, per SPEC 5.3. In `ir` they are this IR's and they sort; in
 * either authored space they are the document's and keep their order, and the record is consulted
 * only from `ir`, because that is the only space whose keys are IR member names.
 */
function serializeObject(
  source: Record<string, unknown>,
  seen: Set<object>,
  path: string,
  depth: number,
  space: KeySpace,
): string {
  const own = Object.keys(source);
  const keys = space === 'ir' ? [...own].sort(compareByCodePoint) : own;
  const members: string[] = [];

  for (const key of keys) {
    const member = source[key];
    if (member === undefined) continue;
    const below = spaceOfMember(space, key);
    members.push(
      `${quoteString(key)}:${serialize(member, seen, `${path}.${key}`, depth + 1, below)}`,
    );
  }

  return `{${members.join(',')}}`;
}

/**
 * Serializes a value to its canonical form.
 *
 * A VALUE HANDED IN WITH NO POSITION IS SERIALIZED AS IF ITS KEYS WERE THIS IR'S, which is right
 * for a whole document and wrong for a fragment lifted out of an authored position. The member name
 * is what the exception is keyed by, and a caller that hands over `schema.raw` on its own has taken
 * that name away. `at` gives it back, so one value has one canonical form wherever it is hashed.
 *
 * @param value - Any IR value, or any part of one
 * @param at - Member name the value stands for, when it was lifted out of one
 * @returns Canonical text, suitable as hashing input
 * @throws {NormalizeError} When the value contains something with no deterministic
 *         representation: a non finite number, a bigint, a function, a symbol, a `Set`,
 *         `undefined` inside an array, or a circular reference; and when it nests deeper than
 *         {@link CANONICAL_MAX_DEPTH}
 *
 * @example
 * canonicalize({ b: 1, a: 2 }); // '{"a":2,"b":1}'
 * canonicalize({ properties: { b: 1, a: 2 } }); // '{"properties":{"b":1,"a":2}}'
 * canonicalize({ b: 1, a: 2 }, 'raw'); // '{"b":1,"a":2}'
 */
export function canonicalize(value: unknown, at?: string): string {
  return serialize(
    value,
    new Set<object>(),
    '$',
    0,
    at === undefined ? 'ir' : spaceOfMember('ir', at),
  );
}

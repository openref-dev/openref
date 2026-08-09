import { ErrorCode, NormalizeError } from '../../shared/errors/index';

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

function serialize(value: unknown, seen: Set<object>, path: string): string {
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
  seen.add(container);

  try {
    if (container instanceof Date) {
      return quoteString(container.toISOString());
    }

    if (container instanceof Map) {
      return serializeMap(container, seen, path);
    }

    if (container instanceof Set) {
      throw notSerializable('a Set', path);
    }

    if (Array.isArray(container)) {
      const items = (container as readonly unknown[]).map((item, index) => {
        if (item === undefined) {
          throw notSerializable('undefined inside an array', `${path}[${String(index)}]`);
        }
        return serialize(item, seen, `${path}[${String(index)}]`);
      });
      return `[${items.join(',')}]`;
    }

    return serializeObject(container as Record<string, unknown>, seen, path);
  } finally {
    seen.delete(container);
  }
}

function serializeMap(source: Map<unknown, unknown>, seen: Set<object>, path: string): string {
  const pairs: { readonly key: string; readonly entry: string }[] = [];

  for (const [key, mapValue] of source) {
    if (mapValue === undefined) continue;

    const canonicalKey = serialize(key, seen, `${path}.<key>`);
    const canonicalValue = serialize(mapValue, seen, `${path}[${canonicalKey}]`);
    pairs.push({ key: canonicalKey, entry: `[${canonicalKey},${canonicalValue}]` });
  }

  pairs.sort((left, right) => compareByCodePoint(left.key, right.key));
  return `[${pairs.map((pair) => pair.entry).join(',')}]`;
}

function serializeObject(source: Record<string, unknown>, seen: Set<object>, path: string): string {
  const keys = Object.keys(source).sort(compareByCodePoint);
  const members: string[] = [];

  for (const key of keys) {
    const member = source[key];
    if (member === undefined) continue;
    members.push(`${quoteString(key)}:${serialize(member, seen, `${path}.${key}`)}`);
  }

  return `{${members.join(',')}}`;
}

/**
 * Serializes a value to its canonical form.
 *
 * @param value - Any IR value, or any part of one
 * @returns Canonical text, suitable as hashing input
 * @throws {NormalizeError} When the value contains something with no deterministic
 *         representation: a non finite number, a bigint, a function, a symbol, a `Set`,
 *         `undefined` inside an array, or a circular reference
 *
 * @example
 * canonicalize({ b: 1, a: 2 }); // '{"a":2,"b":1}'
 */
export function canonicalize(value: unknown): string {
  return serialize(value, new Set<object>(), '$');
}

/**
 * Reading a framework request without trusting its shape.
 *
 * The objects an adapter hands over are typed `any` by both frameworks, so narrowing them by
 * assertion would be trusting a claim nobody made. These are guards: anything that is not a
 * string keyed record of strings reads as empty, and a route whose parameter is missing then
 * answers 404 rather than rendering whatever `undefined` stringifies to.
 */

/**
 * Reads a record of strings off an unknown object property.
 *
 * A value that is not a string is dropped rather than coerced. Express gives arrays for a
 * repeated query key and Fastify gives objects for a nested one, and neither is something a
 * documentation route has any use for.
 *
 * @param source - The framework object
 * @param key - Property holding the record, such as `params` or `headers`
 * @returns The string valued entries, lower cased keys left as they came
 */
export function readStringRecord(source: unknown, key: string): Record<string, string> {
  const record: Record<string, string> = {};

  if (typeof source !== 'object' || source === null) return record;
  const holder = (source as Record<string, unknown>)[key];
  if (typeof holder !== 'object' || holder === null) return record;

  for (const [name, value] of Object.entries(holder)) {
    if (typeof value === 'string') record[name] = value;
  }

  return record;
}

/**
 * Reads a nested string off an unknown object, by a path of property names.
 *
 * Used for the places a helmet integration leaves a nonce: `res.locals.cspNonce` on Express
 * and `reply.cspNonce.script` on Fastify. Neither is guaranteed to be there, which is the
 * point of reading it this way.
 *
 * @param source - The framework object
 * @param path - Property names to follow
 * @returns The string, or undefined when any step is missing or is not a string
 */
export function readNestedString(source: unknown, path: readonly string[]): string | undefined {
  let current: unknown = source;

  for (const step of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[step];
  }

  return typeof current === 'string' ? current : undefined;
}

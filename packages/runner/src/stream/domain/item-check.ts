/**
 * What "validated against `itemSchema`" means here, and what it deliberately does not mean.
 *
 * THE LIMITS ARE THE FEATURE. A full JSON Schema validator is kilobytes of the chunk a reader
 * downloads by pressing Send, for a check whose whole job is to say "the server is not sending
 * what the document promises". What that sentence needs is the type, the required properties,
 * the enumerated values and the type of each declared property; what it does not need is
 * `pattern`, numeric bounds, and the combinators. So this checks the first list, and SPEC 14.6
 * writes down that it checks the first list, because a check whose limits are only in its code
 * is read as a check with no limits.
 *
 * AND IT NEVER SAYS AN ELEMENT IS FINE WHEN IT COULD NOT TELL. An element that does not parse
 * as JSON is a problem, an element that fails one of the checks above is a problem, and an
 * element that passes them is reported as passing them rather than as valid. The distinction
 * matters at the one moment this exists for: a reader looking at a stream that is wrong.
 */

/** The subset of a schema this check reads. Restated rather than imported, per SPEC 14.6. */
export interface StreamItemSchema {
  readonly type?: string | readonly string[];
  readonly required?: readonly string[];
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly properties?: Readonly<Record<string, StreamItemSchema>>;
}

/**
 * The JSON type of a value, as a schema names it.
 *
 * `integer` IS A TYPE HERE AND NOT A FORMAT, because JSON Schema treats it as one, and a stream
 * of counters declared `integer` that starts sending `1.5` is exactly the drift worth catching.
 *
 * @param value - Any parsed JSON value
 * @returns The type name
 */
function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'object') return 'object';

  return typeof value;
}

/**
 * Whether a value satisfies a declared type, which may be one name or several.
 *
 * @param value - The parsed value
 * @param declared - What the schema declares
 * @returns True when it matches, or when the schema declares no type at all
 */
function matchesType(value: unknown, declared: string | readonly string[] | undefined): boolean {
  if (declared === undefined) return true;

  const actual = typeOf(value);
  const names = typeof declared === 'string' ? [declared] : declared;

  // An integer satisfies `number`, and the reverse is the case this exists to catch.
  return names.some((name) => name === actual || (name === 'number' && actual === 'integer'));
}

/**
 * Compares two JSON values for the purposes of `enum` and `const`.
 *
 * BY CANONICAL TEXT RATHER THAN BY REFERENCE, because an enum of objects is legal and comparing
 * those by identity would mark every element of such a stream invalid. Key order is not sorted:
 * these values come from one document, and this is a comparison rather than a hash.
 *
 * @param a - One value
 * @param b - The other
 * @returns True when they are the same JSON value
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' && typeof b !== 'object') return false;

  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Checks one element of a stream against the schema the document declares for it.
 *
 * @param data - The element as it came off the wire
 * @param schema - The item schema, or undefined when the document declares none
 * @returns One sentence saying what is wrong, or null when nothing this checks is
 *
 * @example
 * const problem = checkStreamItem('{"id":1}', { type: 'object', required: ['id'] });
 */
export function checkStreamItem(data: string, schema?: StreamItemSchema): string | null {
  if (schema === undefined) return null;

  let value: unknown;
  try {
    value = JSON.parse(data) as unknown;
  } catch {
    // NOT AN ERROR OF THE STREAM AND NOT A REASON TO DROP THE ELEMENT. The reader is shown the
    // raw text with this sentence beside it, which is the only way to debug a server that is
    // emitting something other than what it says it emits.
    return 'this element is not JSON, and the document declares an item schema for it';
  }

  if (!matchesType(value, schema.type)) {
    const declared =
      typeof schema.type === 'string' ? schema.type : (schema.type ?? []).join(' or ');

    return `the document declares items of type ${declared}, and this one is ${typeOf(value)}`;
  }

  if (schema.const !== undefined && !sameValue(value, schema.const)) {
    return 'this element is not the constant value the document declares';
  }

  if (schema.enum !== undefined && !schema.enum.some((candidate) => sameValue(value, candidate))) {
    return 'this element is not one of the values the document enumerates';
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const missing = (schema.required ?? []).filter((name) => !(name in record));

  if (missing.length > 0) {
    return `the document requires ${missing.join(', ')}, and this element carries ${missing.length === 1 ? 'no such property' : 'none of them'}`;
  }

  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    if (!(name in record)) continue;
    if (matchesType(record[name], property.type)) continue;

    const declared =
      typeof property.type === 'string' ? property.type : (property.type ?? []).join(' or ');

    return `the property ${name} is declared ${declared} and this element carries ${typeOf(record[name])}`;
  }

  return null;
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The fields an IR interface declares, read out of the source rather than listed beside it.
 *
 * WHY IT IS PARSED AND NOT WRITTEN DOWN. Two obligations addressed to `T047` both need the same
 * fact: which fields `IRJsonSchema` declares, and which fields every IR type declares. A list kept
 * beside either check would be a second copy of the IR, and the failure it produces is the one this
 * repository keeps finding: a field added to the type and not to the copy is a field neither check
 * can see, so both go on reporting complete coverage of a set that has stopped being the set.
 *
 * WHAT IT UNDERSTANDS IS ONE INTERFACE BODY AT ONE LEVEL. The IR types are flat records of
 * `readonly name?: T` members, and a nested object literal inside a member's type is that member's
 * shape rather than a field of the interface, so brace depth decides what counts. A parser that
 * counted every `name:` in the file would count the members of inline object types and the keys of
 * example objects in doc comments.
 */

/** Where the IR types live, relative to the repository root. */
export const IR_DOMAIN = join('packages', 'core', 'src', 'ir', 'domain');

/** A member of one interface, with the interface it belongs to. */
export interface DeclaredField {
  readonly owner: string;
  readonly name: string;
  /** Whether the declaration marks it optional. */
  readonly optional: boolean;
  /** File it is declared in, relative to the repository root. */
  readonly file: string;
}

/** One member declaration: `readonly name?: type`, at the top level of an interface body. */
const MEMBER = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)(\?)?\s*:/u;

/** The opening of an interface or a type alias for an object literal. */
const OPENING =
  /^export\s+(?:interface\s+([A-Za-z_$][\w$]*)[^{]*|type\s+([A-Za-z_$][\w$]*)\s*=)\{?/u;

/**
 * Reads every field every exported interface in one source file declares.
 *
 * @param source - Contents of a TypeScript source file
 * @param file - Path recorded on each field, for a message that names where it came from
 * @returns The fields, in source order
 */
export function declaredFieldsIn(source: string, file: string): DeclaredField[] {
  const fields: DeclaredField[] = [];
  const lines = source.split('\n');

  let owner: string | undefined;
  let depth = 0;

  for (const line of lines) {
    if (owner === undefined) {
      const opening = OPENING.exec(line);
      if (opening === null) continue;
      const name = opening[1] ?? opening[2] ?? '';
      // A type alias that is not an object literal opens no body; the depth count below settles
      // it, since such a line carries no `{`.
      if (!line.includes('{')) continue;
      owner = name;
      depth = braceDelta(line);
      continue;
    }

    const before = depth;
    depth += braceDelta(line);
    if (depth <= 0) {
      owner = undefined;
      continue;
    }

    // Only the members of the interface itself, not of an object literal inside a member's type.
    if (before !== 1) continue;

    const member = MEMBER.exec(line);
    if (member === null) continue;
    fields.push({
      owner,
      name: member[1] ?? '',
      optional: member[2] === '?',
      file,
    });
  }

  return fields;
}

/**
 * The fields one named interface declares.
 *
 * @param repoRoot - Absolute path of the repository root
 * @param file - Path of the source file, relative to the repository root
 * @param interfaceName - Name of the exported interface
 * @returns Field names in source order
 */
export function fieldsOfInterface(repoRoot: string, file: string, interfaceName: string): string[] {
  return declaredFieldsIn(readFileSync(join(repoRoot, file), 'utf8'), file)
    .filter((field) => field.owner === interfaceName)
    .map((field) => field.name);
}

/**
 * Every schema body a document carries: the named ones, and every inline one inside a node.
 *
 * INLINE SCHEMAS COUNT BECAUSE A KEYWORD IS EXERCISED WHEREVER IT ARRIVES. A request body written
 * out in place is a schema the normalizer produced from a real document exactly as a component is,
 * and counting only `document.schemas` would report a keyword as unexercised while a corpus
 * document carries it in a parameter.
 *
 * @param document - A normalized document, as an object with `schemas`, `nodes` and `webhooks`
 * @returns The normalized bodies, in no particular order
 */
export function everySchemaOf(document: {
  readonly schemas: ReadonlyMap<string, { readonly normalized?: unknown }>;
  readonly nodes: ReadonlyMap<string, unknown>;
  readonly webhooks: ReadonlyMap<string, unknown>;
}): unknown[] {
  const bodies: unknown[] = [...document.schemas.values()].map((schema) => schema.normalized);
  const seen = new WeakSet();

  const walk = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const member of value) walk(member);
      return;
    }

    const record = value as Record<string, unknown>;
    if (record.kind === 'inline' && typeof record.schema === 'object' && record.schema !== null) {
      bodies.push((record.schema as { readonly normalized?: unknown }).normalized);
    }
    for (const member of Object.values(record)) walk(member);
  };

  for (const node of document.nodes.values()) walk(node);
  for (const node of document.webhooks.values()) walk(node);

  return bodies;
}

/**
 * Every keyword any schema of a document actually carries.
 *
 * THE WALK IS STRUCTURAL RATHER THAN A SCAN OF THE SERIALIZED IR, and the difference decides what
 * the answer means. A document's own material reaches the IR verbatim in `extensions`, `examples`
 * and `raw`, so a scan for key names would count an example object whose key happens to be `if` as
 * the conditional keyword being exercised, and the list of keywords nothing exercises would come
 * out shorter than the truth. Under-reporting a gap is the one direction this measurement must not
 * take, since the gap is what it exists to state.
 *
 * @param schemas - Named schemas of the document, and any inline ones the caller collected
 * @returns The keyword names present anywhere in them
 */
export function presentSchemaKeywords(schemas: Iterable<unknown>): Set<string> {
  const present = new Set<string>();
  const seen = new WeakSet();

  const visit = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const member of value) visit(member);
      return;
    }

    const schema = value as Record<string, unknown>;
    for (const key of Object.keys(schema)) present.add(key);

    // The positions an IRJsonSchema holds another IRJsonSchema, per `schema.types.ts`. A position
    // added there and not here would make this under-report, which is why the case that uses it
    // asserts a known keyword is found rather than trusting the walk.
    for (const key of [
      'propertyNames',
      'additionalProperties',
      'items',
      'if',
      'then',
      'else',
      'not',
    ]) {
      visit(schema[key]);
    }
    for (const key of ['prefixItems', 'allOf', 'oneOf', 'anyOf']) visit(schema[key]);
    for (const key of ['properties', 'patternProperties']) {
      const record = schema[key];
      if (typeof record === 'object' && record !== null) {
        for (const member of Object.values(record)) visit(member);
      }
    }
    const variants = schema.variants;
    if (Array.isArray(variants)) {
      for (const variant of variants) {
        visit((variant as { readonly schema?: unknown }).schema);
      }
    }
  };

  for (const schema of schemas) visit(schema);

  return present;
}

function braceDelta(line: string): number {
  let delta = 0;
  for (const character of line) {
    if (character === '{') delta += 1;
    if (character === '}') delta -= 1;
  }
  return delta;
}

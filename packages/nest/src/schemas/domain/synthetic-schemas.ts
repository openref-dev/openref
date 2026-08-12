/**
 * The registry the generic factories of SPEC 13.5 write into, and the merge that lands it in the
 * document.
 *
 * WHY A REGISTRY AT ALL, AND NOT A SCHEMA HANDED TO `@nestjs/swagger`. Registering a schema with
 * that package means importing it, and `shared/types/nest-surface.ts` allows this package exactly
 * one value load, of `@nestjs/core`, on the `forRoot` path only. So `paginated(CatDto)` puts the
 * body here and hands the decorator a plain `{ schema: { $ref } }`, which is data rather than a
 * coupling, and this module puts the body into the document at intake.
 *
 * THE MERGE HAPPENS BEFORE NORMALIZATION AND BEFORE `openapi.json` IS SERVED, per SPEC 13.5, and
 * all three consequences of that are load bearing:
 *
 * - the specification a reader downloads and the IR the page renders describe one document. A
 *   schema added only to the IR would be missing from the file an SDK generator reads
 * - collision detection has both sides in hand: what the host already declared, and what the
 *   factories built. A collision is a build error naming both, never a silent last-write-wins
 * - a `$ref` the factories produced is checked against the merged document, so a body referring
 *   to a DTO that never reached `components.schemas` fails at boot with the fix in the message,
 *   rather than at render time as a dangling reference
 *
 * DETERMINISM IS THE POINT OF THE WHOLE SECTION. Two builds of one application produce the same
 * names and the same bodies in the same order, or `openref diff` reports breaking changes that did
 * not happen. Names come from the class name, entries are merged in sorted order, and nothing here
 * reads a clock or a counter.
 */

import { canonicalize, ErrorCode, InvalidOptionsError } from '@openref/core';

/** A JSON Schema object, as it sits in `components.schemas`. */
export type SchemaBody = Record<string, unknown>;

/** One schema a factory built. */
export interface SyntheticSchema {
  /** Name in `components.schemas`, such as `PaginatedCatDto`. */
  readonly name: string;
  /** The body. */
  readonly schema: SchemaBody;
  /**
   * How it was asked for, such as `paginated(CatDto)`.
   *
   * Kept for one purpose: a collision message that names both sides. "PaginatedCatDto is declared
   * twice" sends a reader looking through their own DTOs; naming the two calls that produced it
   * points at the two lines to change.
   */
  readonly source: string;
}

/** Where a class name is read from, which is the whole of what a factory can know about a type. */
export type SchemaClass = new (...args: never[]) => unknown;

/**
 * The registry.
 *
 * ONE INSTANCE PER PROCESS IN ORDINARY USE, because decorators run at import time, long before any
 * module or document exists. The class is exported so a test can hold its own and so two
 * documents in one process can be reasoned about; {@link syntheticSchemas} is the instance the
 * factories use.
 */
export class SyntheticSchemaRegistry {
  private readonly byName = new Map<string, SyntheticSchema>();

  /**
   * The cache of SPEC 13.5, keyed on the `(wrapper, inner)` pair.
   *
   * A `WeakMap` on the inner class, so a DTO that goes out of scope takes its entry with it, and
   * the wrapper's own key inside it. Calling `paginated(CatDto)` twice returns one object and
   * registers one schema, which is what keeps `components.schemas` free of duplicates.
   */
  private readonly cache = new WeakMap<SchemaClass, Map<string, SyntheticSchema>>();

  /**
   * Registers one synthetic schema, or returns the one already registered for this pair.
   *
   * @param key - Cache key: the inner class and a wrapper identifier such as `paginated`
   * @param entry - The schema to register when the pair is new
   * @returns The registered schema
   * @throws {InvalidOptionsError} When the name is taken by a different body
   */
  register(key: { inner: SchemaClass; wrapper: string }, entry: SyntheticSchema): SyntheticSchema {
    const forInner = this.cache.get(key.inner) ?? new Map<string, SyntheticSchema>();
    const cached = forInner.get(key.wrapper);
    if (cached !== undefined) {
      // A CACHE HIT IS CHECKED AND NOT TRUSTED, and this is the collision the section is most
      // about. SPEC 13.5 keys the cache on the pair, and the pair does not determine the body:
      // `envelope(OrderDto, { meta: PageMeta })` and `envelope(OrderDto, { meta: Cursor })` are
      // one pair and two schemas. Returning the cached one would hand the second call site a
      // reference to a schema describing something else, silently, which is the exact failure
      // this whole check exists to prevent and the only one it could have produced itself.
      if (canonicalize(cached.schema) === canonicalize(entry.schema)) return cached;

      throw collision(entry.name, cached.source, entry.source);
    }

    const existing = this.byName.get(entry.name);
    if (existing !== undefined) {
      // A different pair wanting a name that is taken: two inner classes of the same name from
      // two modules, most often, which is a real collision in a generated SDK.
      throw collision(entry.name, existing.source, entry.source);
    }

    this.byName.set(entry.name, entry);
    forInner.set(key.wrapper, entry);
    this.cache.set(key.inner, forInner);

    return entry;
  }

  /**
   * Everything registered, in name order.
   *
   * @returns The entries, sorted by name so a merge is deterministic
   */
  entries(): readonly SyntheticSchema[] {
    return [...this.byName.values()].sort((left, right) => (left.name < right.name ? -1 : 1));
  }

  /**
   * Empties the registry.
   *
   * FOR A TEST, AND SAID SO RATHER THAN HIDDEN. A host never calls this: the entries are written by
   * decorators at import time and there is no moment in an application's life when discarding them
   * is right. A test that registers a deliberate collision needs to be able to start again.
   */
  clear(): void {
    this.byName.clear();
  }
}

/** The instance the factories of SPEC 13.5 write into. */
export const syntheticSchemas = new SyntheticSchemaRegistry();

/** Where a `$ref` into `components.schemas` points. */
const COMPONENTS_PREFIX = '#/components/schemas/';

/**
 * Builds the reference to a named schema.
 *
 * @param name - Schema name
 * @returns The `$ref` object
 */
export function schemaRef(name: string): SchemaBody {
  return { $ref: `${COMPONENTS_PREFIX}${name}` };
}

/**
 * Reads the class name a synthetic name is built from.
 *
 * @param type - The class
 * @param role - What it was passed as, for the message
 * @returns Its name
 * @throws {InvalidOptionsError} When it has none, which an anonymous class does
 */
export function schemaNameOf(type: SchemaClass, role: string): string {
  const name = typeof type === 'function' ? type.name : '';

  if (name === '') {
    throw new InvalidOptionsError(
      `the ${role} passed to a schema factory has no name, so no stable schema name can be ` +
        'built from it. An anonymous class or a minified build causes this; name the class, and ' +
        'keep class names in the server build, which @nestjs/swagger needs as well',
      ErrorCode.CONFIG_INVALID_OPTIONS,
    );
  }

  return name;
}

/**
 * Puts every registered schema into a copy of the source document.
 *
 * @param document - The OpenAPI document as the host supplied it
 * @param registry - Which registry to merge, defaulting to the one the factories write into
 * @returns A copy carrying the synthetic schemas, or the document itself when there are none
 * @throws {InvalidOptionsError} On a name collision, or a reference to a schema the document
 *   does not carry
 */
export function mergeSyntheticSchemas(
  document: unknown,
  registry: SyntheticSchemaRegistry = syntheticSchemas,
): unknown {
  const entries = registry.entries();
  if (entries.length === 0) return document;

  // A DOCUMENT THAT IS NOT AN OBJECT IS LEFT ALONE RATHER THAN REFUSED HERE. `setup` accepts YAML
  // and JSON text as well, and the normalizer is the one place that decides whether a document is
  // readable at all. Merging into text would mean parsing it here, which would make this the
  // second parser in the package.
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    return document;
  }

  const source = document as Record<string, unknown>;
  const components = asRecord(source.components);
  const schemas = asRecord(components.schemas);
  const merged: Record<string, unknown> = { ...schemas };

  for (const entry of entries) {
    const existing = merged[entry.name];
    if (existing !== undefined) {
      throw collision(entry.name, 'a schema already in the document', entry.source);
    }

    merged[entry.name] = entry.schema;
  }

  assertReferencesResolve(entries, merged);

  return { ...source, components: { ...components, schemas: merged } };
}

/**
 * Checks that every reference a synthetic body makes lands on something.
 *
 * WHY THIS IS NOT PARANOIA: it is the common case rather than an edge one. `@nestjs/swagger`
 * collects a DTO into `components.schemas` when a decorated route mentions it, and a route that
 * only mentions `paginated(CatDto)` mentions `{ $ref }` and never `CatDto`. So the ordinary first
 * use of these factories produces a dangling reference unless the host also writes
 * `@ApiExtraModels(CatDto)`, and the message says exactly that.
 *
 * @param entries - The synthetic schemas
 * @param schemas - The merged schema map
 * @throws {InvalidOptionsError} When a reference points at a name that is not there
 */
function assertReferencesResolve(
  entries: readonly SyntheticSchema[],
  schemas: Readonly<Record<string, unknown>>,
): void {
  for (const entry of entries) {
    for (const target of referencedNames(entry.schema)) {
      if (target in schemas) continue;

      throw new InvalidOptionsError(
        `${entry.source} builds ${entry.name}, which references the schema ${target}, and the ` +
          'document does not carry it. @nestjs/swagger only collects a DTO it sees named on a ' +
          `route, and a route documented with ${entry.source} names the wrapper instead. Add ` +
          `@ApiExtraModels(${target}) to the controller, which is what tells it to include the type`,
        ErrorCode.CONFIG_INVALID_OPTIONS,
      );
    }
  }
}

/**
 * Every `components.schemas` name a body refers to, at any depth.
 *
 * @param value - A schema body or part of one
 * @returns The names
 */
function referencedNames(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.flatMap((item) => referencedNames(item));
  if (typeof value !== 'object' || value === null) return [];

  const found: string[] = [];
  for (const [key, member] of Object.entries(value)) {
    if (key === '$ref' && typeof member === 'string' && member.startsWith(COMPONENTS_PREFIX)) {
      found.push(member.slice(COMPONENTS_PREFIX.length));
      continue;
    }

    found.push(...referencedNames(member));
  }

  return found;
}

/**
 * Narrows a member to a record, treating anything else as absent.
 *
 * @param value - The member
 * @returns It, or an empty record
 */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * The error both collision paths raise.
 *
 * @param name - The name two things want
 * @param first - Where the first came from
 * @param second - Where the second came from
 * @returns The error to throw
 */
function collision(name: string, first: string, second: string): InvalidOptionsError {
  return new InvalidOptionsError(
    `two different schemas would both be called ${name}: ${first}, and ${second}. A silent ` +
      'collision produces colliding client types in a generated SDK and false breaking changes ' +
      'in openref diff, so it is refused here. Give one of them a wrapper of its own, or rename ' +
      'the inner type',
    ErrorCode.CONFIG_INVALID_OPTIONS,
  );
}

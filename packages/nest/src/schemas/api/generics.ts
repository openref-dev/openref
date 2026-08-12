/**
 * `paginated(T)` and `envelope(T, { meta })`, the generic factories of SPEC 13.5.
 *
 * THE PROBLEM THEY SOLVE IS THAT TYPESCRIPT GENERICS DO NOT SURVIVE COMPILATION. `Page<CatDto>`
 * is `Object` at runtime, so no decorator and no reflection can describe it, and the usual answer
 * in this ecosystem is a hand written wrapper DTO per inner type. These build one instead, from
 * the two things that are still there at runtime: the wrapper's shape and the inner class's name.
 *
 * WHAT THEY RETURN IS WHAT `@ApiOkResponse` TAKES, and nothing more: `{ schema: { $ref } }`. The
 * body itself goes to the registry in `../domain/synthetic-schemas.ts`, which merges it into the
 * document at intake. See that file for why the schema is not registered with `@nestjs/swagger`.
 *
 * THE SHAPES ARE FIXED HERE AND ARE NOT CONFIGURABLE, which is a decision rather than an omission.
 * A factory whose field names could be passed in would produce a different `PaginatedCatDto` per
 * call site while keeping one name, which is the collision this section exists to prevent, and it
 * would be the caller rather than this file that had to keep two builds agreeing. A host that
 * needs a different envelope writes a DTO, which is what it would be doing anyway.
 */

import {
  schemaNameOf,
  schemaRef,
  syntheticSchemas,
  type SchemaBody,
  type SchemaClass,
  type SyntheticSchemaRegistry,
} from '../domain/synthetic-schemas';

/** What a decorator such as `@ApiOkResponse` is given. */
export interface SchemaReference {
  /** The reference, as OpenAPI writes one. */
  readonly schema: SchemaBody;
}

/** Options both factories share. */
export interface SyntheticSchemaOptions {
  /** Registry to write into. Defaults to the process wide one, and a test passes its own. */
  readonly registry?: SyntheticSchemaRegistry;
}

/** What `envelope` needs beyond the inner type. */
export interface EnvelopeOptions extends SyntheticSchemaOptions {
  /** The class describing the envelope's metadata block. */
  readonly meta?: SchemaClass;
}

/**
 * A page of items, as `PaginatedCatDto`.
 *
 * @param inner - The class of one item
 * @param options - Registry override, for a test
 * @returns The reference to hand a response decorator
 * @throws {InvalidOptionsError} When the name collides with another schema
 */
export function paginated(
  inner: SchemaClass,
  options: SyntheticSchemaOptions = {},
): SchemaReference {
  const registry = options.registry ?? syntheticSchemas;
  const innerName = schemaNameOf(inner, 'item type');
  const name = `Paginated${innerName}`;

  const entry = registry.register(
    { inner, wrapper: 'paginated' },
    {
      name,
      source: `paginated(${innerName})`,
      schema: {
        type: 'object',
        required: ['items', 'total'],
        properties: {
          items: { type: 'array', items: schemaRef(innerName) },
          total: { type: 'integer', description: 'How many items match, across all pages.' },
          page: { type: 'integer', description: 'One based index of this page.' },
          perPage: { type: 'integer', description: 'How many items a full page holds.' },
        },
      },
    },
  );

  return { schema: schemaRef(entry.name) };
}

/**
 * One value under `data`, with an optional metadata block, as `EnvelopeOrderDto`.
 *
 * THE METADATA CLASS IS NOT IN THE NAME, per SPEC 13.5, which names the wrapper and the inner
 * type. Two envelopes over one type with different metadata therefore collide, deliberately: they
 * are two different schemas and one name, which is exactly what the collision check is for. The
 * error names both call sites.
 *
 * @param inner - The class under `data`
 * @param options - The metadata class, and a registry override for a test
 * @returns The reference to hand a response decorator
 * @throws {InvalidOptionsError} When the name collides with another schema
 */
export function envelope(inner: SchemaClass, options: EnvelopeOptions = {}): SchemaReference {
  const registry = options.registry ?? syntheticSchemas;
  const innerName = schemaNameOf(inner, 'data type');
  const metaName = options.meta === undefined ? undefined : schemaNameOf(options.meta, 'meta type');
  const name = `Envelope${innerName}`;

  const entry = registry.register(
    { inner, wrapper: 'envelope' },
    {
      name,
      source:
        metaName === undefined
          ? `envelope(${innerName})`
          : `envelope(${innerName}, { meta: ${metaName} })`,
      schema: {
        type: 'object',
        required: ['data'],
        properties: {
          data: schemaRef(innerName),
          ...(metaName === undefined ? {} : { meta: schemaRef(metaName) }),
        },
      },
    },
  );

  return { schema: schemaRef(entry.name) };
}

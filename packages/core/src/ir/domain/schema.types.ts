/**
 * Schema model, per SPEC 5.2.
 *
 * AsyncAPI allows a payload to be described by something other than JSON Schema through the
 * Multi Format Schema Object. Only JSON Schema compatible dialects go through the common
 * pipeline; the rest are carried as annotated source and rendered as such.
 */

/** Any value that can appear literally inside a specification document. */
export type IRJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly IRJsonValue[]
  | { readonly [key: string]: IRJsonValue };

/** Dialect a schema is written in. */
export type IRSchemaDialect =
  'json-schema-2020-12' | 'openapi-3.0' | 'asyncapi-schema' | 'avro' | 'protobuf' | 'unknown';

/** Primitive type names a JSON Schema may declare. */
export type IRJsonSchemaType =
  'null' | 'boolean' | 'object' | 'array' | 'number' | 'integer' | 'string';

/** Which of the two views of a schema a field belongs to, per SPEC 5.4. */
export type IRSchemaView = 'request' | 'response' | 'both';

/** A labelled branch of a `oneOf` or `anyOf`, named from `discriminator.mapping` when present. */
export interface IRSchemaVariant {
  readonly label: string;
  readonly schema: IRJsonSchema;
  /** Discriminator value that selects this variant, when the schema declares one. */
  readonly discriminatorValue?: string;
}

/** Discriminator declaration carried through from the source document. */
export interface IRDiscriminator {
  readonly propertyName: string;
  readonly mapping?: Readonly<Record<string, string>>;
}

/**
 * Normalized JSON Schema, the shape every JSON Schema compatible dialect is reduced to.
 *
 * A cycle detected during resolution is represented by `$cycle` holding the id of the schema
 * the cycle points back to, rather than by an infinite structure.
 */
export interface IRJsonSchema {
  readonly $id?: string;
  /**
   * Id of an entry in {@link IRDocument.schemas} that stands at this position, per SPEC 5.1.1.
   *
   * A named schema exists once, in the document's schema map, and is referred to everywhere
   * else. When this is set, no keyword other than an annotation accompanies it, and a
   * consumer must look the target up rather than expect a body here.
   *
   * This is a model decision, not a size optimization. Federation deduplicates by schema
   * hash, the schema viewer shows a field as being of a named type, and diff classifies a
   * change to a named schema once. An inlined copy has lost the name all three need.
   */
  readonly $ref?: string;
  /**
   * Set instead of the body when resolution folded a cycle at this position.
   *
   * A cycle is a reference too, marked separately because a consumer needs to know that
   * following it leads back to where it started.
   */
  readonly $cycle?: string;

  readonly title?: string;
  readonly description?: string;
  readonly type?: IRJsonSchemaType | readonly IRJsonSchemaType[];
  readonly format?: string;

  readonly enum?: readonly IRJsonValue[];
  readonly const?: IRJsonValue;
  readonly default?: IRJsonValue;
  readonly examples?: readonly IRJsonValue[];

  readonly deprecated?: boolean;
  readonly readOnly?: boolean;
  readonly writeOnly?: boolean;
  /** Which view this schema belongs to once `readOnly` and `writeOnly` have been applied. */
  readonly view?: IRSchemaView;

  readonly properties?: Readonly<Record<string, IRJsonSchema>>;
  readonly patternProperties?: Readonly<Record<string, IRJsonSchema>>;
  readonly propertyNames?: IRJsonSchema;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | IRJsonSchema;
  readonly minProperties?: number;
  readonly maxProperties?: number;

  readonly items?: IRJsonSchema;
  readonly prefixItems?: readonly IRJsonSchema[];
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;

  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;

  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly exclusiveMaximum?: number;
  readonly multipleOf?: number;

  readonly allOf?: readonly IRJsonSchema[];
  readonly oneOf?: readonly IRJsonSchema[];
  readonly anyOf?: readonly IRJsonSchema[];
  readonly not?: IRJsonSchema;
  readonly discriminator?: IRDiscriminator;
  /** Readable labels for `oneOf` and `anyOf` branches, produced by the normalizer. */
  readonly variants?: readonly IRSchemaVariant[];

  /** Vendor extensions kept verbatim, including `x-openref-*`. */
  readonly extensions?: Readonly<Record<string, IRJsonValue>>;
}

/**
 * A schema as stored in {@link IRDocument.schemas}.
 *
 * `normalized` is filled only for JSON Schema compatible dialects. For everything else
 * `raw` carries the source and the renderer shows it as annotated source with its dialect.
 */
export interface IRSchema {
  readonly id: string;
  readonly name?: string;
  readonly dialect: IRSchemaDialect;
  readonly normalized?: IRJsonSchema;
  readonly raw?: unknown;
}

/**
 * Where a schema comes from at a use site: a named entry in the document, or inline.
 *
 * Making this a discriminated union rather than two optional fields removes the question of
 * what it means when both are set.
 */
export type IRSchemaSlot =
  | { readonly kind: 'named'; readonly schemaId: string }
  | { readonly kind: 'inline'; readonly schema: IRSchema };

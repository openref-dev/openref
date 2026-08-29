import { buildNavigation, finalizeDocument } from '@openref/core';
import type {
  IRChannel,
  IRDocument,
  IRJsonSchema,
  IRNode,
  IROperation,
  IRSchema,
  IRSecurityScheme,
} from '@openref/core';

/**
 * Documents to merge, built the way the normalizer builds one: navigation from `core`, then
 * `finalizeDocument`, so a fixture is hashed and frozen exactly like a real service's document.
 *
 * A FIXTURE THAT IS NOT FROZEN WOULD HIDE THE DEFECT THESE SUITES EXIST TO CATCH. The merge takes
 * documents it does not own, and a rewrite that wrote into one instead of building a new value
 * would pass every assertion about the output while corrupting the input. Freezing turns that into
 * a `TypeError` in the case that provoked it.
 */

/** Options a fixture document is assembled from. */
export interface DocumentOptions {
  readonly id: string;
  readonly title?: string;
  readonly version?: string;
  readonly nodes?: readonly IRNode[];
  readonly schemas?: readonly IRSchema[];
  readonly security?: readonly IRSecurityScheme[];
  readonly webhooks?: readonly IRNode[];
  readonly servers?: IRDocument['servers'];
  readonly relationships?: IRDocument['relationships'];
  readonly health?: IRDocument['health'];
  readonly runtime?: IRDocument['runtime'];
  readonly extensions?: IRDocument['extensions'];
  readonly kind?: IRDocument['kind'];
}

/** Builds one service's document, hashed and frozen. */
export function buildDocument(options: DocumentOptions): IRDocument {
  const nodes = options.nodes ?? [];
  const schemas = options.schemas ?? [];
  const webhooks = options.webhooks ?? [];

  const document: { -readonly [Key in keyof IRDocument]: IRDocument[Key] } = {
    id: options.id,
    kind: options.kind ?? 'http',
    hash: '',
    info: { title: options.title ?? options.id, version: options.version ?? '1.0.0' },
    servers: options.servers ?? [],
    navigation: buildNavigation({ tags: [], nodes, schemas }),
    nodes: new Map(nodes.map((node) => [node.id, node])),
    schemas: new Map(schemas.map((schema) => [schema.id, schema])),
    security: options.security ?? [],
    relationships: options.relationships ?? [],
    webhooks: new Map(webhooks.map((node) => [node.id, node])),
  };

  if (options.health !== undefined) document.health = options.health;
  if (options.runtime !== undefined) document.runtime = options.runtime;
  if (options.extensions !== undefined) document.extensions = options.extensions;

  return finalizeDocument(document);
}

/** Builds an HTTP operation, filling the fields every operation must have. */
export function operation(
  overrides: Partial<IROperation> & { readonly id: string; readonly path: string },
): IROperation {
  return {
    kind: 'operation',
    method: 'get',
    tags: [],
    deprecated: false,
    parameters: [],
    responses: [],
    security: [],
    servers: [],
    ...overrides,
  };
}

/** Builds an event channel, filling the fields every channel must have. */
export function channel(overrides: Partial<IRChannel> & { readonly id: string }): IRChannel {
  return {
    kind: 'channel',
    tags: [],
    deprecated: false,
    servers: [],
    operations: [],
    messages: [],
    ...overrides,
  };
}

/** Builds a named schema. */
export function namedSchema(id: string, normalized: IRJsonSchema, name?: string): IRSchema {
  return { id, name: name ?? id, dialect: 'json-schema-2020-12', normalized };
}

/** Builds a bearer scheme, optionally with OAuth2 scopes, which is SPEC 15's own example. */
export function bearerScheme(scopes?: Readonly<Record<string, string>>): IRSecurityScheme {
  if (scopes === undefined) return { id: 'bearer', type: 'http', scheme: 'bearer' };

  return {
    id: 'bearer',
    type: 'oauth2',
    flows: { clientCredentials: { tokenUrl: 'https://auth.example.com/token', scopes } },
  };
}

/**
 * An operation carrying a reference in every position the IR admits one.
 *
 * IT EXISTS TO FAIL, NOT TO PASS. The rewrite is field by field, so the failure it can have is a
 * field nobody listed; a fixture that only fills the ordinary positions would let that field stay
 * unlisted for as long as nobody wrote a document using it. Every reference here points at
 * `Target`, so a case can assert that no `Target` survives a merge that renamed it.
 *
 * @param id - Node id
 * @param target - Schema id every reference in it points at
 * @returns The operation
 */
export function referenceHeavyOperation(id: string, target: string): IROperation {
  const named = { kind: 'named', schemaId: target } as const;
  const inline: IRJsonSchema = {
    type: 'object',
    properties: { direct: { $ref: target }, nested: { items: { $ref: target } } },
    patternProperties: { '^x-': { $ref: target } },
    propertyNames: { $ref: target },
    additionalProperties: { $ref: target },
    if: { $ref: target },
    then: { $ref: target },
    else: { $ref: target },
    prefixItems: [{ $ref: target }],
    allOf: [{ $ref: target }],
    oneOf: [{ $ref: target }],
    anyOf: [{ $ref: target }],
    not: { $ref: target },
    variants: [{ label: 'one', schema: { $ref: target } }],
    items: { $cycle: target },
  };

  return operation({
    id,
    method: 'post',
    path: `/${id}`,
    parameters: [
      { name: 'filter', in: 'query', required: false, style: 'form', explode: true, schema: named },
    ],
    requestBody: {
      required: true,
      content: [
        {
          mediaType: 'multipart/form-data',
          schema: {
            kind: 'inline',
            schema: { id: `${id}-body`, dialect: 'json-schema-2020-12', normalized: inline },
          },
          encoding: {
            part: {
              contentType: 'application/json',
              headers: [{ name: 'X-Part', required: false, schema: named }],
            },
          },
        },
      ],
    },
    responses: [
      {
        statusCode: '200',
        content: [{ mediaType: 'application/json', schema: named }],
        headers: [{ name: 'X-Trace', required: false, schema: named }],
        itemSchema: named,
      },
    ],
    security: [{ schemeId: 'bearer', scopes: ['read'] }],
    callbacks: { onEvent: [`${id}-callback`] },
    extensions: { 'x-vendor': { $ref: target, schemaId: target } },
    runtime: {
      errors: {
        declared: [
          {
            status: 404,
            title: 'Not found',
            origin: 'declared',
            confidence: 'declared',
            collector: 'errorsCollector',
            schema: named,
          },
        ],
        runtimeDerived: [
          {
            status: 429,
            title: 'Too many requests',
            origin: 'runtime-derived',
            confidence: 'derived',
            collector: 'throttlerCollector',
            schema: named,
          },
        ],
        global: [
          {
            status: 500,
            title: 'Server error',
            origin: 'global',
            confidence: 'derived',
            collector: 'filtersCollector',
            schema: named,
          },
        ],
      },
      streaming: {
        value: { transport: 'sse', itemSchema: named },
        confidence: 'declared',
        collector: 'streamCollector',
      },
      drift: [
        {
          rule: 'error-undocumented',
          severity: 'warning',
          nodeId: id,
          schemaId: target,
          message: 'the specification does not document this error',
          suggestion: 'add @ApiErrors',
          classification: { bucket: 'silence' },
          edit: 'new-assertion',
          basis: { kind: 'collected', confidence: 'declared' },
        },
      ],
    },
  });
}

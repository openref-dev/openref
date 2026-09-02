import type { IRChannel, IRDocument, IRNode, IROperation, IRSchema } from '../../src/index';

/**
 * A document that exercises the parts of the IR most likely to break determinism: integer like
 * response keys, nested schemas, maps, and both node kinds.
 */
export function createDocumentFixture(): IRDocument {
  const orderSchema: IRSchema = {
    id: 'Order',
    name: 'Order',
    dialect: 'json-schema-2020-12',
    normalized: {
      type: 'object',
      title: 'Order',
      required: ['id', 'total'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        total: { type: 'number', minimum: 0 },
        lines: {
          type: 'array',
          items: { $cycle: 'Order' },
          minItems: 1,
        },
        status: { type: 'string', enum: ['new', 'paid', 'shipped'] },
      },
      additionalProperties: false,
    },
  };

  const problemSchema: IRSchema = {
    id: 'Problem',
    name: 'Problem',
    dialect: 'json-schema-2020-12',
    normalized: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'integer' },
      },
    },
  };

  const listOrders: IROperation = {
    kind: 'operation',
    id: 'get-orders',
    method: 'get',
    path: '/orders',
    operationId: 'get-orders',
    rawOperationId: 'OrdersController_findAll',
    summary: 'List orders',
    description: 'Returns every order visible to the caller.',
    tags: ['orders'],
    deprecated: false,
    parameters: [
      {
        name: 'status',
        in: 'query',
        required: false,
        style: 'form',
        explode: true,
        schema: { kind: 'named', schemaId: 'Order' },
      },
      {
        name: 'limit',
        in: 'query',
        required: false,
        style: 'form',
        explode: true,
        schema: { kind: 'inline', schema: { id: 'inline-limit', dialect: 'json-schema-2020-12' } },
      },
    ],
    responses: [
      {
        statusCode: '200',
        description: 'ok',
        content: [{ mediaType: 'application/json', schema: { kind: 'named', schemaId: 'Order' } }],
      },
      {
        statusCode: '404',
        description: 'not found',
        content: [
          { mediaType: 'application/problem+json', schema: { kind: 'named', schemaId: 'Problem' } },
        ],
      },
      {
        statusCode: 'default',
        description: 'unexpected',
        content: [],
      },
    ],
    security: [{ schemeId: 'bearer', scopes: ['orders:read'] }],
    servers: [],
    runtime: {
      source: {
        controller: 'OrdersController',
        handler: 'findAll',
        file: 'src/orders.ts',
        line: 42,
      },
      guards: [
        {
          name: 'JwtAuthGuard',
          scope: 'route',
          confidence: 'derived',
          collector: 'guardsCollector',
        },
      ],
      scopes: { value: ['orders:read'], confidence: 'declared', collector: 'scopesCollector' },
    },
  };

  const orderCreated: IRChannel = {
    kind: 'channel',
    id: 'channel-order-created',
    address: 'order.created',
    title: 'Order created',
    tags: ['orders'],
    deprecated: false,
    protocol: 'kafka',
    servers: [],
    operations: [
      {
        id: 'send-order-created',
        direction: 'send',
        messageIds: ['OrderCreated'],
      },
    ],
    messages: [
      {
        id: 'OrderCreated',
        name: 'OrderCreated',
        contentType: 'application/json',
        payload: { kind: 'named', schemaId: 'Order' },
      },
    ],
  };

  const nodes = new Map<string, IRNode>([
    [listOrders.id, listOrders],
    [orderCreated.id, orderCreated],
  ]);

  const schemas = new Map<string, IRSchema>([
    [orderSchema.id, orderSchema],
    [problemSchema.id, problemSchema],
  ]);

  return {
    id: 'orders-api',
    kind: 'mixed',
    hash: '',
    info: {
      title: 'Orders API',
      version: '1.4.0',
      description: 'Orders and their events.',
      license: { name: 'MIT', identifier: 'MIT' },
    },
    servers: [
      { url: 'https://api.example.com', description: 'production' },
      { url: 'https://staging.example.com', description: 'staging' },
    ],
    navigation: [
      {
        id: 'group-orders',
        label: 'Orders',
        kind: 'group',
        children: [
          {
            id: 'nav-get-orders',
            label: 'List orders',
            kind: 'node',
            nodeId: 'get-orders',
            children: [],
          },
          {
            id: 'nav-order-created',
            label: 'Order created',
            kind: 'node',
            nodeId: 'channel-order-created',
            children: [],
          },
        ],
      },
    ],
    nodes,
    schemas,
    security: [
      { id: 'bearer', type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      {
        id: 'oauth',
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: 'https://auth.example.com/authorize',
            tokenUrl: 'https://auth.example.com/token',
            scopes: { 'orders:read': 'Read orders', 'orders:write': 'Write orders' },
          },
        },
      },
    ],
    relationships: [
      {
        from: 'get-orders',
        fromKind: 'node',
        to: 'channel-order-created',
        toKind: 'node',
        type: 'publishes',
        confidence: 'declared',
      },
    ],
    webhooks: new Map<string, IRNode>(),
  };
}

/** Deterministic pseudo random generator, so a failing shuffle can be reproduced exactly. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    const held = copy[index];
    const other = copy[target];
    if (held === undefined || other === undefined) continue;
    copy[index] = other;
    copy[target] = held;
  }
  return copy;
}

/**
 * Rebuilds a value with object keys and map entries inserted in a different order.
 *
 * Array order is left alone: in the IR it carries meaning, for example the order of responses.
 *
 * THIS SHUFFLE IS NOT HASH PRESERVING SINCE 2026-09-01, and it is not meant to be. SPEC 5.3's
 * exception says a map whose key order the document wrote is written in that order, so permuting
 * `properties` here is permuting content. Use it where the subject is invariance to a reordering
 * of anything, such as the diff; use {@link shuffleEquivalentKeys} where the subject is the hash.
 *
 * @param value - Value to rebuild
 * @param random - Source of randomness
 * @returns A structurally equal value whose insertion order differs
 */
export function shuffleKeys(value: unknown, random: () => number): unknown {
  if (value instanceof Map) {
    const entries = shuffled([...value.entries()], random);
    return new Map(entries.map(([key, entry]) => [key, shuffleKeys(entry, random)]));
  }

  if (Array.isArray(value)) {
    return (value as readonly unknown[]).map((item) => shuffleKeys(item, random));
  }

  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const source = value as Record<string, unknown>;
    const rebuilt: Record<string, unknown> = {};
    for (const key of shuffled(Object.keys(source), random)) {
      rebuilt[key] = shuffleKeys(source[key], random);
    }
    return rebuilt;
  }

  return value;
}

/**
 * The maps whose own keys SPEC 5.3 says the document wrote, whose values are shapes the IR declares.
 *
 * WRITTEN OUT BY HAND ON PURPOSE, and reconciled against `CANONICAL_MAP_ORDER` by a case in
 * `determinism.spec.ts` rather than derived from it. Deriving it would make the equivalence test
 * agree with the serializer by construction: drop a name from the record and the shuffler would
 * drop it too, so the pair would stay green while the hash stopped covering a map it covers now.
 * Two lists that have to agree, and something that makes them agree, is the shape this repository
 * uses everywhere the answer must not be able to move with the question.
 */
export const AUTHORED_KEY_MEMBERS: readonly string[] = [
  'callbacks',
  'dependentRequired',
  'encoding',
  'examples',
  'mapping',
  'parameters',
  'patternProperties',
  'properties',
  'scopes',
  'variables',
];

/** The members below which nothing is the IR's, so every level of them keeps the author's order. */
export const AUTHORED_TREE_MEMBERS: readonly string[] = [
  'bindings',
  'const',
  'default',
  'example',
  'extensions',
  'raw',
];

/** Both, for a caller that only needs to know whether a name carries an authored order at all. */
export const AUTHORED_ORDER_MEMBERS: readonly string[] = [
  ...AUTHORED_KEY_MEMBERS,
  ...AUTHORED_TREE_MEMBERS,
];

/** Whose keys a position carries, mirroring the three spaces of SPEC 5.3. */
export type AuthoredSpace = 'ir' | 'keys' | 'tree';

/**
 * Where a value sits when it is reached as a member of an object in the given space.
 *
 * @param space - Space the holding object is in
 * @param key - Member name being stepped into
 * @returns Space the member's value sits in
 */
export function authoredSpaceOf(space: AuthoredSpace, key: string): AuthoredSpace {
  if (space === 'tree') return 'tree';
  if (space === 'keys') return 'ir';
  if (AUTHORED_TREE_MEMBERS.includes(key)) return 'tree';
  return AUTHORED_KEY_MEMBERS.includes(key) ? 'keys' : 'ir';
}

/**
 * A SOURCE DOCUMENT IS NOT AN IR, AND THIS IS WHERE THE TWO SPELLINGS PART, found from red rather
 * than reasoned: the AsyncAPI suite read 197 hashes from 200 spellings until this rule existed.
 *
 * The record is keyed by IR member names, and the normalizer renames positions on the way in. A
 * Multi Format Schema Object is written under `payload` and arrives as `IRSchema.raw`, kept
 * verbatim, so permuting its keys at the source is permuting content while looking like spelling.
 * The rule stops at the object that DECLARES a format rather than at the member that holds it:
 * `schemaFormat` is the Multi Format Schema Object's own way of saying which dialect follows, so a
 * payload that names no format is still shuffled and keeps its coverage.
 *
 * IT CANNOT BE RECONCILED AGAINST THE RECORD, and that is stated rather than left as a silence: the
 * record has no source spellings in it. What holds it honest is the direction it fails in. A source
 * position missing from here is shuffled, the hash moves, and the suite goes red; it cannot go
 * quietly green.
 *
 * @param source - Object being stepped into
 * @returns Whether everything below it is the author's
 */
export function declaresOwnDialect(source: Record<string, unknown>): boolean {
  return Object.hasOwn(source, 'schemaFormat');
}

/**
 * Rebuilds a value with a different insertion order everywhere that order is not content.
 *
 * A GENUINELY EQUIVALENT SHUFFLE, which is what SPEC 5.3's thousand variants now means. Every
 * object key and every `Map` entry is permuted except where the document's own order is carried:
 * the keys of a map named in {@link AUTHORED_KEY_MEMBERS}, and every level below a member named in
 * {@link AUTHORED_TREE_MEMBERS}. The values inside a keyed map are still rebuilt, so the walk
 * reaches everything below it.
 *
 * @param value - Value to rebuild
 * @param random - Source of randomness
 * @returns A value that differs from the input only in orders the hash does not carry
 */
export function shuffleEquivalentKeys(value: unknown, random: () => number): unknown {
  const below = (space: AuthoredSpace): AuthoredSpace => (space === 'tree' ? 'tree' : 'ir');

  const walk = (held: unknown, space: AuthoredSpace): unknown => {
    if (held instanceof Map) {
      const entries = space === 'ir' ? shuffled([...held.entries()], random) : [...held.entries()];
      return new Map(entries.map(([key, entry]) => [key, walk(entry, below(space))]));
    }

    if (Array.isArray(held)) {
      return (held as readonly unknown[]).map((item) => walk(item, below(space)));
    }

    if (held !== null && typeof held === 'object' && !(held instanceof Date)) {
      const source = held as Record<string, unknown>;
      const here: AuthoredSpace = declaresOwnDialect(source) ? 'tree' : space;
      const own = Object.keys(source);
      const keys = here === 'ir' ? shuffled(own, random) : own;
      const rebuilt: Record<string, unknown> = {};
      for (const key of keys) {
        rebuilt[key] = walk(source[key], authoredSpaceOf(here, key));
      }
      return rebuilt;
    }

    return held;
  };

  return walk(value, 'ir');
}

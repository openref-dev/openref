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

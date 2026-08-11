import { normalizeOpenApiDocument, type IRDocument } from '@openref/core';

/**
 * Documents the render tests work against.
 *
 * They go through the real normalizer rather than being hand written IR. A hand written
 * document would let the renderer be tested against a shape the normalizer never produces,
 * which is exactly the class of bug that survives to production.
 */

/** A small document with prose, a fenced block, parameters, a body and two responses. */
export function smallDocument(): IRDocument {
  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: {
      title: 'Orders API',
      version: '2.1.0',
      description: 'Order management.\n\n```json\n{ "ok": true }\n```\n',
    },
    servers: [{ url: 'https://api.example.com' }],
    tags: [{ name: 'orders', description: 'Everything about orders' }],
    paths: {
      '/orders': {
        get: {
          operationId: 'listOrders',
          summary: 'List orders',
          description: 'Returns **every** order.\n\n```yaml\nlimit: 10\n```\n',
          tags: ['orders'],
          parameters: [
            {
              name: 'limit',
              in: 'query',
              required: false,
              description: 'How many to return.',
              schema: { type: 'integer' },
            },
            { name: 'X-Trace', in: 'header', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'A page of orders',
              content: {
                'application/json': {
                  schema: { type: 'array', items: { $ref: '#/components/schemas/Order' } },
                },
              },
            },
            '404': { description: 'Nothing there' },
          },
        },
        post: {
          operationId: 'createOrder',
          summary: 'Create an order',
          tags: ['orders'],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Order' } },
            },
          },
          responses: { '201': { description: 'Created' } },
          security: [{ apiKey: [] }],
        },
      },
    },
    components: {
      securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'X-Key' } },
      schemas: {
        Order: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            total: { type: 'number' },
          },
        },
      },
    },
  });
}

/** A document whose prose is hostile in every way markdown allows. */
export function hostileDocument(): IRDocument {
  const payload =
    'Careful.\n\n<script>globalThis.pwned = true;</script>\n\n' +
    '<img src=x onerror="globalThis.pwned = true">\n\n' +
    '<div style="position:fixed;inset:0">covered</div>\n\n' +
    '[click](javascript:globalThis.pwned=true)\n\n' +
    '<iframe src="https://evil.example"></iframe>\n\n' +
    '```html\n<script>globalThis.pwned = true;</script>\n```\n';

  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Hostile', version: '1.0.0', description: payload },
    paths: {
      '/x': {
        get: {
          operationId: 'getX',
          description: payload,
          responses: { '200': { description: payload } },
        },
      },
    },
  });
}

/**
 * The vocabulary the fixture's prose, paths, schema names and property names are drawn from.
 *
 * IT IS A GRID RATHER THAN A LIST, and that is the part that decides what the budgets measure.
 * A real identifier vocabulary shares substrings the way `payment_intent` and `payment_method`
 * do, and gzip pays for the difference. A flat list of unrelated tokens would make the fixture
 * compress worse than any real document, which is the same defect as compressing better.
 */
const STEMS: readonly string[] = (
  'account address adjustment agreement alert allocation amount appeal attempt balance batch ' +
  'binding bundle capture carrier channel charge checkout claim clearing connector consent ' +
  'contract coupon credit cursor dispatch dispute endpoint entitlement envelope escalation ' +
  'exemption facility gateway grant guarantee holding identity instalment instrument intent ' +
  'invoice journal ledger lookup mandate manifest merchant mutation notice obligation offset ' +
  'payout penalty permit pipeline portfolio posting quota receipt reconciliation refund ' +
  'register reservation reversal rollup schedule segment settlement shipment snapshot statement ' +
  'subledger surcharge terminal threshold tranche transfer treasury valuation voucher waiver ' +
  'warrant window workflow wrapper zone'
).split(' ');

/** The adjectival half of the same grid. */
const QUALIFIERS: readonly string[] = (
  'pending archived draft active expired partial deferred reversed provisional recurring ' +
  'external internal primary secondary legacy scoped nested linked orphaned disputed settled ' +
  'queued throttled sandboxed federated delegated inherited retired staged verified aggregated ' +
  'amended anchored audited backdated batched blocked cancelled capped cleared closed committed ' +
  'compound conditional consolidated contested converted dormant duplicated escrowed evaluated ' +
  'exempt expedited flagged forecast frozen granted guaranteed hedged held hosted imported ' +
  'indexed inflight initial insured invoiced issued itemised lapsed latent matured merged ' +
  'migrated mirrored netted notional offline onboarded opening outstanding overdue paused ' +
  'phased posted prepaid prorated rebooked reconciled redeemed refunded rejected released ' +
  'renewed replayed'
).split(' ');

/** The 8,272 identifiers the grid yields. */
const TERMS: readonly string[] = QUALIFIERS.flatMap((qualifier) =>
  STEMS.map((stem) => `${qualifier}_${stem}`),
);

/**
 * Sentence frames, so the prose repeats function words and phrasing the way real prose does.
 *
 * Drawing words one at a time out of the grid would carry the right vocabulary and the wrong
 * redundancy, and redundancy is the whole of what a gzip figure is sensitive to.
 */
const FRAMES: readonly string[] = [
  'Returns the {t} that the caller is allowed to read, most recent first.',
  'Creates a {t} and attaches it to the {t} that owns it.',
  'The {t} is written once and cannot be changed after the {t} has settled.',
  'Use this when a {t} has to be reconciled against the {t} it was drawn from.',
  'Every {t} carries the {t} it was derived from, so the chain can be walked back.',
  'A {t} that has no {t} yet is returned with an empty list rather than an error.',
  'Pass the identifier of the {t} to narrow the result to a single {t}.',
  'The response is paged, and the cursor points at the next {t} of the {t}.',
  'This does not delete the {t}; it marks the {t} as closed and keeps the history.',
  'If the {t} was already applied, the call is a no-op and returns the stored {t}.',
  'The {t} is quoted in minor units and is never rounded before the {t} is issued.',
  'A {t} raised here is retried until the {t} either clears or expires.',
  'Only a {t} in the same region as the {t} may be linked to it.',
  'The order of the {t} is stable, so two reads of one {t} agree.',
  'Reading a {t} does not lock it, and a concurrent write to the {t} may win.',
  'The {t} leaves the index as soon as the {t} it belongs to is archived.',
  'Supplying a {t} that belongs to another {t} is rejected.',
  'A {t} with no {t} behind it is treated as provisional and is not billed.',
  'Set the {t} to override the default {t} for this call alone.',
  'The webhook fires once per {t}, after the {t} has been committed.',
  'Both the {t} and the {t} come back together, so the caller need not read twice.',
  'The call is idempotent on the key, and a repeat returns the first {t}.',
  'Amounts on the {t} are expressed in the currency of the {t}, not of the caller.',
  'When the {t} expires, the {t} it holds is released on the next sweep.',
];

/** Frames for a description whose drawn length leaves no room for a long one. */
const SHORT_FRAMES: readonly string[] = [
  'Returns the {t}.',
  'Lists every {t}.',
  'Removes the {t}.',
  'Updates one {t}.',
  'Creates a {t}.',
  'The {t} of the {t}.',
];

/** One point of a measured length distribution: cumulative probability, then words. */
type Quantile = readonly [number, number];

/**
 * Operation summary and description length in words, measured over the corpus.
 *
 * Taken across the 1082 operations of `stripe.yaml`, `box.json` and `twilio-api-v2010.yaml`,
 * which are the three largest real references this project holds: 30,519 words, mean 28.2,
 * median 18, ninetieth percentile 59, longest 470.
 */
const OPERATION_LENGTHS: readonly Quantile[] = [
  [0.0, 0],
  [0.1, 8],
  [0.2, 11],
  [0.3, 12],
  [0.4, 14],
  [0.5, 18],
  [0.6, 22],
  [0.7, 30],
  [0.8, 36],
  [0.9, 59],
  [0.95, 81],
  [0.99, 161],
  [1.0, 470],
];

/**
 * Schema description length in words, over the 1893 schemas of the same three documents.
 *
 * Mean 7.6 with a median of 0. Most schemas of a real document carry no description at all and
 * the ones that do carry a paragraph, so a fixture giving every schema one sentence would have
 * the right mean and the wrong shape.
 */
const SCHEMA_LENGTHS: readonly Quantile[] = [
  [0.0, 0],
  [0.5, 0],
  [0.75, 8],
  [0.9, 21],
  [0.99, 100],
  [1.0, 285],
];

/**
 * Property description length in words, over the 9333 properties of the same three documents.
 *
 * Mean 15.3, median 11. This is the largest body of prose in a real reference by a wide margin,
 * five times the operation descriptions put together, and a fixture without it is a different
 * document wearing the same node count.
 */
const PROPERTY_LENGTHS: readonly Quantile[] = [
  [0.0, 0],
  [0.25, 6],
  [0.5, 11],
  [0.75, 20],
  [0.9, 32],
  [0.99, 132],
  [1.0, 298],
];

/** Schemas per operation, measured at 1893 over 1082 across the same three documents. */
const SCHEMAS_PER_OPERATION = 1.75;

/** Properties per schema, measured at 4.93 across the same three documents. */
const PROPERTIES_PER_SCHEMA = 5;

/**
 * How many schemas reference one another.
 *
 * A page reaches a family rather than the registry. Chaining every schema to the next was tried
 * first and is wrong: it makes one page walk the whole document, which is a property of the
 * chain and not of a real reference, and it took the served page to 164 KB against a 64 KB cap.
 */
const SCHEMA_FAMILY = 8;

/** Reads a list at a wrapped index without an assertion the type checker cannot see through. */
function pick<Item>(list: readonly Item[], index: number): Item {
  const value = list[((index % list.length) + list.length) % list.length];
  if (value === undefined) throw new Error('the fixture drew from an empty list');
  return value;
}

/** A linear congruential generator, so every figure SPEC 20 states is reproducible from a seed. */
function sequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state;
  };
}

/** Draws a word count from a measured distribution by inverting its quantile table. */
function lengthFrom(table: readonly Quantile[], probability: number): number {
  for (let index = 1; index < table.length; index += 1) {
    const upper = pick(table, index);
    const lower = pick(table, index - 1);
    if (probability > upper[0] && index < table.length - 1) continue;
    const span = upper[0] - lower[0];
    const position = span === 0 ? 0 : (probability - lower[0]) / span;
    return Math.max(0, Math.round(lower[1] + (upper[1] - lower[1]) * position));
  }
  return 0;
}

/** Draws a probability, so the call sites read as what they are rather than as arithmetic. */
function probability(next: () => number): number {
  return (next() % 100_000) / 100_000;
}

/** Builds prose of about `target` words out of the frames and the term grid. */
function prose(next: () => number, target: number): string {
  if (target <= 0) return '';

  const words: string[] = [];
  let sentences = 0;

  while (words.length < target) {
    const remaining = target - words.length;
    const pool = remaining < 8 ? SHORT_FRAMES : FRAMES;
    const filled = pick(pool, next())
      .split(' ')
      .map((word) => (word.includes('{t}') ? word.replace('{t}', pick(TERMS, next())) : word));
    const slice = filled.slice(0, remaining);
    const first = slice[1];
    if (sentences % 7 === 6 && first !== undefined) slice[1] = `\`${first}\``;
    words.push(...slice);
    sentences += 1;
  }

  const text = words.join(' ');
  return text.endsWith('.') ? text : `${text.replace(/[,;]$/u, '')}.`;
}

/** Turns `pending_invoice` into `PendingInvoice`, which is how a document names a schema. */
function schemaName(term: string): string {
  return term
    .split('_')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join('');
}

/** Builds the schemas, each with its own prose, its own properties and a sibling reference. */
function buildSchemas(count: number): Record<string, Record<string, unknown>> {
  const schemas: Record<string, Record<string, unknown>> = {};
  const names: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const next = sequence(index * 2654435761 + 7);
    const name = schemaName(pick(TERMS, index * 13 + 5));
    const properties: Record<string, unknown> = {
      id: { type: 'string', format: 'uuid', description: prose(next, 6) },
    };

    while (Object.keys(properties).length < PROPERTIES_PER_SCHEMA) {
      properties[pick(TERMS, next())] = {
        type: pick(['string', 'integer', 'boolean', 'number'], next()),
        description: prose(next, lengthFrom(PROPERTY_LENGTHS, probability(next))),
      };
    }

    names.push(name);
    schemas[name] = {
      type: 'object',
      title: name,
      description: prose(next, lengthFrom(SCHEMA_LENGTHS, probability(next))),
      required: ['id'],
      properties,
    };
  }

  names.forEach((name, index) => {
    const family = Math.floor(index / SCHEMA_FAMILY) * SCHEMA_FAMILY;
    const sibling = family + ((index + 1) % SCHEMA_FAMILY);
    if (sibling === index || sibling >= names.length) return;
    const schema = schemas[name];
    const properties = schema?.properties as Record<string, unknown> | undefined;
    if (properties) properties.related = { $ref: `#/components/schemas/${pick(names, sibling)}` };
  });

  return schemas;
}

/**
 * An OpenAPI document of `count` operations, carrying the prose a real reference of that size has.
 *
 * @param count - Number of operations
 * @returns The document, unnormalized, as a host would hand it to `setup`
 */
function largeSpecification(count: number): Record<string, unknown> {
  const schemas = buildSchemas(Math.round(count * SCHEMAS_PER_OPERATION));
  const names = Object.keys(schemas);
  const paths: Record<string, unknown> = {};

  for (let index = 0; index < count; index += 1) {
    const next = sequence(index * 2654435761 + 1);
    const resource = pick(TERMS, index * 7 + 3);
    const summary = `${pick(['Read', 'List', 'Create', 'Replace', 'Archive'], index)} ${resource.replaceAll('_', ' ')}`;
    const target = lengthFrom(OPERATION_LENGTHS, probability(next));

    paths[`/v1/${resource}/{id}`] = {
      get: {
        operationId: `getResource${String(index)}`,
        summary,
        description: prose(next, Math.max(0, target - summary.split(' ').length)),
        tags: [`group-${String(index % 20)}`],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'expand', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Found',
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${pick(names, index)}` },
              },
            },
          },
        },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: { title: 'Large', version: '1.0.0' },
    paths,
    components: { schemas },
  };
}

/**
 * The normalized document of `count` operations that SPEC 20 takes its thousand node budgets on.
 *
 * IT IS THE SAME DOCUMENT `tools/browser-budget` SERVES TO A REAL BROWSER, generator and all, and
 * `tools/browser-budget/test/unit/specification.spec.ts` holds the two to one hash. The two copies
 * exist because one of them has to live in a tool's `src` to be built into a served page and the
 * other has to live in a test fixture; the hash is what keeps them from drifting into two
 * different pages both claiming a thousand nodes.
 *
 * WHAT IT CARRIES IS STATED IN SPEC 20, because a budget whose input is not named cannot be
 * reproduced by anyone, including this project in six months.
 *
 * @param count - Number of operations
 * @returns The normalized document
 */
export function largeDocument(count: number): IRDocument {
  return normalizeOpenApiDocument(largeSpecification(count));
}

/**
 * A document whose schemas refer to each other in a ring, with a discriminated union in it.
 *
 * Three things the schema viewer has to survive are here on purpose. `Node.parent` points back
 * at `Node`, so an expander without a path guard never stops. `Node.owner` reaches `Person`,
 * which reaches `Node` again, which is the two step cycle a single step guard misses. And
 * `Shape` is a `oneOf` with a discriminator mapping, so the variant labels come from the
 * mapping rather than from the branch index.
 *
 * SPEC 5.1.1 puts no `$cycle` marker on any of this: a chain of named references never expands,
 * so there is nothing for the normalizer to mark, and the viewer detects the revisit itself.
 *
 * @returns The normalized document
 */
export function cyclicDocument(): IRDocument {
  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Graph', version: '1.0.0' },
    paths: {
      '/nodes': {
        get: {
          operationId: 'listNodes',
          summary: 'List nodes',
          responses: {
            '200': {
              description: 'Nodes',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Node' } },
              },
            },
          },
        },
        post: {
          operationId: 'createShape',
          summary: 'Create a shape',
          requestBody: {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Shape' } },
            },
          },
          responses: { '201': { description: 'Created' } },
        },
      },
    },
    components: {
      schemas: {
        Node: {
          type: 'object',
          description: 'One node of the graph.',
          required: ['id'],
          properties: {
            id: { type: 'string', readOnly: true },
            label: { type: 'string', writeOnly: true },
            parent: { $ref: '#/components/schemas/Node' },
            owner: { $ref: '#/components/schemas/Person' },
          },
        },
        Person: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            favourite: { $ref: '#/components/schemas/Node' },
          },
        },
        Shape: {
          oneOf: [{ $ref: '#/components/schemas/Circle' }, { $ref: '#/components/schemas/Square' }],
          discriminator: {
            propertyName: 'kind',
            mapping: {
              round: '#/components/schemas/Circle',
              boxy: '#/components/schemas/Square',
            },
          },
        },
        Circle: { type: 'object', properties: { radius: { type: 'number' } } },
        Square: { type: 'object', properties: { side: { type: 'number' } } },
      },
    },
  });
}

/**
 * A response whose properties are written as `@nestjs/swagger` writes a described reference.
 *
 * The singleton `allOf` around a reference, per SPEC 5.1.1 and retrofit T003-R2. It is here as
 * an OpenAPI 3.0 document because that is the dialect that produces the shape: a sibling of
 * `$ref` is ignored in 3.0, so a tool with a description to attach wraps the reference instead.
 *
 * @returns The normalized document
 */
export function wrappedReferenceDocument(): IRDocument {
  return normalizeOpenApiDocument({
    openapi: '3.0.3',
    info: { title: 'Orders', version: '1.0.0' },
    paths: {
      '/orders/{id}': {
        get: {
          operationId: 'getOrder',
          summary: 'Get an order',
          responses: {
            '200': {
              description: 'The order',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/OrderDto' } },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        CustomerDto: {
          type: 'object',
          description: 'The target says this.',
          properties: { id: { type: 'string' }, email: { type: 'string' } },
        },
        OrderDto: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            customer: {
              allOf: [{ $ref: '#/components/schemas/CustomerDto' }],
              description: 'Who placed it.',
            },
          },
        },
      },
    },
  });
}

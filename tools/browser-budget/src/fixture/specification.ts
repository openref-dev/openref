/**
 * The documents the browser budgets are measured against.
 *
 * SPEC 20 names two sizes and they are not the same document. The page budgets are taken on a
 * thousand nodes, which is a shape rather than a real API, so it is generated. Peak client memory
 * is budgeted on a document of about seven megabytes, which is a real one: `stripe.yaml` in the
 * corpus is 6.4 MB of source and the largest thing this project has ever normalized.
 *
 * WHAT THE GENERATED ONE CARRIES IS PART OF EVERY BUDGET TAKEN ON IT, and it is stated in SPEC 20
 * rather than left to whoever reads this file. Until 2026-08-11 it carried one description of four
 * words repeated a thousand times and a single schema, which is the input gzip flatters most: the
 * search index measured 43 KB against a 250 KB cap and read as 5.8x of headroom that no real
 * document has. Every constant below is measured over the corpus instead of chosen, and the file
 * says which document each figure came from.
 *
 * THE GENERATED ONE IS ALSO THE SAME SHAPE THE jsdom CEILINGS USE. `largeDocument` in
 * `packages/render/test/mocks/documents.ts` builds the same specification and normalizes it, and
 * `test/unit/specification.spec.ts` asserts the two produce one document hash. Two generators
 * drifting apart would leave the loose ceiling in CI and the browser figure here measuring
 * different pages while both claimed to measure a thousand nodes.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repositoryRoot } from '../repo-root.js';

/** Nodes SPEC 20 takes the thousand node budgets on. */
export const TTI_NODE_COUNT = 1000;

/**
 * Nodes the security proofs run against.
 *
 * Small, because none of them is about size: a policy either authorizes an inline style or it
 * does not, and a page of a thousand nodes proves that no better than a page of twelve while
 * costing a minute of normalization in every run. The shape is the same generator, so a proof
 * and a budget are still looking at the same kind of page.
 */
export const PROOF_NODE_COUNT = 12;

/** The corpus document SPEC 20's memory figure is about, relative to the repository root. */
export const MEMORY_DOCUMENT = 'packages/core/test/corpus/documents/stripe.yaml';

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
export function largeSpecification(count: number): Record<string, unknown> {
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
 * Reads the corpus document the memory budget is measured against.
 *
 * Handed over as text, which is what a host with a specification file has, and is also what
 * makes the parse part of what is measured.
 *
 * @returns The source of `stripe.yaml`
 */
export function memorySpecification(): string {
  return readFileSync(join(repositoryRoot(), MEMORY_DOCUMENT), 'utf8');
}

/** The address of the one channel the socket console is proved on. */
export const CHANNEL_ADDRESS = 'orders.created';

/** The name the channel's message carries, which is what a page prints beside it. */
export const CHANNEL_MESSAGE_NAME = 'OrderAccepted';

/**
 * What the fixture's socket pushes the moment a session opens.
 *
 * PUSHED AS WELL AS ECHOED, so the receive half of the window is proved without the reader having
 * to send first. It is the payload the channel's message declares, so nothing about it is a shape
 * the document does not describe.
 */
export const CHANNEL_GREETING = '{"id":"ord_1024","quantity":2}';

/**
 * An events document of one channel, whose server is the fixture's own socket.
 *
 * WHY THERE IS A FOURTH DOCUMENT AND WHAT IT IS NOT. It is not a budget document and no figure is
 * taken on it: `runStudy` boots `large` and `memory` and nothing else, so nothing measured moves
 * because this exists. It is here because the deferred socket console of SPEC 14.7 is a channel
 * page's, and no page this harness could open had a channel on it, which is the whole of what the
 * `T065` section addressed to `TX-SOCKET-CONSOLE` recorded as unproved.
 *
 * THE SERVER IS THE PAGE'S OWN ORIGIN, AND THAT IS LOAD BEARING TWICE. Under the strict policy of
 * SPEC 19.2 a `connect-src 'self'` admits a socket to the origin the page came from and refuses
 * every other, so a cross origin fixture would either need the policy widened for a test or would
 * prove that the recommended policy blocks the console. And an origin is only known once the
 * server is listening, which is why the host is a parameter rather than a constant.
 *
 * @param socketHost - Host and port of the fixture, as `127.0.0.1:5173`
 * @returns The document, unnormalized, as a host would hand it to `setup`
 */
export function channelSpecification(socketHost: string): Record<string, unknown> {
  return {
    asyncapi: '3.0.0',
    info: {
      title: 'Orders events',
      version: '1.0.0',
      description: 'One channel, so a reader has a console to press.',
    },
    servers: {
      page: {
        host: socketHost,
        protocol: 'ws',
        description: 'the socket this fixture answers on, at the origin serving this page',
      },
    },
    channels: {
      ordersCreated: {
        address: CHANNEL_ADDRESS,
        title: 'Order accepted',
        summary: 'An order was accepted',
        servers: [{ $ref: '#/servers/page' }],
        messages: { accepted: { $ref: '#/components/messages/OrderAccepted' } },
      },
    },
    operations: {
      receiveOrderAccepted: {
        action: 'receive',
        channel: { $ref: '#/channels/ordersCreated' },
        summary: 'Receive an accepted order',
      },
    },
    components: {
      messages: {
        OrderAccepted: {
          name: CHANNEL_MESSAGE_NAME,
          title: 'Order accepted',
          contentType: 'application/json',
          payload: { $ref: '#/components/schemas/OrderAccepted' },
        },
      },
      schemas: {
        OrderAccepted: {
          type: 'object',
          title: CHANNEL_MESSAGE_NAME,
          required: ['id'],
          properties: {
            id: { type: 'string' },
            quantity: { type: 'integer' },
          },
        },
      },
    },
  };
}

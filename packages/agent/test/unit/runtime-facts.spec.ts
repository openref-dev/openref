import { describe, expect, it } from 'vitest';
import { RUNTIME_FACT_FIELDS, type IRNodeRuntime, type RuntimeFactField } from '@openref/core';
import { buildLlmsFull, plainSummary, SUMMARY_LIMIT, type LlmsTextOptions } from '../../src/index';
import { documentCarrying, documentWithFacts, orderDocument } from '../mocks/documents';

const mounted: LlmsTextOptions = { basePath: '/docs', agent: { llmsTxt: true, mcp: false } };

/**
 * One runtime record per fact of the IR, each carrying only that fact.
 *
 * A TOTAL `Record` OVER {@link RuntimeFactField} AND NOT A `Record<string, ...>`, which is the half
 * of this check that runs at compile time. `runtime-view.spec.ts` in `@openref/core` writes the
 * loose form because a missing key there still reddens its own sweep; here the sweep is over a
 * generator that could plausibly grow an entry and no fixture, so the fixture is what has to refuse
 * a fifteenth fact. A field added to `IRNodeRuntime` widens `RuntimeFactField`, and this object
 * stops compiling until somebody writes the record that proves the new fact prints.
 */
const ONE_FACT_EACH: Readonly<Record<RuntimeFactField, IRNodeRuntime>> = {
  source: {
    source: { controller: 'OrdersController', handler: 'findAll', file: 'orders.ts', line: 12 },
  },
  guards: {
    guards: [{ name: 'JwtAuthGuard', scope: 'route', confidence: 'derived', collector: 'guards' }],
  },
  pipes: {
    pipes: [{ name: 'TrimPipe', scope: 'route', confidence: 'derived', collector: 'pipes' }],
  },
  scopes: { scopes: { value: ['orders:read'], confidence: 'declared', collector: 'scopes' } },
  roles: { roles: { value: ['admin'], confidence: 'derived', collector: 'roles' } },
  rateLimit: {
    rateLimit: { value: { limit: 100, ttlMs: 60_000 }, confidence: 'derived', collector: 't' },
  },
  rateLimitReach: {
    rateLimitReach: { value: { kind: 'none' }, confidence: 'derived', collector: 't' },
  },
  handlerPolicies: {
    handlerPolicies: [
      {
        kind: 'cache',
        key: 'orders:{0}',
        settings: [{ name: 'ttlMs', value: 60_000 }],
        reach: 'handler',
        confidence: 'derived',
        collector: 'redisxCacheCollector',
      },
    ],
  },
  timeout: { timeout: { value: { ms: 5000 }, confidence: 'derived', collector: 'timeout' } },
  requiredHeaders: {
    requiredHeaders: { value: ['If-Match'], confidence: 'inferred', collector: 'headers' },
  },
  parameterReads: {
    parameterReads: {
      value: { parameters: [{ in: 'query', name: 'sort', verdict: 'read' }] },
      confidence: 'inferred',
      collector: 'scan',
    },
  },
  statusCode: { statusCode: { value: 201, confidence: 'derived', collector: 'httpCode' } },
  errors: {
    errors: {
      declared: [
        {
          status: 404,
          title: 'Not found',
          origin: 'declared',
          confidence: 'declared',
          collector: 'errorsCollector',
        },
      ],
      runtimeDerived: [],
      global: [],
    },
  },
  streaming: {
    streaming: { value: { transport: 'sse' }, confidence: 'declared', collector: 's' },
  },
};

/**
 * The `- ` lines under the one `Runtime:` heading of a built `llms-full.txt`.
 *
 * THE RUN STOPS AT THE FIRST LINE THAT IS NOT ONE, which is not tidiness. A filter over every `- `
 * line after the heading also collects the response list further down the same section, so a fact
 * that printed nothing at all still came back with lines beside it and the sweep below passed on
 * it. That was measured on the first run of this file rather than reasoned about.
 */
function factLinesOf(full: string): readonly string[] {
  const after = (full.split('Runtime:')[1] ?? '').split('\n').slice(1);
  const stop = after.findIndex((line) => !line.startsWith('- '));

  return stop === -1 ? after : after.slice(0, stop);
}

describe('the runtime facts llms-full.txt prints', () => {
  it('should print every fact with its confidence and the collector that produced it', () => {
    // Given a document a collector pass ran over, per SPEC 6.1: a value with no provenance is not
    // representable, and a machine reader of these lines is deciding what to trust
    const document = documentWithFacts();

    // When
    const full = buildLlmsFull(document, mounted);

    // Then
    expect(full).toContain('- scopes: orders:read (declared, scopesCollector)');
    expect(full).toContain('- roles: support (derived, rolesCollector)');
    expect(full).toContain('- rate limit: 10 per 60000 ms (derived, throttlerCollector)');
    expect(full).toContain('- timeout: 5000 ms (derived, timeoutCollector)');
    expect(full).toContain('- required headers: x-tenant (derived, headersCollector)');
    expect(full).toContain('- success status: 200 (declared, declarationsCollector)');
    expect(full).toContain('- streaming: sse of Order (declared, streamCollector)');
    expect(full).toContain('- guard: JwtAuthGuard (derived, guardsCollector)');
  });

  it('should print a line for every fact of RUNTIME_FACT_FIELDS, one fact at a time', () => {
    // Given, the presence half first: the fixture really does carry one record per fact the IR
    // names, so what follows is a sweep over a set that is there rather than over an empty one.
    // This case is what a fifteenth fact meets. It went red on the eight fact version of
    // `runtimeLines`, naming source, pipes, rateLimitReach, handlerPolicies, parameterReads and
    // errors, which is exactly the six a hand written list had drifted behind.
    expect(Object.keys(ONE_FACT_EACH).sort()).toEqual([...RUNTIME_FACT_FIELDS].sort());
    expect(RUNTIME_FACT_FIELDS).toHaveLength(14);

    // When each fact is put on a route on its own and the file is built over it
    const missed = RUNTIME_FACT_FIELDS.filter(
      (field) =>
        factLinesOf(buildLlmsFull(documentCarrying(ONE_FACT_EACH[field]), mounted)).length === 0,
    );

    // Then nothing in the IR reaches this surface unprinted
    expect(missed).toEqual([]);
  });

  it('should print all fourteen facts at once, in the order the IR names them', () => {
    // Given every fact on one route, which is the shape a fully instrumented application produces
    const everyFact: IRNodeRuntime = Object.assign(
      {},
      ...RUNTIME_FACT_FIELDS.map((field) => ONE_FACT_EACH[field]),
    );
    expect(Object.keys(everyFact)).toHaveLength(14);

    // When
    const lines = factLinesOf(buildLlmsFull(documentCarrying(everyFact), mounted));

    // Then, one line per fact, in `RUNTIME_FACT_FIELDS` order rather than an order written here
    expect(lines).toEqual([
      '- source: OrdersController.findAll() at orders.ts:12',
      '- guard: JwtAuthGuard (derived, guards)',
      '- pipe, route: TrimPipe (derived, pipes)',
      '- scopes: orders:read (declared, scopes)',
      '- roles: admin (derived, roles)',
      '- rate limit: 100 per 60000 ms (derived, t)',
      '- rate limit reach: Not rate limited. This route declares no limit and nothing stands in front of the whole application. (derived, t)',
      '- handler policy: cache on orders:{0} (ttlMs 60000) (derived, redisxCacheCollector)',
      '- timeout: 5000 ms (derived, timeout)',
      '- required headers: If-Match (inferred, headers)',
      '- parameter reads: 1 of 1 seen read (inferred, scan)',
      '- success status: 201 (derived, httpCode)',
      '- error, declared: 404 Not found (declared, errorsCollector)',
      '- streaming: sse (declared, s)',
    ]);
  });

  it('should name which collectors ran, once, at the top', () => {
    // Given
    const document = documentWithFacts();

    // When
    const full = buildLlmsFull(document, mounted);

    // Then
    expect(full).toContain('Runtime facts were collected by: scopesCollector, throttlerCollector.');
    expect(full).toContain('carries its confidence and the collector that produced it');
  });

  it('should say a pass ran and stated nothing rather than leaving the reader to guess', () => {
    // Given a document a pass ran over, where one operation gathered no fact at all: "no fact"
    // and "no pass" are different, and only a document with a pass can carry the first
    const document = documentWithFacts();

    // When
    const full = buildLlmsFull(document, mounted);

    // Then
    expect(full).toContain('Runtime: no collector stated anything about this operation.');
  });

  it('should say nothing about runtime at all on a document no pass ever touched', () => {
    // Given, the presence half of the case above: without it, the sentence and its absence would
    // be indistinguishable
    const document = orderDocument();
    expect(document.runtime).toBeUndefined();

    // When
    const full = buildLlmsFull(document, mounted);

    // Then
    expect(full).not.toContain('Runtime');
  });
});

describe('plainSummary', () => {
  it('should cut a long description at a word boundary and mark the cut', () => {
    // Given a description longer than the limit
    const written = `${'word '.repeat(80)}end`;

    // When
    const summary = plainSummary(written);

    // Then, cutting mid word would produce a fragment a reader cannot resolve
    expect(summary.length).toBeLessThanOrEqual(SUMMARY_LIMIT + 3);
    expect(summary.endsWith('...')).toBe(true);
    expect(summary).not.toContain('  ');
  });

  it('should cut at the limit when the text carries no space to cut at', () => {
    // Given, a single token longer than the limit, which has no word boundary to find
    const written = 'x'.repeat(SUMMARY_LIMIT + 50);

    // When
    const summary = plainSummary(written);

    // Then
    expect(summary).toBe(`${'x'.repeat(SUMMARY_LIMIT)}...`);
  });

  it('should flatten a fenced block, an image and a link to what a reader would read', () => {
    // Given
    const written = '# Title\n\n```ts\nconst a = 1;\n```\n\n![alt](a.png) and [text](https://x)';

    // When
    const summary = plainSummary(written);

    // Then
    expect(summary).toBe('Title alt and text');
  });
});

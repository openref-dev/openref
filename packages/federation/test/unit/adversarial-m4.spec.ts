import { describe, expect, it } from 'vitest';
import {
  ErrorCode,
  federatedSchemaId,
  InvalidOptionsError,
  MergeConflictError,
  normalizeOpenApiDocument,
  OpenRefError,
  parseSpecification,
} from '@openref/core';
import type { IRJsonSchema, IRSchema } from '@openref/core';
import {
  classifySchemas,
  FetchRemoteAdapter,
  mergeDocuments,
  readCacheRecord,
  RemoteLifecycleService,
} from '../../src/index';
import type {
  FederationService,
  RemoteBodyReaderLike,
  RemoteFetchLike,
  RemoteResponseLike,
} from '../../src/index';
import { SCHEMA_REFINEMENT_MAX_ROUNDS } from '../../src/merge/domain/schema-identity';
import { buildDocument, namedSchema, operation } from '../mocks/documents';
import { getOperation, openApiBody, SerializingCacheDriver } from '../mocks/remotes';

/**
 * M4 under attack, per `T047`: the merge engine, the remote lifecycle and the things a hostile or
 * merely unlucky service can do to them.
 *
 * NOT ORDINARY TESTS. Each case here is an input that was tried against the implementation before
 * anything was written down, and four of them were red when they were first run. Those four are
 * marked with what they measured, because a regression case whose finding is not stated reads a
 * year later as a test of something that was always true.
 */

const MERGED = { id: 'platform', info: { title: 'Platform', version: '2026.8' } } as const;
const URL_A = 'https://a.example.com/openapi.json';

/** A response built from a body stream, for the fetch implementations below. */
function streamedResponse(reader: RemoteBodyReaderLike): RemoteResponseLike {
  return {
    status: 200,
    headers: { get: (): string | null => null },
    body: { getReader: () => reader },
    text: (): Promise<string> => Promise.resolve(''),
  };
}

/** A chain of `count` schemas, each referring to the next, differing only at the leaf. */
function chain(count: number, leaf: string): IRSchema[] {
  const schemas: IRSchema[] = [];
  for (let index = 0; index < count; index += 1) {
    const body: IRJsonSchema =
      index === count - 1
        ? { type: 'object', properties: { [leaf]: { type: 'string' } } }
        : { type: 'object', properties: { next: { $ref: `S${String(index + 1)}` } } };
    schemas.push(namedSchema(`S${String(index)}`, body));
  }
  return schemas;
}

/** Two services carrying that chain, which is the input the refinement bound was measured on. */
function chainedServices(count: number): FederationService[] {
  return [
    {
      id: 'a',
      document: buildDocument({
        id: 'a-api',
        nodes: [operation({ id: 'x', path: '/x' })],
        schemas: chain(count, 'one'),
      }),
    },
    {
      id: 'b',
      document: buildDocument({
        id: 'b-api',
        nodes: [operation({ id: 'y', path: '/y' })],
        schemas: chain(count, 'two'),
      }),
    },
  ];
}

describe('a remote that answers with far more than a document', () => {
  it('should hold a bounded amount of a 400 MB answer and degrade like a remote that is down', async () => {
    // Given a remote that will produce four hundred megabytes, one at a time, forever
    const megabyte = new Uint8Array(1024 * 1024).fill(0x20);
    let produced = 0;
    const fetchImpl: RemoteFetchLike = () =>
      Promise.resolve(
        streamedResponse({
          read: (): Promise<{ done: boolean; value?: Uint8Array }> => {
            produced += 1;
            return Promise.resolve({ done: produced > 400, value: megabyte });
          },
          cancel: (): Promise<void> => Promise.resolve(),
        }),
      );

    const lifecycle = new RemoteLifecycleService({
      remotes: [{ id: 'a', url: URL_A }],
      document: MERGED,
      fetcher: new FetchRemoteAdapter({ fetch: fetchImpl }),
    });

    // When the first round runs
    await lifecycle.start();
    const [state] = lifecycle.snapshot().remotes;
    lifecycle.stop();

    // Then the remote really did offer more than the ceiling, so the refusal is about this body
    expect(produced).toBeGreaterThan(32);
    // And what was held is the ceiling and not what the remote chose to send
    expect(produced).toBeLessThan(400);
    // And the outcome is the outcome of a remote that is down: recorded, named, not a crash
    expect(state?.status).toBe('failed');
    expect(state?.lastError?.code).toBe(ErrorCode.FED_REMOTE_UNAVAILABLE);
    expect(state?.lastError?.message).toContain('larger than');
  });
});

describe('a remote that accepts the connection and never closes it', () => {
  it('should stop reading a trickling body when the lifecycle gives up on it', async () => {
    // Given a remote that sends one byte at a time and never finishes
    let reads = 0;
    let cancelled = false;
    const reader: RemoteBodyReaderLike = {
      read: (): Promise<{ done: boolean; value?: Uint8Array }> => {
        reads += 1;
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({ done: false, value: new TextEncoder().encode('x') });
          }, 1);
        });
      },
      cancel: (): Promise<void> => {
        cancelled = true;
        return Promise.resolve();
      },
    };

    const adapter = new FetchRemoteAdapter({
      fetch: () => Promise.resolve(streamedResponse(reader)),
    });
    const controller = new AbortController();
    const outcome = adapter.fetch({ url: URL_A, signal: controller.signal }).then(
      () => 'answered',
      (error: unknown) => (error as Error).message,
    );

    // When the caller's deadline passes, which is what the lifecycle does at `timeoutMs`
    await new Promise((resolve) => setTimeout(resolve, 20));
    const readsWhileRunning = reads;
    controller.abort(new Error('the lifecycle gave up'));
    const result = await outcome;
    const readsAtAbort = reads;
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Then the body really was being read, which is what makes the stop below a fact
    expect(readsWhileRunning).toBeGreaterThan(1);
    // MEASURED BEFORE THE FIX: reads went on from 19 to 45 in the 30 ms after the abort and
    // `cancel` was never called, so every timed out attempt left a connection filling a string
    // while the next poll opened another.
    expect(reads).toBe(readsAtAbort);
    expect(cancelled).toBe(true);
    expect(result).toBe('the lifecycle gave up');
  });
});

describe('a remote behind a redirect chain', () => {
  it('should record the chain that never ends as an unreachable remote', async () => {
    // Given a fetch that follows hops until the platform refuses to follow more
    let hops = 0;
    const fetchImpl: RemoteFetchLike = (_url, init) => {
      hops += 1;
      expect(init.redirect).toBe('follow');
      return Promise.reject(new TypeError('fetch failed: too many redirects'));
    };

    const lifecycle = new RemoteLifecycleService({
      remotes: [{ id: 'a', url: URL_A }],
      document: MERGED,
      fetcher: new FetchRemoteAdapter({ fetch: fetchImpl }),
    });

    // When the round runs
    await lifecycle.start();
    const snapshot = lifecycle.snapshot();
    lifecycle.stop();

    // Then the request was made, so the failure below is this remote's rather than a skipped call
    expect(hops).toBe(1);
    // And the page says the same thing it says about a remote that refused the connection
    expect(snapshot.availability).toBe('unavailable');
    expect(snapshot.remotes[0]?.lastError?.code).toBe(ErrorCode.FED_REMOTE_UNAVAILABLE);
  });
});

describe('a document that calls every operation by one name', () => {
  it('should keep every operation of both services rather than collapse them', () => {
    // Given a document whose ten operations all declare the same operationId
    const paths: Record<string, unknown> = {};
    for (let index = 0; index < 5; index += 1) {
      paths[`/p${String(index)}`] = {
        get: { operationId: 'same', responses: { '200': { description: 'ok' } } },
        post: { operationId: 'same', responses: { '200': { description: 'ok' } } },
      };
    }
    const document = normalizeOpenApiDocument(
      parseSpecification(
        JSON.stringify({ openapi: '3.1.0', info: { title: 'H', version: '1' }, paths }),
      ),
      { documentId: 'h' },
    );

    // Then the document itself keeps ten nodes, which is what makes the merge below meaningful
    expect(document.nodes.size).toBe(10);

    // When the same document is federated twice, under two service ids
    const { document: merged } = mergeDocuments(
      [
        { id: 'a', document },
        { id: 'b', document },
      ],
      MERGED,
    );

    // Then all twenty are addressable, and no two share an id or an address
    expect(merged.nodes.size).toBe(20);
    const addresses = [...merged.nodes.values()].map((node) =>
      node.kind === 'operation' ? `${node.method} ${node.path}` : node.id,
    );
    expect(new Set(addresses).size).toBe(20);
  });
});

describe('a service id carrying the separator another name space prefixes with', () => {
  it('should move the second claimant of a navigation id and report the move', () => {
    // Given a service `a` whose node is called `group-b`, so its navigation entry wants
    // `nav-a_group-b`, and a service `nav-a` whose tag group is called `group-b`, so its entry
    // wants `nav-a_group-b` as well. Service ids may carry `-`, which is what makes the two meet.
    const plain = buildDocument({
      id: 'a-api',
      nodes: [operation({ id: 'group-b', path: '/x', tags: ['b'] })],
    });
    const navish = buildDocument({
      id: 'nav-a-api',
      nodes: [operation({ id: 'q', path: '/q', tags: ['b'] })],
    });

    // When they are merged
    const { document, report } = mergeDocuments(
      [
        { id: 'a', document: plain },
        { id: 'nav-a', document: navish },
      ],
      MERGED,
    );

    // Then both entries are in the navigation under ids of their own
    const ids: string[] = [];
    const walk = (
      entries: readonly { readonly id: string; readonly children: unknown }[],
    ): void => {
      for (const entry of entries) {
        ids.push(entry.id);
        walk(entry.children as readonly { readonly id: string; readonly children: unknown }[]);
      }
    };
    walk(document.navigation);
    expect(ids).toContain('nav-a_group-b');
    expect(ids).toContain('nav-a_group-b_2');
    expect(new Set(ids).size).toBe(ids.length);

    // And the escape is in the report rather than silent, which is what a reader of a changed
    // address has to be able to look up
    expect(report.renames).toContainEqual({
      kind: 'navigation',
      serviceId: 'nav-a',
      from: 'group-b',
      to: 'nav-a_group-b_2',
      reason: 'uniqueness',
      contestedBy: [],
    });
  });
});

describe('a remote naming its own schema in another service id space', () => {
  it('should escape the forged marker rather than let it claim the other service name', () => {
    // Given a hostile document that names a schema exactly as the merge would name service `a`'s
    const forged = federatedSchemaId('a', 'Money');
    const hostile = normalizeOpenApiDocument(
      parseSpecification(
        JSON.stringify({
          openapi: '3.1.0',
          info: { title: 'Hostile', version: '1' },
          paths: {
            '/h': { get: { operationId: 'h', responses: { '200': { description: 'ok' } } } },
          },
          components: { schemas: { [forged]: { type: 'string' } } },
        }),
      ),
      { documentId: 'b' },
    );

    // Then the schema is there, so what follows is about its id rather than about a dropped schema
    expect(hostile.schemas.size).toBe(1);
    const [hostileId] = [...hostile.schemas.keys()];

    // And the id it got is the escaped form, which no federated construction can produce
    expect(hostileId).toBe(`~~s${forged.slice(2, 10)}~~Money`);
    expect(hostileId).not.toBe(forged);

    // And merging it beside a service `a` that really has a `Money` leaves three distinct ids
    const owner = buildDocument({
      id: 'a-api',
      nodes: [operation({ id: 'm', path: '/m' })],
      schemas: [namedSchema('Money', { type: 'integer' })],
    });
    const { document } = mergeDocuments(
      [
        { id: 'a', document: owner },
        { id: 'b', document: hostile },
      ],
      MERGED,
    );
    const ids = [...document.schemas.keys()];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(hostileId);
  });
});

describe('a document built to make deduplication expensive', () => {
  it('should bound the refinement and stop deduplicating rather than merge what it cannot tell apart', () => {
    // Given two services whose schema names agree and whose chains differ deeper than the bound
    const deep = chainedServices(SCHEMA_REFINEMENT_MAX_ROUNDS + 20);
    const entries = deep.flatMap((service) =>
      [...service.document.schemas].map(([schemaId, schema]) => ({
        serviceId: service.id,
        schemaId,
        schema,
      })),
    );

    // Then the input really is one the refinement cannot finish, so the bound is what stops it
    expect(entries.length).toBe((SCHEMA_REFINEMENT_MAX_ROUNDS + 20) * 2);

    // When they are classified
    const classes = classifySchemas(entries);

    // Then nothing was merged that the bounded pass could not tell apart
    expect(classes.length).toBe(entries.length);
    expect(classes.every((schemaClass) => schemaClass.members.length === 1)).toBe(true);
  });

  it('should still deduplicate a model whose difference is inside the bound', () => {
    // Given two services carrying one identical shallow model
    const shared = [
      namedSchema('Money', { type: 'object', properties: { amount: { $ref: 'Amount' } } }),
      namedSchema('Amount', { type: 'integer' }),
    ];
    const left = buildDocument({
      id: 'a-api',
      nodes: [operation({ id: 'x', path: '/x' })],
      schemas: shared,
    });
    const right = buildDocument({
      id: 'b-api',
      nodes: [operation({ id: 'y', path: '/y' })],
      schemas: shared,
    });

    // When they are merged
    const { document, report } = mergeDocuments(
      [
        { id: 'a', document: left },
        { id: 'b', document: right },
      ],
      MERGED,
    );

    // Then the bound did not turn deduplication off: one Money, one Amount, both shared
    expect([...document.schemas.keys()].sort()).toEqual(['Amount', 'Money']);
    expect(report.deduplicated.map((entry) => entry.schemaId).sort()).toEqual(['Amount', 'Money']);
  });

  it('should stop at the bound on the chain the defect was measured on, alike pair included', () => {
    // MEASURED BEFORE THE FIX, on this input at these sizes: 50 schemas a service took 43 ms, 100
    // took 131, 200 took 507, 400 took 2016 and 800 took 8257, four times the work for twice the
    // input, synchronously, inside the process that serves pages. This case first asserted a
    // 2000 ms wall clock ceiling over the merge; the post-close review of T047 measured that
    // ceiling failing at 2262 ms on healthy code under coverage instrumentation, which is a test
    // sending someone to fix code that is not broken. So the property is asserted as what the
    // bound produces rather than as what the wall clock read.
    //
    // Given the chains at the size the defect was measured on, plus one identical Money model in
    // both services. THE PAIR IS WHAT MAKES AN UNBOUNDED IMPLEMENTATION FAIL HERE: only a pass
    // that kept refining to the 799th round can certify the pair identical and deduplicate it,
    // so such a pass returns 1601 schemas with Money deduplicated, and the bounded one returns
    // 1602 with nothing deduplicated, per the conservative direction
    // SCHEMA_REFINEMENT_MAX_ROUNDS records. It also grinds those 799 rounds out inside the
    // timeout below, which is the hang catcher the wall clock ceiling was for.
    const money = namedSchema('Money', { type: 'integer' });
    const services: FederationService[] = [
      {
        id: 'a',
        document: buildDocument({
          id: 'a-api',
          nodes: [operation({ id: 'x', path: '/x' })],
          schemas: [...chain(800, 'one'), money],
        }),
      },
      {
        id: 'b',
        document: buildDocument({
          id: 'b-api',
          nodes: [operation({ id: 'y', path: '/y' })],
          schemas: [...chain(800, 'two'), money],
        }),
      },
    ];

    // When they are merged
    const { document, report } = mergeDocuments(services, MERGED);

    // Then the rounds ran out while the partition was still splitting, so every schema is its
    // own component and none was merged on a signature the pass could not finish refining
    expect(document.schemas.size).toBe(1602);
    expect(report.deduplicated).toEqual([]);
  }, 60_000);
});

describe('an interval a timer cannot hold', () => {
  it('should refuse a refreshMs whose backoff overflows the timer rather than poll in a hot loop', () => {
    // MEASURED BEFORE THE FIX: a refreshMs of 2 147 484 648 produced 44 fetches in 60 ms, because
    // a delay past 2^31-1 ms does not wait, it fires at once. Through the eightfold backoff the
    // hot loop starts at about 3.1 days rather than at 24.9.
    const build = (refreshMs: number): RemoteLifecycleService =>
      new RemoteLifecycleService({
        remotes: [{ id: 'a', url: URL_A }],
        document: MERGED,
        refreshMs,
        fetcher: { fetch: (): Promise<never> => Promise.reject(new Error('down')) },
      });

    // Given the largest interval whose eight backoff steps still fit, it is accepted
    const largest = Math.floor((2 ** 31 - 1) / 8);
    expect(() => build(largest)).not.toThrow();

    // When one millisecond more is configured
    // Then it is refused by name, with the reason in the message
    expect(() => build(largest + 1)).toThrow(InvalidOptionsError);
    expect(() => build(largest + 1)).toThrow(/refreshMs is \d+ ms and the limit is/u);
  });

  it('should refuse a timeoutMs a timer cannot hold rather than cut off every answer at once', () => {
    // MEASURED BEFORE THE FIX: the same size of timeout aborted an answer that arrived in 20 ms
    // and recorded "did not answer inside 2147484648 ms", which is untrue about the remote.
    const build = (timeoutMs: number): RemoteLifecycleService =>
      new RemoteLifecycleService({
        remotes: [{ id: 'a', url: URL_A }],
        document: MERGED,
        timeoutMs,
        fetcher: { fetch: (): Promise<never> => Promise.reject(new Error('down')) },
      });

    expect(() => build(2 ** 31 - 1)).not.toThrow();
    expect(() => build(2 ** 31)).toThrow(InvalidOptionsError);
  });
});

describe('a cache record somebody else wrote', () => {
  it('should refuse a fetchedAt that is not a moment in time, by name', () => {
    // MEASURED BEFORE THE FIX: this value reached the remote state and `<mount>/_federation`
    // unaltered, under the name of a fetch time.
    const planted = {
      url: URL_A,
      fetchedAt: '<img src=x onerror=alert(1)>',
      body: openApiBody('A', { '/a': getOperation('a') }),
    };

    // Then the record is otherwise complete, so what is refused below is the one field
    expect(() =>
      readCacheRecord({ ...planted, fetchedAt: new Date(0).toISOString() }),
    ).not.toThrow();

    let refused: unknown;
    try {
      readCacheRecord(planted);
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(OpenRefError);
    expect((refused as OpenRefError).code).toBe(ErrorCode.FED_CACHE_INVALID);
    expect((refused as Error).message).toContain('not a moment in time');
  });

  it('should serve a record whose clock disagrees with this one, because a record has no expiry', async () => {
    // Given a record stamped a century from now, which a clock comparison would reject
    const future = new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000).toISOString();
    const cache = new SerializingCacheDriver();
    cache.plant(
      'a',
      JSON.stringify({
        url: URL_A,
        fetchedAt: future,
        body: openApiBody('A', { '/a': getOperation('a') }),
      }),
    );

    const lifecycle = new RemoteLifecycleService({
      remotes: [{ id: 'a', url: URL_A }],
      document: MERGED,
      fetcher: { fetch: (): Promise<never> => Promise.reject(new Error('down')) },
      cache,
    });

    // When the process starts with the remote down
    await lifecycle.start();
    const snapshot = lifecycle.snapshot();
    lifecycle.stop();

    // Then the cached version is served, marked as this process not having confirmed it
    expect(snapshot.availability).toBe('ready');
    const [state] = snapshot.remotes;
    expect(state?.version?.fetchedAt).toBe(future);
    expect(state?.version?.fromCache).toBe(true);
    expect(state?.status).toBe('degraded');
  });
});

describe('the fail mode refusal', () => {
  it('should carry the merge conflict code and not only the sentence', () => {
    // Given two services claiming one path, under the mode that refuses to rename
    const left = buildDocument({
      id: 'a-api',
      nodes: [operation({ id: 'status', path: '/status' })],
    });
    const right = buildDocument({
      id: 'b-api',
      nodes: [operation({ id: 'status', path: '/status' })],
    });

    let refused: unknown;
    try {
      mergeDocuments(
        [
          { id: 'a', document: left },
          { id: 'b', document: right },
        ],
        { ...MERGED, onConflict: 'fail' },
      );
    } catch (error) {
      refused = error;
    }

    // Then the refusal is the named class carrying the named code
    expect(refused).toBeInstanceOf(MergeConflictError);
    expect((refused as MergeConflictError).code).toBe(ErrorCode.FED_MERGE_CONFLICT);
  });
});

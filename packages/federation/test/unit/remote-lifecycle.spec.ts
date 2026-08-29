import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidOptionsError } from '@openref/core';
import { RemoteLifecycleService } from '../../src/index';
import type {
  FederationCacheRecord,
  FederationReadySnapshot,
  FederationRemoteState,
  FederationSnapshot,
  FederationUnavailableSnapshot,
  RemoteLifecycleOptions,
} from '../../src/index';
import {
  getOperation,
  hasPath,
  openApiBody,
  ScriptedFetcher,
  SerializingCacheDriver,
} from '../mocks/remotes';

/**
 * The remote lifecycle of `T045`, against the four things the task asks it to prove: a remote
 * that dies mid session degrades visibly without breaking the page, a malformed answer is a
 * failure and never a partial merge, a slow remote is bounded by the timeout, and a recovered
 * remote is fresh again without a restart.
 *
 * EVERY CLOCK IN HERE IS FAKE. The polling schedule is the subject under test, and a suite that
 * slept through it would prove the sleep. `advanceTimersByTimeAsync` drives the poller and the
 * timeout both, so every delay asserted is the scheduled one.
 */

const URL_A = 'https://alpha.internal/openapi.json';
const URL_B = 'https://beta.internal/openapi.json';

const BODY_A = openApiBody('Alpha', { '/a-orders': getOperation('listAlphaOrders') });
const BODY_B = openApiBody('Beta', { '/b-status': getOperation('getBetaStatus') });
const BODY_B_GROWN = openApiBody('Beta', {
  '/b-status': getOperation('getBetaStatus'),
  '/b-refunds': getOperation('listBetaRefunds'),
});

const REFRESH_MS = 1000;
const TIMEOUT_MS = 500;

interface Harness {
  readonly lifecycle: RemoteLifecycleService;
  readonly fetcher: ScriptedFetcher;
  readonly cache: SerializingCacheDriver;
}

function makeHarness(overrides: Partial<RemoteLifecycleOptions> = {}): Harness {
  const fetcher = new ScriptedFetcher();
  fetcher.set(URL_A, { kind: 'ok', body: BODY_A });
  fetcher.set(URL_B, { kind: 'ok', body: BODY_B });

  const cache = new SerializingCacheDriver();

  const lifecycle = new RemoteLifecycleService({
    remotes: [
      { id: 'alpha', url: URL_A },
      { id: 'beta', url: URL_B },
    ],
    document: { id: 'platform', info: { title: 'Platform', version: '1.0.0' } },
    refreshMs: REFRESH_MS,
    timeoutMs: TIMEOUT_MS,
    fetcher,
    cache,
    ...overrides,
  });

  return { lifecycle, fetcher, cache };
}

function expectReady(snapshot: FederationSnapshot): FederationReadySnapshot {
  if (snapshot.availability !== 'ready') {
    throw new Error(`expected a ready snapshot, got: ${snapshot.reason}`);
  }
  return snapshot;
}

function expectUnavailable(snapshot: FederationSnapshot): FederationUnavailableSnapshot {
  if (snapshot.availability !== 'unavailable') {
    throw new Error('expected an unavailable snapshot, got a ready one');
  }
  return snapshot;
}

function stateOf(snapshot: FederationSnapshot, id: string): FederationRemoteState {
  const state = snapshot.remotes.find((remote) => remote.id === id);
  if (state === undefined) throw new Error(`no state for remote "${id}"`);
  return state;
}

let harness: Harness;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-28T10:00:00.000Z'));
});

afterEach(() => {
  harness.lifecycle.stop();
  vi.useRealTimers();
});

describe('RemoteLifecycleService, first round', () => {
  it('should fetch every remote once and serve the merged document of all of them', async () => {
    // Given
    harness = makeHarness();

    // When
    await harness.lifecycle.start();
    const snapshot = expectReady(harness.lifecycle.snapshot());

    // Then: both remotes are fresh and both services' operations are on the page
    expect(snapshot.httpStatus).toBe(200);
    expect(snapshot.degraded).toBe(false);
    expect(stateOf(snapshot, 'alpha').status).toBe('fresh');
    expect(stateOf(snapshot, 'beta').status).toBe('fresh');
    expect(hasPath(snapshot.document.nodes, '/a-orders')).toBe(true);
    expect(hasPath(snapshot.document.nodes, '/b-status')).toBe(true);
    expect(snapshot.report.serviceIds).toEqual(['alpha', 'beta']);
  });

  it('should serve one document whatever order the remotes were configured in', async () => {
    // Given: the same remotes, listed in both orders
    harness = makeHarness();
    const reversed = makeHarness({
      remotes: [
        { id: 'beta', url: URL_B },
        { id: 'alpha', url: URL_A },
      ],
      fetcher: harness.fetcher,
      cache: new SerializingCacheDriver(),
    });

    // When
    await harness.lifecycle.start();
    await reversed.lifecycle.start();

    // Then
    const first = expectReady(harness.lifecycle.snapshot());
    const second = expectReady(reversed.lifecycle.snapshot());
    expect(first.document.hash).toBe(second.document.hash);
    expect(first.report).toEqual(second.report);
    reversed.lifecycle.stop();
  });

  it('should be idempotent: a second start joins the first round instead of doubling it', async () => {
    // Given
    harness = makeHarness();

    // When
    await Promise.all([harness.lifecycle.start(), harness.lifecycle.start()]);

    // Then: one fetch per remote, not two
    expect(harness.fetcher.callsTo(URL_A)).toHaveLength(1);
    expect(harness.fetcher.callsTo(URL_B)).toHaveLength(1);
  });
});

describe('RemoteLifecycleService, degradation', () => {
  it('should degrade a remote that dies mid session, visibly, without breaking the page', async () => {
    // Given: a healthy federation whose page really contains beta's operation
    harness = makeHarness();
    await harness.lifecycle.start();
    const before = expectReady(harness.lifecycle.snapshot());
    expect(hasPath(before.document.nodes, '/b-status')).toBe(true);

    // When: beta goes down and the next poll runs
    harness.fetcher.set(URL_B, { kind: 'down' });
    await vi.advanceTimersByTimeAsync(REFRESH_MS);

    // Then: the page still holds beta's cached version, and the state says so out loud
    const after = expectReady(harness.lifecycle.snapshot());
    expect(after.httpStatus).toBe(200);
    expect(hasPath(after.document.nodes, '/b-status')).toBe(true);
    expect(after.degraded).toBe(true);

    const beta = stateOf(after, 'beta');
    expect(beta.status).toBe('degraded');
    expect(beta.consecutiveFailures).toBe(1);
    expect(beta.lastError?.code).toBe('FED_REMOTE_UNAVAILABLE');
    expect(beta.version?.fromCache).toBe(false);

    // And the served document is the same composition, not a rebuilt lookalike
    expect(after.document).toBe(before.document);
  });

  it('should treat a non-success status as a failure with the status in the record', async () => {
    // Given
    harness = makeHarness();
    await harness.lifecycle.start();

    // When
    harness.fetcher.set(URL_B, { kind: 'status', status: 503 });
    await vi.advanceTimersByTimeAsync(REFRESH_MS);

    // Then
    const beta = stateOf(harness.lifecycle.snapshot(), 'beta');
    expect(beta.status).toBe('degraded');
    expect(beta.lastError?.message).toContain('answered 503');
  });

  it('should not let a remote that never answered take down the documentation of the others', async () => {
    // Given: beta is down from the very first fetch and has no cache anywhere
    harness = makeHarness();
    harness.fetcher.set(URL_B, { kind: 'down' });

    // When
    await harness.lifecycle.start();

    // Then: alpha's documentation is served; beta is failed, present in the states, absent from
    // the document
    const snapshot = expectReady(harness.lifecycle.snapshot());
    expect(hasPath(snapshot.document.nodes, '/a-orders')).toBe(true);
    expect(hasPath(snapshot.document.nodes, '/b-status')).toBe(false);
    expect(snapshot.degraded).toBe(true);
    expect(stateOf(snapshot, 'beta').status).toBe('failed');
    expect(stateOf(snapshot, 'beta').version).toBeUndefined();
    expect(snapshot.report.serviceIds).toEqual(['alpha']);
  });

  it('should be unavailable when no remote has anything to serve', async () => {
    // Given
    harness = makeHarness();
    harness.fetcher.set(URL_A, { kind: 'down' });
    harness.fetcher.set(URL_B, { kind: 'down' });

    // When
    await harness.lifecycle.start();

    // Then
    const snapshot = expectUnavailable(harness.lifecycle.snapshot());
    expect(snapshot.httpStatus).toBe(503);
    expect(snapshot.reason).toContain('no remote has a fetched or cached version');
  });
});

describe('RemoteLifecycleService, malformed answers', () => {
  it('should treat a body that does not parse as a failure serving the cached version', async () => {
    // Given: beta was healthy, so its operation is really on the page
    harness = makeHarness();
    await harness.lifecycle.start();
    const before = expectReady(harness.lifecycle.snapshot());
    expect(hasPath(before.document.nodes, '/b-status')).toBe(true);

    // When: beta answers 200 with truncated JSON
    harness.fetcher.set(URL_B, { kind: 'ok', body: '{"openapi":"3.1.0"' });
    await vi.advanceTimersByTimeAsync(REFRESH_MS);

    // Then: a failure like any other, with the parser's own code, and the document unchanged
    const after = expectReady(harness.lifecycle.snapshot());
    const beta = stateOf(after, 'beta');
    expect(beta.status).toBe('degraded');
    expect(beta.lastError?.code).toMatch(/^NORM_/);
    expect(after.document.hash).toBe(before.document.hash);
  });

  it('should treat a body that is not an OpenAPI document as a failure, never a partial merge', async () => {
    // Given: beta has no earlier version, so a partial merge would be the only way in
    harness = makeHarness();
    harness.fetcher.set(URL_B, { kind: 'ok', body: JSON.stringify({ hello: 'world' }) });

    // When
    await harness.lifecycle.start();

    // Then: nothing of beta reached the document
    const snapshot = expectReady(harness.lifecycle.snapshot());
    expect(stateOf(snapshot, 'beta').status).toBe('failed');
    expect(stateOf(snapshot, 'beta').lastError?.code).toMatch(/^NORM_/);
    expect(snapshot.report.serviceIds).toEqual(['alpha']);
    expect([...snapshot.document.nodes.keys()].some((id) => id.startsWith('beta_'))).toBe(false);
  });
});

describe('RemoteLifecycleService, slow remotes', () => {
  it('should serve the fast remotes without waiting for a hung one', async () => {
    // Given
    harness = makeHarness();
    harness.fetcher.set(URL_B, { kind: 'hang' });

    // When: the first round is under way and only alpha has settled
    const started = harness.lifecycle.start();
    await vi.advanceTimersByTimeAsync(1);

    // Then: alpha's documentation is already being served while beta is still pending
    const during = expectReady(harness.lifecycle.snapshot());
    expect(hasPath(during.document.nodes, '/a-orders')).toBe(true);
    expect(stateOf(during, 'alpha').status).toBe('fresh');
    expect(stateOf(during, 'beta').status).toBe('pending');

    // And the hung fetch is failed at the timeout, which also settles the first round
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await started;
    const after = harness.lifecycle.snapshot();
    const beta = stateOf(after, 'beta');
    expect(beta.status).toBe('failed');
    expect(beta.lastError?.code).toBe('FED_REMOTE_UNAVAILABLE');
    expect(beta.lastError?.message).toContain(`${String(TIMEOUT_MS)} ms`);
  });

  it('should fail a slow refresh at the timeout even when the fetcher ignores its signal', async () => {
    // Given: a fetcher whose promise never settles, abort or no abort
    harness = makeHarness({
      fetcher: {
        fetch: () =>
          new Promise(() => {
            /* never settles */
          }),
      },
    });

    // When
    const started = harness.lifecycle.start();
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await started;

    // Then: the lifecycle moved on without it
    const snapshot = expectUnavailable(harness.lifecycle.snapshot());
    expect(stateOf(snapshot, 'alpha').status).toBe('failed');
    expect(stateOf(snapshot, 'alpha').lastError?.message).toContain(`${String(TIMEOUT_MS)} ms`);
  });
});

describe('RemoteLifecycleService, recovery and backoff', () => {
  it('should restore the fresh version without a restart when the remote comes back', async () => {
    // Given: beta degraded over its cached version
    harness = makeHarness();
    await harness.lifecycle.start();
    harness.fetcher.set(URL_B, { kind: 'down' });
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    expect(stateOf(harness.lifecycle.snapshot(), 'beta').status).toBe('degraded');

    // When: beta comes back with a grown document, and the next scheduled poll runs
    harness.fetcher.set(URL_B, { kind: 'ok', body: BODY_B_GROWN });
    await vi.advanceTimersByTimeAsync(REFRESH_MS);

    // Then: fresh again, the new operation is on the page, and the failure count is reset
    const snapshot = expectReady(harness.lifecycle.snapshot());
    const beta = stateOf(snapshot, 'beta');
    expect(beta.status).toBe('fresh');
    expect(beta.consecutiveFailures).toBe(0);
    expect(beta.lastError).toBeUndefined();
    expect(snapshot.degraded).toBe(false);
    expect(hasPath(snapshot.document.nodes, '/b-refunds')).toBe(true);
  });

  it('should back off a failing remote by doubling up to the cap and return to the plain rate on success', async () => {
    // Given
    harness = makeHarness();
    harness.fetcher.set(URL_B, { kind: 'down' });
    const startedAt = Date.now();
    await harness.lifecycle.start();

    // When: the outage lasts long enough to reach the cap, then beta recovers
    await vi.advanceTimersByTimeAsync(23_000);
    harness.fetcher.set(URL_B, { kind: 'ok', body: BODY_B });
    await vi.advanceTimersByTimeAsync(9_000);

    // Then: 1x after the first failure, then 2x, 4x, 8x, 8x while down, and 1x again after the
    // success at 31 000
    const offsets = harness.fetcher.callsTo(URL_B).map((call) => call.at - startedAt);
    expect(offsets).toEqual([0, 1000, 3000, 7000, 15_000, 23_000, 31_000, 32_000]);
  });

  it('should keep polling the healthy remote at the plain rate while the other backs off', async () => {
    // Given
    harness = makeHarness();
    harness.fetcher.set(URL_B, { kind: 'down' });
    const startedAt = Date.now();
    await harness.lifecycle.start();

    // When
    await vi.advanceTimersByTimeAsync(4000);

    // Then: alpha polled every second regardless of beta's backoff
    const offsets = harness.fetcher.callsTo(URL_A).map((call) => call.at - startedAt);
    expect(offsets).toEqual([0, 1000, 2000, 3000, 4000]);
  });
});

describe('RemoteLifecycleService, failureMode fail', () => {
  it('should answer 503 whenever any remote is not fresh, cache or no cache', async () => {
    // Given: a healthy fail-mode federation
    harness = makeHarness({ failureMode: 'fail' });
    await harness.lifecycle.start();
    expect(expectReady(harness.lifecycle.snapshot()).httpStatus).toBe(200);

    // When: beta dies; its cached version exists and must not soften the answer
    harness.fetcher.set(URL_B, { kind: 'down' });
    await vi.advanceTimersByTimeAsync(REFRESH_MS);

    // Then
    const snapshot = expectUnavailable(harness.lifecycle.snapshot());
    expect(snapshot.httpStatus).toBe(503);
    expect(snapshot.reason).toContain('"beta"');
    expect(stateOf(snapshot, 'beta').version).toBeDefined();

    // And recovery restores the route without a restart
    harness.fetcher.set(URL_B, { kind: 'ok', body: BODY_B });
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    expect(expectReady(harness.lifecycle.snapshot()).httpStatus).toBe(200);
  });

  it('should answer 503 before the first round has confirmed anything', () => {
    // Given
    harness = makeHarness({ failureMode: 'fail' });

    // When: nothing has been started
    const snapshot = expectUnavailable(harness.lifecycle.snapshot());

    // Then
    expect(snapshot.httpStatus).toBe(503);
    expect(snapshot.reason).toContain('not serving a fresh version');
  });
});

describe('RemoteLifecycleService, cache and restart', () => {
  it('should serve the last successful versions across a restart when the driver kept them', async () => {
    // Given: a first process fetched both remotes and saved them through the driver
    harness = makeHarness();
    await harness.lifecycle.start();
    const firstHash = expectReady(harness.lifecycle.snapshot()).document.hash;
    harness.lifecycle.stop();

    // When: a new lifecycle starts over the same driver while both remotes are down
    const fetcher = new ScriptedFetcher();
    fetcher.set(URL_A, { kind: 'down' });
    fetcher.set(URL_B, { kind: 'down' });
    const restarted = makeHarness({ fetcher, cache: harness.cache });
    harness = restarted;
    await restarted.lifecycle.start();

    // Then: the same document is served from the cache, degraded and saying so
    const snapshot = expectReady(restarted.lifecycle.snapshot());
    expect(snapshot.document.hash).toBe(firstHash);
    expect(hasPath(snapshot.document.nodes, '/b-status')).toBe(true);
    expect(snapshot.degraded).toBe(true);
    expect(stateOf(snapshot, 'alpha').status).toBe('degraded');
    expect(stateOf(snapshot, 'alpha').version?.fromCache).toBe(true);
    expect(stateOf(snapshot, 'beta').version?.fromCache).toBe(true);
  });

  it('should mark cached versions stale until the first attempt of the new process settles', async () => {
    // Given: a driver holding both versions from an earlier lifecycle
    harness = makeHarness();
    await harness.lifecycle.start();
    harness.lifecycle.stop();

    const fetcher = new ScriptedFetcher();
    fetcher.set(URL_A, { kind: 'hang' });
    fetcher.set(URL_B, { kind: 'hang' });
    const restarted = makeHarness({ fetcher, cache: harness.cache });
    harness = restarted;

    // When: the new first round is still in flight
    const started = restarted.lifecycle.start();
    await vi.advanceTimersByTimeAsync(1);

    // Then: the cache is served at once, marked stale rather than fresh
    const during = expectReady(restarted.lifecycle.snapshot());
    expect(stateOf(during, 'alpha').status).toBe('stale');
    expect(stateOf(during, 'beta').status).toBe('stale');

    // And the timeout turns stale into degraded, visibly
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await started;
    expect(stateOf(restarted.lifecycle.snapshot(), 'alpha').status).toBe('degraded');
  });

  it('should not serve a cached record fetched from a URL the remote no longer lives at', async () => {
    // Given: beta's record was saved for URL_B
    harness = makeHarness();
    await harness.lifecycle.start();
    harness.lifecycle.stop();

    // When: the configuration repoints beta and the new address is down
    const fetcher = new ScriptedFetcher();
    fetcher.set(URL_A, { kind: 'ok', body: BODY_A });
    fetcher.set('https://beta.moved.internal/openapi.json', { kind: 'down' });
    const repointed = makeHarness({
      remotes: [
        { id: 'alpha', url: URL_A },
        { id: 'beta', url: 'https://beta.moved.internal/openapi.json' },
      ],
      fetcher,
      cache: harness.cache,
    });
    harness = repointed;
    await repointed.lifecycle.start();

    // Then: yesterday's document from the abandoned address is not served
    const snapshot = expectReady(repointed.lifecycle.snapshot());
    expect(stateOf(snapshot, 'beta').status).toBe('failed');
    expect(stateOf(snapshot, 'beta').version).toBeUndefined();
    expect(hasPath(snapshot.document.nodes, '/b-status')).toBe(false);
    expect(hasPath(snapshot.document.nodes, '/a-orders')).toBe(true);
  });

  it('should refuse a cached body that no longer normalizes, by name, and carry on', async () => {
    // Given: a record whose stored body is garbage, and a remote too slow to replace it yet
    harness = makeHarness();
    harness.cache.plant(
      'beta',
      JSON.stringify({ url: URL_B, fetchedAt: '2026-08-27T10:00:00.000Z', body: 'garbage' }),
    );
    harness.fetcher.set(URL_B, { kind: 'hang' });

    // When
    const started = harness.lifecycle.start();
    await vi.advanceTimersByTimeAsync(1);

    // Then: nothing is served for beta and the refusal is visible under its own code
    const during = harness.lifecycle.snapshot();
    const beta = stateOf(during, 'beta');
    expect(beta.status).toBe('pending');
    expect(beta.version).toBeUndefined();
    expect(beta.lastError?.code).toBe('FED_CACHE_INVALID');

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await started;
  });

  it('should never show a remote as fresh beside a document missing its version, even mid save', async () => {
    // Given: a driver whose save takes real time, which is the window the defect lived in: the
    // remote's outcome was recorded before the save and the composition only after it
    class SlowSaveDriver extends SerializingCacheDriver {
      override save(remoteId: string, record: FederationCacheRecord): Promise<void> {
        return new Promise((resolve) => {
          setTimeout(() => {
            void super.save(remoteId, record).then(resolve);
          }, 50);
        });
      }
    }
    harness = makeHarness({ cache: new SlowSaveDriver() });

    // When: the fetches have answered and every save is still in flight
    const started = harness.lifecycle.start();
    await vi.advanceTimersByTimeAsync(1);

    // Then: the snapshot of that window is coherent: fresh remote, version on the page
    const during = expectReady(harness.lifecycle.snapshot());
    expect(stateOf(during, 'beta').status).toBe('fresh');
    expect(hasPath(during.document.nodes, '/b-status')).toBe(true);

    await vi.advanceTimersByTimeAsync(50);
    await started;
  });

  it('should survive a cache driver whose load throws, and fetch fresh anyway', async () => {
    // Given: a stored value that is not even JSON, so the driver itself throws
    harness = makeHarness();
    harness.cache.plant('beta', 'not json at all');

    // When
    await harness.lifecycle.start();

    // Then: the fetch replaced the unreadable cache and the remote is simply fresh
    const snapshot = expectReady(harness.lifecycle.snapshot());
    expect(stateOf(snapshot, 'beta').status).toBe('fresh');
    expect(hasPath(snapshot.document.nodes, '/b-status')).toBe(true);
  });
});

describe('RemoteLifecycleService, merge refusals', () => {
  const COLLIDING_A = openApiBody('Alpha', { '/status': getOperation('alphaStatus') });
  const COLLIDING_B = openApiBody('Beta', { '/status': getOperation('betaStatus') });

  it('should be unavailable when the first merge is refused under onConflict fail', async () => {
    // Given: two services claiming one address, under the mode that refuses to choose
    harness = makeHarness({
      document: {
        id: 'platform',
        info: { title: 'Platform', version: '1.0.0' },
        onConflict: 'fail',
      },
    });
    harness.fetcher.set(URL_A, { kind: 'ok', body: COLLIDING_A });
    harness.fetcher.set(URL_B, { kind: 'ok', body: COLLIDING_B });

    // When
    await harness.lifecycle.start();

    // Then
    const snapshot = expectUnavailable(harness.lifecycle.snapshot());
    expect(snapshot.reason).toContain('could not be merged');
  });

  it('should keep serving the last good composition when a refresh brings a conflict, and say so', async () => {
    // Given: a federation that merged cleanly
    harness = makeHarness({
      document: {
        id: 'platform',
        info: { title: 'Platform', version: '1.0.0' },
        onConflict: 'fail',
      },
    });
    await harness.lifecycle.start();
    const before = expectReady(harness.lifecycle.snapshot());
    expect(before.mergeError).toBeUndefined();

    // When: beta's next version claims the address alpha already serves
    harness.fetcher.set(URL_B, {
      kind: 'ok',
      body: openApiBody('Beta', { '/a-orders': getOperation('betaOrders') }),
    });
    await vi.advanceTimersByTimeAsync(REFRESH_MS);

    // Then: the last mergeable document is still served and the refusal is on the snapshot
    const after = expectReady(harness.lifecycle.snapshot());
    expect(after.document.hash).toBe(before.document.hash);
    expect(after.mergeError?.code).toBe('FED_MERGE_CONFLICT');

    // And reverting the input clears the refusal without a rebuild
    harness.fetcher.set(URL_B, { kind: 'ok', body: BODY_B });
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    const reverted = expectReady(harness.lifecycle.snapshot());
    expect(reverted.mergeError).toBeUndefined();
    expect(reverted.document).toBe(before.document);
  });
});

describe('RemoteLifecycleService, control surface', () => {
  it('should coalesce concurrent refreshes of one remote into one fetch', async () => {
    // Given
    harness = makeHarness();
    harness.fetcher.set(URL_B, { kind: 'hang' });

    // When: two refreshes are asked for while the first is still in flight
    const first = harness.lifecycle.refresh('beta');
    const second = harness.lifecycle.refresh('beta');
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await Promise.all([first, second]);

    // Then
    expect(harness.fetcher.callsTo(URL_B)).toHaveLength(1);
  });

  it('should refuse to refresh a remote nobody configured', async () => {
    // Given
    harness = makeHarness();

    // When / Then
    await expect(harness.lifecycle.refresh('nobody')).rejects.toThrow(InvalidOptionsError);
  });

  it('should stop polling on stop and keep the last state readable', async () => {
    // Given
    harness = makeHarness();
    await harness.lifecycle.start();
    const callsBefore = harness.fetcher.calls.length;

    // When
    harness.lifecycle.stop();
    await vi.advanceTimersByTimeAsync(REFRESH_MS * 10);

    // Then: no further fetches, the document still served, and no next attempt promised
    expect(harness.fetcher.calls.length).toBe(callsBefore);
    const snapshot = expectReady(harness.lifecycle.snapshot());
    expect(hasPath(snapshot.document.nodes, '/a-orders')).toBe(true);
    expect(stateOf(snapshot, 'alpha').nextAttemptAt).toBeUndefined();
  });

  it('should keep the served document identical across polls that fetched identical bodies', async () => {
    // Given
    harness = makeHarness();
    await harness.lifecycle.start();
    const before = expectReady(harness.lifecycle.snapshot()).document;

    // When: two more polls of unchanged remotes
    await vi.advanceTimersByTimeAsync(REFRESH_MS * 2);

    // Then: the very same object, so downstream render caches keyed by it stay warm
    expect(expectReady(harness.lifecycle.snapshot()).document).toBe(before);
  });
});

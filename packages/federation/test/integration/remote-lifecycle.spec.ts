import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileCacheAdapter, RemoteLifecycleService } from '../../src/index';
import type { FederationReadySnapshot, FederationSnapshot } from '../../src/index';
import { getOperation, hasPath, openApiBody } from '../mocks/remotes';

/**
 * The lifecycle against real sockets, the real `fetch` adapter, the real file cache and real
 * time: a remote that is killed, a remote that hangs, a process that restarts over its cache.
 *
 * EVERY ADDRESS HERE IS LOOPBACK. SPEC 19's zero-external-requests posture is not suspended for
 * this suite; the one external request class the product performs, a federation remote URL, is
 * exercised against servers this suite starts and stops itself.
 */

const BODY_A = openApiBody('Alpha', { '/a-orders': getOperation('listAlphaOrders') });
const BODY_B = openApiBody('Beta', { '/b-status': getOperation('getBetaStatus') });

interface TestServer {
  readonly url: string;
  readonly port: number;
  setBody(body: string): void;
  kill(): Promise<void>;
}

/** Starts a loopback server answering every request with the current body as JSON. */
function startServer(body: string, port = 0): Promise<TestServer> {
  let current = body;

  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(current);
  });

  return listen(server, port).then((boundPort) => ({
    url: `http://127.0.0.1:${String(boundPort)}/openapi.json`,
    port: boundPort,
    setBody: (next: string) => {
      current = next;
    },
    kill: () => close(server),
  }));
}

/** Starts a loopback server that accepts connections and never answers them. */
function startSilentServer(): Promise<TestServer> {
  const server = createServer(() => {
    // Never write a byte: the request hangs until the client gives up.
  });

  return listen(server, 0).then((boundPort) => ({
    url: `http://127.0.0.1:${String(boundPort)}/openapi.json`,
    port: boundPort,
    setBody: () => undefined,
    kill: () => close(server),
  }));
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('the server bound no port'));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      // Killing a server twice happens by design: a test kills one mid-scenario and the
      // teardown sweeps everything. An already dead server is the goal state, not a failure.
      if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/** Polls until the predicate holds, failing loudly rather than waiting forever. */
async function until(what: string, predicate: () => boolean, deadlineMs = 3000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`gave up waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

function expectReady(snapshot: FederationSnapshot): FederationReadySnapshot {
  if (snapshot.availability !== 'ready') {
    throw new Error(`expected a ready snapshot, got: ${snapshot.reason}`);
  }
  return snapshot;
}

function statusOf(snapshot: FederationSnapshot, id: string): string {
  const state = snapshot.remotes.find((remote) => remote.id === id);
  if (state === undefined) throw new Error(`no state for remote "${id}"`);
  return state.status;
}

describe('remote lifecycle over real sockets', () => {
  let directory: string;
  const lifecycles: RemoteLifecycleService[] = [];
  const servers: TestServer[] = [];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'openref-federation-'));
  });

  afterEach(async () => {
    for (const lifecycle of lifecycles.splice(0)) lifecycle.stop();
    for (const server of servers.splice(0)) await server.kill();

    // A stopped lifecycle can still be finishing one cache save, and a removal racing that
    // write loses with ENOTEMPTY. Retrying is the teardown's problem, not the driver's.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rm(directory, { recursive: true, force: true });
        break;
      } catch (cause) {
        if (attempt >= 4) throw cause;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  });

  function makeLifecycle(
    remotes: { id: string; url: string }[],
    overrides: { refreshMs?: number; timeoutMs?: number; failureMode?: 'degrade' | 'fail' } = {},
  ): RemoteLifecycleService {
    const lifecycle = new RemoteLifecycleService({
      remotes,
      document: { id: 'platform', info: { title: 'Platform', version: '1.0.0' } },
      refreshMs: overrides.refreshMs ?? 60,
      timeoutMs: overrides.timeoutMs ?? 400,
      ...(overrides.failureMode === undefined ? {} : { failureMode: overrides.failureMode }),
      cache: new FileCacheAdapter({ directory }),
    });
    lifecycles.push(lifecycle);
    return lifecycle;
  }

  it('should degrade a killed remote, keep its page content, and recover when it returns', async () => {
    // Given: two live remotes, fetched over real HTTP
    const alpha = await startServer(BODY_A);
    const beta = await startServer(BODY_B);
    servers.push(alpha, beta);

    const lifecycle = makeLifecycle([
      { id: 'alpha', url: alpha.url },
      { id: 'beta', url: beta.url },
    ]);
    await lifecycle.start();

    const healthy = expectReady(lifecycle.snapshot());
    expect(statusOf(healthy, 'beta')).toBe('fresh');
    expect(hasPath(healthy.document.nodes, '/b-status')).toBe(true);

    // When: beta's process dies mid session
    await beta.kill();
    await until('beta to degrade', () => statusOf(lifecycle.snapshot(), 'beta') === 'degraded');

    // Then: the page still holds beta's operations and says the remote is degraded
    const degraded = expectReady(lifecycle.snapshot());
    expect(degraded.degraded).toBe(true);
    expect(hasPath(degraded.document.nodes, '/b-status')).toBe(true);

    // And when beta comes back on the same port with a grown document, polling finds it fresh
    // again with no restart of anything on this side
    const grown = openApiBody('Beta', {
      '/b-status': getOperation('getBetaStatus'),
      '/b-refunds': getOperation('listBetaRefunds'),
    });
    const revived = await startServer(grown, beta.port);
    servers.push(revived);
    await until('beta to recover', () => statusOf(lifecycle.snapshot(), 'beta') === 'fresh');

    const recovered = expectReady(lifecycle.snapshot());
    expect(recovered.degraded).toBe(false);
    expect(hasPath(recovered.document.nodes, '/b-refunds')).toBe(true);
  });

  it('should serve the cached versions from disk after a restart while the remotes are down', async () => {
    // Given: a first lifecycle that fetched both remotes and wrote the file cache
    const alpha = await startServer(BODY_A);
    const beta = await startServer(BODY_B);
    servers.push(alpha, beta);

    const first = makeLifecycle([
      { id: 'alpha', url: alpha.url },
      { id: 'beta', url: beta.url },
    ]);
    await first.start();
    const firstHash = expectReady(first.snapshot()).document.hash;
    first.stop();

    // When: everything is down and a new lifecycle starts over the same directory, which is
    // what a process restart is
    await alpha.kill();
    await beta.kill();
    const second = makeLifecycle([
      { id: 'alpha', url: alpha.url },
      { id: 'beta', url: beta.url },
    ]);
    await second.start();

    // Then: the same document, from disk, marked degraded rather than passed off as fresh
    const snapshot = expectReady(second.snapshot());
    expect(snapshot.document.hash).toBe(firstHash);
    expect(hasPath(snapshot.document.nodes, '/a-orders')).toBe(true);
    expect(hasPath(snapshot.document.nodes, '/b-status')).toBe(true);
    expect(snapshot.degraded).toBe(true);
    expect(statusOf(snapshot, 'alpha')).toBe('degraded');
    const alphaState = snapshot.remotes.find((remote) => remote.id === 'alpha');
    expect(alphaState?.version?.fromCache).toBe(true);
  });

  it('should bound a remote that accepts and never answers, and serve the others meanwhile', async () => {
    // Given: one healthy remote and one that hangs every request
    const alpha = await startServer(BODY_A);
    const silent = await startSilentServer();
    servers.push(alpha, silent);

    const lifecycle = makeLifecycle(
      [
        { id: 'alpha', url: alpha.url },
        { id: 'slow', url: silent.url },
      ],
      { timeoutMs: 300 },
    );

    // When
    const startedAt = Date.now();
    await lifecycle.start();
    const elapsed = Date.now() - startedAt;

    // Then: the first round settled at the timeout, not at the server's leisure
    expect(elapsed).toBeLessThan(2000);
    const snapshot = expectReady(lifecycle.snapshot());
    expect(statusOf(snapshot, 'alpha')).toBe('fresh');
    expect(statusOf(snapshot, 'slow')).toBe('failed');
    expect(hasPath(snapshot.document.nodes, '/a-orders')).toBe(true);
    const slow = snapshot.remotes.find((remote) => remote.id === 'slow');
    expect(slow?.lastError?.message).toContain('300 ms');
  });

  it('should answer 503 under failureMode fail while a remote is down, and 200 when all are fresh', async () => {
    // Given
    const alpha = await startServer(BODY_A);
    const beta = await startServer(BODY_B);
    servers.push(alpha, beta);

    const lifecycle = makeLifecycle(
      [
        { id: 'alpha', url: alpha.url },
        { id: 'beta', url: beta.url },
      ],
      { failureMode: 'fail' },
    );
    await lifecycle.start();
    expect(lifecycle.snapshot().httpStatus).toBe(200);

    // When
    await beta.kill();
    await until('the route to fail closed', () => lifecycle.snapshot().httpStatus === 503);

    // Then
    const snapshot = lifecycle.snapshot();
    expect(snapshot.availability).toBe('unavailable');
    if (snapshot.availability === 'unavailable') {
      expect(snapshot.reason).toContain('"beta"');
    }
  });
});

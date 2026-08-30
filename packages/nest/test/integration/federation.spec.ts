import { ErrorCode } from '@openref/core';
import { RemoteLifecycleService } from '@openref/federation';
import { createRunner } from '@openref/runner';
import type { RunnerOperationView } from '@openref/vue';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, type BootedApp, type FixtureApp } from '../mocks/app-process';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

/**
 * The three service demo of the M4 DoD, driven end to end: it boots from its single command,
 * renders as one page, searches as one index, and executes a request from the page's own
 * material against the real guarded service.
 *
 * ONE BOOT FOR THE WHOLE FILE. The demo is two applications and a first federation round, and
 * booting it per case would spend its cost several times to prove independence nobody doubts.
 * The cases read different addresses of one running demo, which is exactly how a reader uses it.
 */

const DEMO: FixtureApp = {
  label: 'federation demo, three services',
  entry: 'examples/federation/dist/serve.js',
};

let demo: BootedApp;
let servicesUrl = '';

/** Polls the overview until every service group is in it, bounded: the first round is live. */
async function settledOverview(): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const html = await (await fetch(`${demo.url}/docs`)).text();
    if (
      html.includes('data-oref-service="billing"') &&
      html.includes('data-oref-service="orders"') &&
      html.includes('data-oref-service="payments"')
    ) {
      return html;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('the three service groups never all arrived');
}

beforeAll(async () => {
  demo = await bootApp(DEMO, 'express');
  const snapshot = (await (await fetch(`${demo.url}/docs/_federation`)).json()) as {
    remotes: readonly { id: string }[];
  };
  // The services origin is not in the ready line's url; recover it from a remote's own card
  // material instead: the orders specification pins its origin as its one server.
  expect(snapshot.remotes.length).toBeGreaterThan(0);
  const card = await (await fetch(`${demo.url}/docs/service/orders`)).text();
  const origin = /http:\/\/127\.0\.0\.1:\d+/.exec(card)?.[0];
  if (origin === undefined) throw new Error('the orders card names no origin');
  servicesUrl = origin;
}, SPAWNED_PROCESS_TIMEOUT_MS);

afterAll(async () => {
  await demo.stop();
}, SPAWNED_PROCESS_TIMEOUT_MS);

describe('the three service demo', () => {
  it('should render the three services as one page, each group carrying its card link', async () => {
    // Given / When
    const html = await settledOverview();

    // Then: one navigation with three service groups, their labels, and the live status marks
    expect(html).toContain('Billing');
    expect(html).toContain('Orders');
    expect(html).toContain('Payments');
    expect(html).toContain('href="/docs/service/billing"');
    expect(html).toContain('href="/docs/service/orders"');
    expect(html).toContain('href="/docs/service/payments"');
  }, 30_000);

  it('should search all three services through one index', async () => {
    // Given
    await settledOverview();

    // When
    const serialized = await (await fetch(`${demo.url}/docs/_search-index`)).text();

    // Then: merged node ids of every service are in one file
    expect(serialized).toContain('billing_');
    expect(serialized).toContain('orders_');
    expect(serialized).toContain('payments_');
  }, 30_000);

  it('should show the local service runtime facts and drift on its card', async () => {
    // Given
    await settledOverview();

    // When
    const card = await (await fetch(`${demo.url}/docs/service/billing`)).text();

    // Then: the collectors that ran, and the deliberate security-drift finding, per SPEC 15.3
    expect(card).toContain('guardsCollector');
    expect(card).toContain('oref-section-health');
    expect(card).toContain('security-drift');
  }, 30_000);

  it('should say on a remote card that no collectors ran, which is the honest sentence', async () => {
    // Given
    await settledOverview();

    // When
    const card = await (await fetch(`${demo.url}/docs/service/orders`)).text();

    // Then
    expect(card).toContain('none ran on this document');
  }, 30_000);

  it('should report the remotes on the live snapshot and the local service only as data', async () => {
    // Given
    await settledOverview();

    // When
    const snapshot = (await (await fetch(`${demo.url}/docs/_federation`)).json()) as {
      availability: string;
      remotes: readonly { id: string; status: string }[];
    };

    // Then: two remote states, no billing entry, which is what says local, per SPEC 15.3
    expect(snapshot.availability).toBe('ready');
    expect(snapshot.remotes.map((remote) => remote.id).sort()).toEqual(['orders', 'payments']);
    expect(snapshot.remotes.every((remote) => remote.status === 'fresh')).toBe(true);
  }, 30_000);

  it('should refuse openapi.json with the three services named', async () => {
    // Given
    await settledOverview();

    // When
    const reply = await fetch(`${demo.url}/docs/openapi.json`);

    // Then
    expect(reply.status).toBe(404);
    const body = (await reply.json()) as { services: string[] };
    expect(body.services.sort()).toEqual(['billing', 'orders', 'payments']);
  }, 30_000);

  it('should refuse to feed one federation to another, so a cycle of two mounts cannot form', async () => {
    // Given a second federation configured to fetch this running one, which is the A federates B
    // federates A shape of `T047`: the only address a mount publishes a document at is the one
    // refused above, so the cycle has to close through it or not at all.
    await settledOverview();
    const lifecycle = new RemoteLifecycleService({
      remotes: [{ id: 'upstream', url: `${demo.url}/docs/openapi.json` }],
      document: { id: 'outer', info: { title: 'Outer', version: '1' } },
      timeoutMs: 5_000,
    });

    // When its first round runs, over real HTTP, with the real fetcher
    await lifecycle.start();
    const snapshot = lifecycle.snapshot();
    lifecycle.stop();

    // Then the outer federation has nothing to serve and says why, rather than merging a merged
    // document or recursing into one
    expect(snapshot.availability).toBe('unavailable');
    expect(snapshot.httpStatus).toBe(503);
    const [state] = snapshot.remotes;
    expect(state?.status).toBe('failed');
    expect(state?.version).toBeUndefined();
    expect(state?.lastError?.code).toBe(ErrorCode.FED_REMOTE_UNAVAILABLE);
    expect(state?.lastError?.message).toContain('404');
  }, 30_000);

  it('should serve the three services as one document, which is the M4 definition of done', async () => {
    // Given the demo, booted from its own single command in `beforeAll`
    const html = await settledOverview();

    // When the page and the machine addresses of that one mount are read
    const snapshot = (await (await fetch(`${demo.url}/docs/_federation`)).json()) as {
      readonly documentHash: string;
      readonly remotes: readonly { readonly id: string }[];
    };
    const index = await (await fetch(`${demo.url}/docs/_search-index`)).text();

    // Then it is one page rather than three: one navigation carrying all three service groups,
    // one state block, one document hash, and one index over every service
    expect(html.split('data-oref-service=').length - 1).toBeGreaterThanOrEqual(3);
    expect(html.split('id="oref-state"').length - 1).toBe(1);
    expect(snapshot.documentHash).toMatch(/^[0-9a-f]{64}$/u);
    for (const prefix of ['billing_', 'orders_', 'payments_']) expect(index).toContain(prefix);

    // And the local service and the two remotes are all in it, which is what makes the page the
    // whole federation rather than the reachable part of it
    expect(snapshot.remotes.map((remote) => remote.id).sort()).toEqual(['orders', 'payments']);
    expect(html).toContain('href="/docs/service/billing"');
  }, 30_000);

  it('should answer the three agent addresses on the federated mount as well', async () => {
    // Given a mount that is not an ordinary `ReferenceService` at all: `FederatedReferenceService`
    // answers the table of SPEC 13.3 from a snapshot and delegates what it does not own to an
    // inner service rebuilt per composition. The agent surface of SPEC 18.1 is delegated, which
    // is a property of a `switch` in one file and was proved nowhere in the tree until this case.
    await settledOverview();

    // When
    const index = await fetch(`${demo.url}/docs/llms.txt`);
    const indexText = await index.text();
    const full = await fetch(`${demo.url}/docs/llms-full.txt`);
    const fullText = await full.text();
    const mcp = await fetch(`${demo.url}/docs/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    const mcpText = await mcp.text();

    // Then the two text files describe the merged document, operations of more than one service
    // included, and the MCP address answers about itself rather than falling through to the node
    // page route, which is what the second registration of that address exists for
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toContain('text/plain');
    expect(indexText).toContain('## Operations');
    expect(indexText).toContain('/docs/orders_get-orders');
    expect(indexText).toContain('/docs/billing_');
    expect(full.status).toBe(200);
    expect(fullText).toContain('Address: /docs/orders_get-orders');
    // MCP is off unless a host writes it, per SPEC 18, and off says so rather than 404ing
    expect(mcp.status).toBe(403);
    expect(mcpText).toContain('agent: { mcp: true }');
  }, 30_000);

  it('should execute a request from the page own material against the guarded service', async () => {
    // Given: the orders bench page, whose state block carries the runner projection
    await settledOverview();
    const bench = await (await fetch(`${demo.url}/docs/bench/orders_get-orders`)).text();
    const state = /<script[^>]*id="oref-state"[^>]*>([\s\S]*?)<\/script>/.exec(bench)?.[1];
    expect(state).toBeDefined();
    const page = JSON.parse(state ?? '{}') as { node: { run: RunnerOperationView | null } | null };
    const run = page.node?.run;
    if (run === null || run === undefined) throw new Error('the bench carries no runner view');

    // And the projection offers the service's own origin, per SPEC 15.3
    expect(run.servers).toEqual([servicesUrl]);

    // When: the same engine the console uses sends it, without and then with the credential
    const runner = createRunner({ visibility: 'public', storage: 'memory' });
    const refused = await runner.send({ operation: run, serverUrl: servicesUrl, values: {} });
    runner.setCredential(run.security[0]?.id ?? '', 'demo-token');
    const answered = await runner.send({ operation: run, serverUrl: servicesUrl, values: {} });

    // Then: the guard really stands, and the page's material really reaches the service
    expect(refused.status).toBe(401);
    expect(answered.status).toBe(200);
    expect(answered.body).toContain('ord_1');
  }, 30_000);
});

import { createRunner } from '@openref/runner';
import type { RunnerOperationView } from '@openref/vue';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, type BootedApp, type FixtureApp } from '../mocks/app-process';

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
}, 60_000);

afterAll(async () => {
  await demo.stop();
});

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

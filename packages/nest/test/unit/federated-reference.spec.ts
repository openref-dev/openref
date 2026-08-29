import { describe, expect, it } from 'vitest';
import { RemoteLifecycleService } from '@openref/federation';
import { buildAssetCatalog } from '@openref/render';
import type { IRemoteFetcher, RemoteFetchRequest, RemoteDocumentSource } from '@openref/federation';
import { FederatedReferenceService } from '../../src/index';
import { assetPlan } from '../mocks/fixtures';
import type { ReferenceRequest } from '../../src/http/application/ports/reference-http.port';

/**
 * The federated host of SPEC 15.3: the same route table, answered from the snapshot.
 *
 * WHAT IS UNDER TEST IS THE READING OF A DECISION. The lifecycle precomputed the status, per
 * SPEC 15.2, and every case here asserts that the route repeats it rather than judging for
 * itself: ready delegates to a page, unavailable is the snapshot's own 503 sentence, and the
 * one endpoint about the federation itself answers 200 whichever state it reports.
 */

const BILLING = JSON.stringify({
  openapi: '3.1.0',
  info: { title: 'Billing', version: '1.0.0' },
  servers: [{ url: 'https://billing.internal' }],
  paths: {
    '/charges': {
      post: { operationId: 'createCharge', responses: { '201': { description: 'created' } } },
    },
  },
});

const ORDERS = JSON.stringify({
  openapi: '3.1.0',
  info: { title: 'Orders', version: '2.0.0' },
  servers: [{ url: 'https://orders.internal' }],
  paths: {
    '/orders': {
      get: { operationId: 'listOrders', responses: { '200': { description: 'ok' } } },
    },
  },
});

/** Answers each URL with its scripted body, or refuses it as down. */
class MapFetcher implements IRemoteFetcher {
  constructor(private readonly bodies: ReadonlyMap<string, string>) {}

  fetch(request: RemoteFetchRequest): Promise<RemoteDocumentSource> {
    const body = this.bodies.get(request.url);
    if (body === undefined) return Promise.reject(new Error(`down: ${request.url}`));
    return Promise.resolve({ status: 200, body });
  }
}

function request(params: Record<string, string> = {}): ReferenceRequest {
  return { params, headers: {} };
}

async function readyHost(): Promise<FederatedReferenceService> {
  const lifecycle = new RemoteLifecycleService({
    remotes: [
      { id: 'billing', url: 'https://billing.internal/openapi.json', prefix: '/billing' },
      { id: 'orders', url: 'https://orders.internal/openapi.json' },
    ],
    document: { id: 'gateway', info: { title: 'Gateway', version: 'federated' } },
    fetcher: new MapFetcher(
      new Map([
        ['https://billing.internal/openapi.json', BILLING],
        ['https://orders.internal/openapi.json', ORDERS],
      ]),
    ),
  });
  await lifecycle.start();
  lifecycle.stop();

  return new FederatedReferenceService(lifecycle, {
    basePath: '/docs',
    assets: assetPlan(),
    highlight: false,
  });
}

async function unavailableHost(): Promise<FederatedReferenceService> {
  const lifecycle = new RemoteLifecycleService({
    remotes: [{ id: 'billing', url: 'https://billing.internal/openapi.json' }],
    document: { id: 'gateway', info: { title: 'Gateway', version: 'federated' } },
    failureMode: 'fail',
    fetcher: new MapFetcher(new Map()),
  });
  await lifecycle.start();
  lifecycle.stop();

  return new FederatedReferenceService(lifecycle, {
    basePath: '/docs',
    assets: assetPlan(),
    highlight: false,
  });
}

describe('FederatedReferenceService, ready', () => {
  it('should serve the merged page with every service in the rail', async () => {
    // Given
    const host = await readyHost();

    // When
    const reply = await host.handle('overview', request());

    // Then
    expect(reply.status).toBe(200);
    const html = String(reply.body);
    expect(html).toContain('Billing');
    expect(html).toContain('Orders');
    expect(html).toContain('data-oref-service="billing"');
    expect(html).toContain('data-oref-service="orders"');
  });

  it('should serve the service card at its reserved address', async () => {
    // Given
    const host = await readyHost();

    // When
    const reply = await host.handle('service', request({ serviceId: 'billing' }));

    // Then
    expect(reply.status).toBe(200);
    expect(String(reply.body)).toContain('oref-service-page');
    expect(String(reply.body)).toContain('https://billing.internal');
  });

  it('should answer the live snapshot without the document, no-store', async () => {
    // Given
    const host = await readyHost();

    // When
    const reply = await host.handle('federation', request());

    // Then
    expect(reply.status).toBe(200);
    expect(reply.headers['cache-control']).toBe('no-store');
    const body = JSON.parse(String(reply.body)) as Record<string, unknown>;
    expect(body.availability).toBe('ready');
    expect(body.httpStatus).toBe(200);
    expect(body.document).toBeUndefined();
    expect(body.report).toBeUndefined();
    expect((body.remotes as { id: string }[]).map((remote) => remote.id)).toEqual([
      'billing',
      'orders',
    ]);
  });

  it('should refuse openapi.json with the services named, since no single source exists', async () => {
    // Given
    const host = await readyHost();

    // When
    const reply = await host.handle('openapi-json', request());

    // Then
    expect(reply.status).toBe(404);
    const body = JSON.parse(String(reply.body)) as { error: string; services: string[] };
    expect(body.error).toContain('merged from 2 services');
    expect(body.services).toEqual(['billing', 'orders']);
  });

  it('should search across every service through one index', async () => {
    // Given
    const host = await readyHost();

    // When
    const reply = await host.handle('search-index', request());

    // Then
    expect(reply.status).toBe(200);
    const serialized = String(reply.body);
    expect(serialized).toContain('billing_post-charges');
    expect(serialized).toContain('orders_get-orders');
  });
});

describe('FederatedReferenceService, unavailable', () => {
  it('should answer a page route with the snapshot 503 and its reason, in HTML', async () => {
    // Given
    const host = await unavailableHost();

    // When
    const reply = await host.handle('overview', request());

    // Then: the snapshot's decision, repeated, never re-judged
    expect(reply.status).toBe(503);
    expect(reply.headers['content-type']).toContain('text/html');
    expect(reply.headers['cache-control']).toBe('no-store');
    const html = String(reply.body);
    expect(html).toContain('unavailable');
    expect(html).toContain('billing');
    expect(html).not.toContain('style=');
    expect(html).not.toContain('<script');
  });

  it('should answer a machine route with the same 503 as JSON', async () => {
    // Given
    const host = await unavailableHost();

    // When
    const reply = await host.handle('search-index', request());

    // Then
    expect(reply.status).toBe(503);
    expect(reply.headers['content-type']).toContain('application/json');
    expect((JSON.parse(String(reply.body)) as { error: string }).error).toContain('billing');
  });

  it('should still serve assets, so the 503 page keeps its stylesheet', async () => {
    // Given: the served name derived independently, since the catalog is deterministic over
    // the same sources by construction
    const host = await unavailableHost();
    const name = buildAssetCatalog(assetPlan().sources).byName.get('theme.css')?.servedName ?? '';

    // When
    const reply = await host.handle('asset', request({ asset: name }));

    // Then
    expect(reply.status).toBe(200);
  });

  it('should report the unavailable state on the snapshot endpoint as a 200', async () => {
    // Given: the endpoint reports the federation's state, and it succeeded at reporting
    const host = await unavailableHost();

    // When
    const reply = await host.handle('federation', request());

    // Then
    expect(reply.status).toBe(200);
    const body = JSON.parse(String(reply.body)) as Record<string, unknown>;
    expect(body.availability).toBe('unavailable');
    expect(body.httpStatus).toBe(503);
    expect(typeof body.reason).toBe('string');
  });
});

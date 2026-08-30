import { describe, expect, it } from 'vitest';
import { RemoteLifecycleService } from '@openref/federation';
import type { IRemoteFetcher, RemoteDocumentSource, RemoteFetchRequest } from '@openref/federation';
import { FederatedReferenceService } from '../../src/index';
import { replyText } from '../../src/http/domain/reply';
import type { ReferenceRequest } from '../../src/http/application/ports/reference-http.port';
import { assetPlan } from '../mocks/fixtures';
import { drain, FakeSource, readEvents } from '../mocks/bridge';

/**
 * The bridge on a federated mount, and the one property only this shape can lose.
 *
 * WHY THE BRIDGE IS NOT THE INNER SERVICE'S. A federated host rebuilds its inner `ReferenceService`
 * whenever the merged document's hash changes, which is every refresh that changed any remote. A
 * bridge living inside one would go with it: the concurrency ceiling would reset to zero, the
 * connection timers would be orphaned, and the readers already connected would keep their sockets
 * with nothing left that could ever close their broker subscriptions. So the bridge is owned by the
 * federated service itself, and the case below is what says so in a way that can go red.
 *
 * IT IS ALSO READINESS INDEPENDENT, per the same reasoning as the asset route beside it: whether a
 * host allowed a channel is a fact about configuration, and a 503 because some remote's
 * specification did not come back would be an answer to a different question.
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

/**
 * Answers one url, with a body a case can change between refreshes.
 *
 * THE CHANGE IS WHAT FORCES A NEW DOCUMENT HASH, which is the event under test. A fetcher that
 * always answers the same bytes produces the same merged document and the inner service is never
 * rebuilt, so a case built on one would pass whether the bridge were owned here or there.
 */
class MutableFetcher implements IRemoteFetcher {
  body = BILLING;

  fetches = 0;

  fetch(_request: RemoteFetchRequest): Promise<RemoteDocumentSource> {
    this.fetches += 1;

    return Promise.resolve({ status: 200, body: this.body });
  }
}

/** The request shape the route table produces, reduced to what the bridge route reads. */
function request(channel?: string): ReferenceRequest {
  return { params: {}, headers: {}, ...(channel === undefined ? {} : { query: { channel } }) };
}

/** A federated host, with a bridge unless the case asks for none. */
async function federatedHost(
  fetcher: MutableFetcher,
  source?: FakeSource,
): Promise<{ host: FederatedReferenceService; lifecycle: RemoteLifecycleService }> {
  const lifecycle = new RemoteLifecycleService({
    remotes: [{ id: 'billing', url: 'https://billing.internal/openapi.json' }],
    document: { id: 'gateway', info: { title: 'Gateway', version: 'federated' } },
    fetcher,
  });
  await lifecycle.start();
  lifecycle.stop();

  const host = new FederatedReferenceService(lifecycle, {
    basePath: '/docs',
    assets: assetPlan(),
    highlight: false,
    ...(source === undefined
      ? {}
      : {
          bridge: {
            enabled: true,
            channels: ['orders.created'],
            source,
            maxConcurrentSubscriptions: 1,
          },
        }),
  });

  return { host, lifecycle };
}

describe('the broker bridge on a federated mount', () => {
  it('should answer the bridge route rather than delegate it to a document', async () => {
    // Given
    const source = new FakeSource();
    const { host } = await federatedHost(new MutableFetcher(), source);

    // When
    const reply = await host.handle('bridge', request('orders.created'));

    // Then
    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(source.subscribed).toEqual(['orders.created']);
    host.bridgeSessions.closeAll('the case is over');
  });

  it('should refuse with the off reason on a federation whose host configured no bridge', async () => {
    // Given, the negative half: the route is on a federated mount too, and says off rather than
    // answering the 404 of an address nobody built
    const { host } = await federatedHost(new MutableFetcher());

    // When
    const reply = await host.handle('bridge', request('orders.created'));

    // Then
    expect(reply.status).toBe(403);
    expect(replyText(reply)).toMatch(/not enabled on this reference/);
  });

  it('should answer the bridge on a federation that cannot serve a document at all', async () => {
    // Given, a federation whose only remote never answered, so every document route is a 503
    const source = new FakeSource();
    const lifecycle = new RemoteLifecycleService({
      remotes: [{ id: 'billing', url: 'https://billing.internal/openapi.json' }],
      document: { id: 'gateway', info: { title: 'Gateway', version: 'federated' } },
      failureMode: 'fail',
      fetcher: {
        fetch: (): Promise<RemoteDocumentSource> => Promise.reject(new Error('down')),
      },
    });
    await lifecycle.start();
    lifecycle.stop();
    const host = new FederatedReferenceService(lifecycle, {
      basePath: '/docs',
      assets: assetPlan(),
      highlight: false,
      bridge: { enabled: true, channels: ['orders.created'], source },
    });

    // When, with the unavailability asserted first so the 200 below is readiness independence and
    // not a federation that turned out to be fine
    const overview = await host.handle('overview', request());
    const reply = await host.handle('bridge', request('orders.created'));

    // Then
    expect(overview.status).toBe(503);
    expect(reply.status).toBe(200);
    host.bridgeSessions.closeAll('the case is over');
  });

  it('should keep a live subscription and its ceiling across a document hash rebuild', async () => {
    // Given a subscription on a federated mount that serves one subscription at a time
    const fetcher = new MutableFetcher();
    const source = new FakeSource();
    const { host, lifecycle } = await federatedHost(fetcher, source);

    const opened = await host.handle('bridge', request('orders.created'));
    expect(opened.status).toBe(200);
    expect(host.bridgeSessions.liveSubscriptions).toBe(1);
    expect((await host.handle('bridge', request('orders.created'))).status).toBe(429);

    const before = lifecycle.snapshot();
    const hashBefore = before.availability === 'ready' ? before.document.hash : '';
    const pageBefore = replyText(await host.handle('overview', request()));
    expect(hashBefore).not.toBe('');
    expect(pageBefore).toContain('1 operations');

    // When the remote changes and the merged document is rebuilt under a new hash
    fetcher.body = JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Billing', version: '2.0.0' },
      servers: [{ url: 'https://billing.internal' }],
      paths: {
        '/charges': {
          post: { operationId: 'createCharge', responses: { '201': { description: 'created' } } },
        },
        '/refunds': {
          post: { operationId: 'createRefund', responses: { '201': { description: 'created' } } },
        },
      },
    });
    await lifecycle.refresh();
    const after = lifecycle.snapshot();
    const hashAfter = after.availability === 'ready' ? after.document.hash : '';

    // The rebuild is asserted to have happened before anything is concluded from it, and it is
    // asserted twice: the hash moved, and the page really is the new document
    expect(hashAfter).not.toBe(hashBefore);
    expect(replyText(await host.handle('overview', request()))).toContain('2 operations');

    // Then the reader is still connected, the broker still has the subscription, and the ceiling
    // that was full is still full
    expect(host.bridgeSessions.liveSubscriptions).toBe(1);
    expect(source.live).toBe(true);
    expect(source.closed).toBe(0);
    expect((await host.handle('bridge', request('orders.created'))).status).toBe(429);

    // And the stream is still the reader's: a message sent after the rebuild reaches it
    source.emit('{"orderId":"after-the-rebuild"}');
    const body = opened.body;
    if (typeof body === 'string' || body instanceof Uint8Array) {
      throw new Error('the bridge answered with a value rather than a stream');
    }
    const events = readEvents(drain(body));
    expect(events.map((event) => event.event)).toEqual(['open', 'message']);
    expect(events[1]?.data).toContain('after-the-rebuild');

    host.bridgeSessions.closeAll('the case is over');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildTopology,
  normalizeSpecification,
  parseSpecification,
  type IRDocument,
  type IRTopologyEdge,
} from '@openref/core';
import { RemoteLifecycleService, mergeDocuments } from '@openref/federation';
import type {
  FederationService,
  IRemoteFetcher,
  RemoteDocumentSource,
  RemoteFetchRequest,
} from '@openref/federation';
import { createMarkdownRenderer, renderPage } from '@openref/render';

/**
 * The federation of `T053`: services of three kinds behind one lifecycle, one merged document, one
 * page, and a topology graph that spans them.
 *
 * WHY IT IS IN `@openref/nest`. The renderer may reach `core` and `vue` and nothing else, per
 * STANDARDS 3.5, and the merge lives in `@openref/federation`; `nest` is the first package allowed
 * to see both, which is the same reason `mixed-page.spec.ts` is here.
 *
 * EVERY DOCUMENT HERE IS A PUBLISHED CORPUS DOCUMENT, read as the bytes its publisher wrote. The
 * first version of this suite built four small documents by hand, which proved the chain over
 * inputs shaped exactly like the chain's expectations; SPEC 21 asks for real specifications where
 * possible, and here it was possible. What the hand written half is still needed for is the one
 * thing no corpus document can carry, named below.
 *
 * THE MIXED SERVICE IS LOCAL AND IT CANNOT BE OTHERWISE, WHICH IS A FINDING RATHER THAN A
 * SHORTCUT. `T053`'s test clause asks for three remotes, one of them mixed. No specification format
 * writes `paths` and `channels` together, so no document a remote can serve normalizes to `mixed`,
 * and the one federated mount that holds such a document answers 404 on `openapi.json` by SPEC
 * 15.3's own rule, which `T047` drove over real HTTP. So a mixed service is a service of this
 * process, which SPEC 15.3 admits by name, and it is a previous merge's output: two corpus
 * documents of two families, merged, which is the only producer of the kind per SPEC 15.1.
 *
 * THE EVENT EDGES ARE THE HAND WRITTEN PART, FOR THE SAME KIND OF REASON. An `event` end, per SPEC
 * 9.1, is a name with no node in the declaring document, and SPEC 9.3 gives it one producer,
 * `@ApiPublishes` on a handler. That is a runtime fact, and SPEC 15.3 records that runtime facts
 * cannot ride a fetched specification: they live in the augmented IR of a running process, so no
 * published document contains one and none ever will. The two edges below name addresses the two
 * event remotes really document, so everything either end of them points at is corpus.
 */

const CORPUS = join(import.meta.dirname, '..', '..', '..', 'core', 'test');

function corpusBytes(family: 'corpus' | 'events-corpus', name: string): string {
  return readFileSync(join(CORPUS, family, 'documents', name), 'utf8');
}

/** What the three remotes serve: one OpenAPI document and two AsyncAPI documents. */
const CATALOG_BODY = corpusBytes('corpus', 'oai-petstore.yaml');
const ORDERS_BODY = corpusBytes('events-corpus', 'aai-streetlights-kafka.yml');
const LEDGER_BODY = corpusBytes('events-corpus', 'aai-websocket-gemini.yml');

/** What the local mixed service is merged from: one document of each family. */
const CHECKOUT_HTTP_BODY = corpusBytes('corpus', 'oai-petstore-expanded.yaml');
const CHECKOUT_EVENTS_BODY = corpusBytes('events-corpus', 'aai-simple.yml');

/** An address the orders remote documents a channel for, and the checkout service publishes to. */
const MEASURED = 'smartylighting.streetlights.1.0.event.{streetlightId}.lighting.measured';

/** The same, for the ledger remote, which is the one this suite takes down. */
const MARKET_DATA = '/v1/marketdata/{symbol}';

/** Where the orders remote's prefix moves {@link MEASURED} to, per the merge's address rule. */
const MOVED = `orders/${MEASURED}`;

/** The node in the local service that declares both event edges, named by the inner merge. */
const HANDLER = 'web_post-pets';

const markdown = await createMarkdownRenderer();

/** A remote's script: what the next fetch of this URL does. */
type Script = { readonly kind: 'ok'; readonly body: string } | { readonly kind: 'down' };

/** A fetcher that answers from a script, so a remote can be taken down and brought back. */
class ScriptedFetcher implements IRemoteFetcher {
  private readonly scripts = new Map<string, Script>();

  set(url: string, script: Script): void {
    this.scripts.set(url, script);
  }

  fetch(request: RemoteFetchRequest): Promise<RemoteDocumentSource> {
    const script = this.scripts.get(request.url);
    if (script === undefined || script.kind === 'down') {
      return Promise.reject(new Error(`connect ECONNREFUSED ${request.url}`));
    }
    return Promise.resolve({ status: 200, body: script.body });
  }
}

const ORDERS_URL = 'https://orders.test/asyncapi.yaml';
const CATALOG_URL = 'https://catalog.test/openapi.yaml';
const LEDGER_URL = 'https://ledger.test/asyncapi.yaml';

/** One corpus document, read the way the lifecycle reads a fetched body. */
function readCorpus(body: string, documentId: string): IRDocument {
  return normalizeSpecification(parseSpecification(body), { documentId });
}

/**
 * The local service: a mixed document that publishes to two addresses in two other services.
 *
 * Mixed because a merge said so, over two corpus documents of two families, per SPEC 15.1.
 */
function checkoutService(): FederationService {
  const inner = mergeDocuments(
    [
      { id: 'web', document: readCorpus(CHECKOUT_HTTP_BODY, 'checkout-http') },
      { id: 'bus', document: readCorpus(CHECKOUT_EVENTS_BODY, 'checkout-events') },
    ],
    { id: 'checkout', info: { title: 'Checkout', version: '1.0.0' } },
  ).document;

  // The augmented half, which is what a booted application's runtime pass produces: two
  // `@ApiPublishes` edges naming addresses this document has no channel for. The edges the inner
  // merge drew are kept, because dropping them would be this service pretending it has no graph
  // of its own.
  const document: IRDocument = {
    ...inner,
    relationships: [
      ...inner.relationships,
      {
        from: HANDLER,
        fromKind: 'node',
        to: MEASURED,
        toKind: 'event',
        type: 'publishes',
        confidence: 'declared',
      },
      {
        from: HANDLER,
        fromKind: 'node',
        to: MARKET_DATA,
        toKind: 'event',
        type: 'publishes',
        confidence: 'declared',
      },
    ],
  };

  return { id: 'checkout', document };
}

/** The lifecycle under test, with the failing remote's script chosen by the caller. */
function lifecycle(fetcher: ScriptedFetcher): RemoteLifecycleService {
  return new RemoteLifecycleService({
    remotes: [
      { id: 'orders', url: ORDERS_URL, prefix: '/orders' },
      { id: 'catalog', url: CATALOG_URL },
      { id: 'ledger', url: LEDGER_URL },
    ],
    services: [checkoutService()],
    document: { id: 'platform', info: { title: 'Platform', version: '2026.8' } },
    refreshMs: 3_600_000,
    fetcher,
  });
}

let running: RemoteLifecycleService | undefined;

afterEach(() => {
  running?.stop();
  running = undefined;
});

/** A fetcher with every remote up, ready for one of them to be taken down. */
function scripted(): ScriptedFetcher {
  const fetcher = new ScriptedFetcher();
  fetcher.set(ORDERS_URL, { kind: 'ok', body: ORDERS_BODY });
  fetcher.set(CATALOG_URL, { kind: 'ok', body: CATALOG_BODY });
  fetcher.set(LEDGER_URL, { kind: 'ok', body: LEDGER_BODY });
  return fetcher;
}

/** Boots a lifecycle with every remote up except the ones named. */
async function boot(down: readonly string[] = []): Promise<RemoteLifecycleService> {
  const fetcher = scripted();
  for (const id of down) {
    fetcher.set(id === 'ledger' ? LEDGER_URL : ORDERS_URL, { kind: 'down' });
  }

  const service = lifecycle(fetcher);
  running = service;
  await service.start();
  return service;
}

/** The merged document of a booted lifecycle, or `undefined` if it never became ready. */
function readyDocument(service: RemoteLifecycleService): IRDocument | undefined {
  const snapshot = service.snapshot();
  return snapshot.availability === 'ready' ? snapshot.document : undefined;
}

/** Every address the merged document's channels answer. */
function channelAddresses(document: IRDocument): string[] {
  return [...document.nodes.values()].flatMap((node) =>
    node.kind === 'channel' && node.address !== undefined ? [node.address] : [],
  );
}

/** The one edge of the whole graph whose target end carries this name. */
function edgeTo(document: IRDocument, name: string): IRTopologyEdge | undefined {
  return buildTopology(document)
    .groups.flatMap((group) => group.edges)
    .find((edge) => edge.to.name === name);
}

describe('a federation of an HTTP, an events and a mixed service', () => {
  it('should be three kinds before anything is merged, which is what makes the rest reachable', () => {
    // Given the bytes the three remotes serve and the two the local service is merged from. The
    // merged answers in every case below mean nothing unless the inputs really were of these
    // families: a corpus file quietly replaced by one of the other family would make `mixed`
    // impossible to reach, and this suite would fail for a reason nobody could read.
    // When each is read by the same dispatch the lifecycle uses
    const catalog = readCorpus(CATALOG_BODY, 'catalog');
    const orders = readCorpus(ORDERS_BODY, 'orders');
    const ledger = readCorpus(LEDGER_BODY, 'ledger');
    const checkout = checkoutService().document;

    // Then two families arrived off the wire and the third was produced by a merge, which is the
    // only producer of it there is
    expect([catalog.kind, orders.kind, ledger.kind]).toEqual(['http', 'events', 'events']);
    expect(checkout.kind).toBe('mixed');
    expect([...checkout.nodes.values()].map((node) => node.kind)).toContain('operation');
    expect([...checkout.nodes.values()].map((node) => node.kind)).toContain('channel');

    // And the two addresses the local service publishes to really are documented by the two event
    // remotes, so the cross service edges below are edges between two real documents
    expect(channelAddresses(orders)).toContain(MEASURED);
    expect(channelAddresses(ledger)).toContain(MARKET_DATA);
    expect(checkout.nodes.has(HANDLER)).toBe(true);
    expect(channelAddresses(checkout)).not.toContain(MEASURED);
  });

  it('should fetch an events remote at all, which the OpenAPI only reader refused', async () => {
    // Given the three remotes and the one local service
    const service = await boot();

    // When
    const snapshot = service.snapshot();

    // Then every remote is fresh, including the two serving AsyncAPI, which before `T053` failed
    // with "the document has no openapi version field" and left federation HTTP only on the wire
    expect(snapshot.remotes.map((remote) => [remote.id, remote.status])).toEqual([
      ['catalog', 'fresh'],
      ['ledger', 'fresh'],
      ['orders', 'fresh'],
    ]);
    expect(snapshot.availability).toBe('ready');
  });

  it('should merge the four into one document of every kind, and render it as one page', async () => {
    // Given the booted federation
    const service = await boot();
    const document = readyDocument(service);
    expect(document).toBeDefined();
    if (document === undefined) return;

    // When the merged document is rendered as the one page a reader lands on
    const rendered = await renderPage(document, { markdown, basePath: '/docs' });

    // Then the kinds really were three, the merged kind is mixed, and one page carries both
    // families of node
    expect((document.services ?? []).map((entry) => [entry.id, entry.kind]).sort()).toEqual([
      ['catalog', 'http'],
      ['checkout', 'mixed'],
      ['ledger', 'events'],
      ['orders', 'events'],
    ]);
    expect(document.kind).toBe('mixed');

    const kinds = new Set([...document.nodes.values()].map((node) => node.kind));
    expect(kinds).toEqual(new Set(['operation', 'channel']));
    expect(rendered.appHtml).toContain('oref-section-topology');
    expect(rendered.appHtml).toContain('Platform');
  });

  it('should span services in the topology graph, which is the reason the feature exists', async () => {
    // Given the booted federation, where the local service publishes to an address the events
    // remote documents and that remote is mounted under a prefix, so the address moved
    const service = await boot();
    const document = readyDocument(service);
    expect(document).toBeDefined();
    if (document === undefined) return;

    // When
    const placed = edgeTo(document, MOVED);

    // Then the channel really moved under the remote's prefix, so the edge below found it through
    // the merge rather than by the name never having changed
    expect(channelAddresses(document)).toContain(MOVED);
    expect(channelAddresses(document)).not.toContain(MEASURED);

    // And the two ends of that edge live in two different services
    const source = document.nodes.get(`checkout_${HANDLER}`);
    const target = document.nodes.get(placed?.to.nodeId ?? '');
    expect(source?.serviceId).toBe('checkout');
    expect(target?.serviceId).toBe('orders');
    expect(placed?.to.outside).toBe(false);
  });

  it('should draw an edge into an unavailable remote as unknown rather than dropping it', async () => {
    // Given the same federation with the ledger remote down and nothing cached for it, so it has
    // no version and does not join the composition at all
    const service = await boot(['ledger']);
    const snapshot = service.snapshot();
    const document = readyDocument(service);

    // Then the remote is really unavailable and its channel is really absent, which is what makes
    // the assertions below about the edge rather than about a remote that quietly worked
    expect(snapshot.remotes.find((remote) => remote.id === 'ledger')?.status).toBe('failed');
    expect(document).toBeDefined();
    if (document === undefined) return;
    expect((document.services ?? []).map((entry) => entry.id)).not.toContain('ledger');
    expect(channelAddresses(document)).not.toContain(MARKET_DATA);

    // When the page is rendered
    const rendered = await renderPage(document, { markdown, basePath: '/docs' });
    const settled = edgeTo(document, MARKET_DATA);

    // Then the edge is still in the graph, still says what it is, and says that its target is
    // outside what this composition knows. Dropping it would tell a reader the handler publishes
    // nothing; drawing it like a resolved end would tell them the channel is here.
    expect(settled?.to.name).toBe(MARKET_DATA);
    expect(settled?.to.nodeId).toBeUndefined();
    expect(settled?.to.outside).toBe(true);
    expect(rendered.appHtml).toContain(MARKET_DATA);
    expect(rendered.appHtml).toContain('oref-topology-outside');
  });

  it('should resolve that same edge once the remote comes back, which is the control', async () => {
    // Given the ledger remote down, and the edge drawn as outside
    const fetcher = scripted();
    fetcher.set(LEDGER_URL, { kind: 'down' });

    const service = lifecycle(fetcher);
    running = service;
    await service.start();

    const beforeDocument = readyDocument(service);
    const beforeEdge = beforeDocument ? edgeTo(beforeDocument, MARKET_DATA) : undefined;
    expect(beforeEdge?.to.outside).toBe(true);

    // When the remote answers and the lifecycle picks it up
    fetcher.set(LEDGER_URL, { kind: 'ok', body: LEDGER_BODY });
    await service.refresh('ledger');
    const afterDocument = readyDocument(service);
    expect(afterDocument).toBeDefined();
    if (afterDocument === undefined) return;

    // Then the same edge resolves to the channel the remote brought, so "outside" was a statement
    // about the composition rather than about the edge
    const afterEdge = edgeTo(afterDocument, MARKET_DATA);

    expect(service.snapshot().remotes.find((remote) => remote.id === 'ledger')?.status).toBe(
      'fresh',
    );
    expect(afterEdge?.to.outside).toBe(false);
    expect(afterDocument.nodes.get(afterEdge?.to.nodeId ?? '')?.serviceId).toBe('ledger');
  });
});

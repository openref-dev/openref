import { describe, expect, it } from 'vitest';
import {
  buildTopology,
  hashDocument,
  normalizeAsyncApiDocument,
  normalizeOpenApiDocument,
  type IRDocument,
  type IRRelationship,
} from '@openref/core';
import { mergeDocuments } from '../../src/merge/domain/merge-documents';
import { RemoteLifecycleService } from '../../src/remote/application/services/remote-lifecycle.service';
import { ScriptedFetcher, SerializingCacheDriver } from '../mocks/remotes';

/**
 * The M5 adversarial pass over mixed federation, per `T054`.
 *
 * WHAT IS ATTACKED HERE THAT `adversarial-m4.spec.ts` COULD NOT BE. M4 merged documents whose
 * `kind` a fixture builder wrote; M5 put real channels, real event names and a real AsyncAPI
 * reader on the wire, so the inputs worth driving are the ones that live between the two address
 * spaces the merge holds at once: a channel address that a service prefix moves, an event name
 * that no address moves with, and a cached body of the other family.
 */

function eventsService(id: string, addresses: readonly string[]): IRDocument {
  return normalizeAsyncApiDocument(
    {
      asyncapi: '3.0.0',
      info: { title: id, version: '1' },
      channels: Object.fromEntries(
        addresses.map((address, index) => [`c${String(index)}`, { address }]),
      ),
    },
    { documentId: id },
  );
}

function httpService(id: string, publishes: readonly string[]): IRDocument {
  const base = normalizeOpenApiDocument(
    {
      openapi: '3.1.0',
      info: { title: id, version: '1' },
      paths: { '/p': { get: { responses: { 200: { description: 'ok' } } } } },
    },
    { documentId: id },
  );

  const relationships: IRRelationship[] = publishes.map((name) => ({
    from: 'get-p',
    fromKind: 'node',
    to: name,
    toKind: 'event',
    type: 'publishes',
    confidence: 'declared',
  }));

  return { ...base, relationships };
}

describe('service prefixes crafted against channel addresses', () => {
  it('should give two services that would land on one address two addresses', () => {
    // Given a service that declares the mount `/x` and a service whose id is `x`. Under
    // `namespace` the second namespaces with `servicePrefix('x')`, which is the same `/x`, so both
    // want the merged channel address `x/y`. This is the collision a hostile configuration would
    // craft on purpose and a careless one would hit by accident.
    const merged = mergeDocuments(
      [
        { id: 'a', prefix: '/x', document: eventsService('a', ['y']) },
        { id: 'x', document: eventsService('x', ['y']) },
      ],
      { id: 'platform', info: { title: 'Platform', version: '1.0.0' }, onConflict: 'namespace' },
    );

    // When
    const addresses = [...merged.document.nodes.values()]
      .filter((node) => node.kind === 'channel')
      .map((node) => node.address);

    // Then the two channels answer two addresses. Two channels sharing one address in a merged
    // document is the state SPEC 9.5 has to leave unresolved forever, so the merge is the last
    // place it can be prevented.
    expect(addresses).toHaveLength(2);
    expect(new Set(addresses).size).toBe(2);
  });

  it('should resolve a forged event name to nothing before the merge, which is the baseline', () => {
    // Given a service whose operation names an event no channel of any source document answers.
    // The point of this case is the "before": it is what makes the next one a finding about the
    // merge rather than about a document that was always ambiguous.
    const web = httpService('web', ['a/created']);
    const a = eventsService('a', ['created']);
    const b = eventsService('b', ['created']);

    // When, Then no source document holds a channel at that address, and the graph over the
    // unmerged document draws the end as leading outside the known set, which is the truth.
    for (const document of [web, a, b]) {
      expect(
        [...document.nodes.values()].some(
          (node) => node.kind === 'channel' && node.address === 'a/created',
        ),
      ).toBe(false);
    }
    expect(buildTopology(web).groups[0]?.edges[0]?.to.outside).toBe(true);
  });

  it('should leave an event name alone when two services answer its address', () => {
    // Given the same three services. SPEC 15.1's rule is that only an address exactly one channel
    // of the whole federation answers is moved, so `created` is not moved and stays as written.
    const merged = mergeDocuments(
      [
        { id: 'a', document: eventsService('a', ['created']) },
        { id: 'b', document: eventsService('b', ['created']) },
        { id: 'web', document: httpService('web', ['created']) },
      ],
      { id: 'platform', info: { title: 'Platform', version: '1.0.0' }, onConflict: 'namespace' },
    );

    // When, Then the two channels moved under their prefixes, the event name did not, and no
    // event rename was reported, because nothing moved it.
    expect(
      [...merged.document.nodes.values()]
        .filter((node) => node.kind === 'channel')
        .map((node) => node.address)
        .sort(),
    ).toEqual(['a/created', 'b/created']);
    expect(merged.document.relationships.map((edge) => edge.to)).toEqual(['created']);
    expect(merged.report.renames.filter((rename) => rename.kind === 'event-name')).toEqual([]);
  });
});

describe('a remote body of the other family, and one of both', () => {
  it('should serve an events remote from its cache and refuse a body naming both specifications', async () => {
    // Given a remote whose stored text is a real AsyncAPI document, revived through the same
    // reader dispatch SPEC 15.2 records, and a second remote whose stored text declares `openapi`
    // and `asyncapi` at once, which is the shape `T054` found being read as one of the two with
    // the other half dropped. A remote is exactly where such a body arrives from somewhere nobody
    // controls.
    const eventsBody = JSON.stringify({
      asyncapi: '3.0.0',
      info: { title: 'Events', version: '1' },
      channels: { c: { address: 'orders.created' } },
    });
    const bothBody = JSON.stringify({
      openapi: '3.1.0',
      asyncapi: '3.0.0',
      info: { title: 'Two', version: '1' },
      paths: { '/orders': { get: { responses: { 200: { description: 'ok' } } } } },
      channels: { c: { address: 'orders.created' } },
    });

    const fetcher = new ScriptedFetcher();
    fetcher.set('https://events.example.com/asyncapi.json', { kind: 'ok', body: eventsBody });
    fetcher.set('https://both.example.com/spec.json', { kind: 'ok', body: bothBody });

    const lifecycle = new RemoteLifecycleService({
      remotes: [
        { id: 'events', url: 'https://events.example.com/asyncapi.json' },
        { id: 'both', url: 'https://both.example.com/spec.json' },
      ],
      document: { id: 'platform', info: { title: 'Platform', version: '1.0.0' } },
      refreshMs: 1000,
      timeoutMs: 500,
      fetcher,
      cache: new SerializingCacheDriver(),
      failureMode: 'degrade',
    });

    // When
    await lifecycle.start();
    const snapshot = lifecycle.snapshot();
    lifecycle.stop();

    const state = (id: string): { status: string; message: string; code: string } => {
      const found = snapshot.remotes.find((remote) => remote.id === id);
      if (found === undefined) throw new Error(`no remote ${id} in the snapshot`);
      return {
        status: found.status,
        message: found.lastError?.message ?? '',
        code: found.lastError?.code ?? '',
      };
    };

    // Then the events remote is fresh, which is the control that says this reader really reads the
    // other family, and the both-roots remote failed by name rather than arriving as an events
    // document with every endpoint it declared silently gone.
    expect(state('events').status).toBe('fresh');
    expect(state('both').status).toBe('failed');
    expect(state('both').code).toBe('NORM_DOCUMENT_INVALID');
    expect(state('both').message).toContain('both root members');

    // And the composition holds the events remote's channel and nothing of the refused one, which
    // is `degrade` doing what SPEC 15.2 says: one bad remote does not take the others down, and it
    // does not arrive half read either.
    expect(snapshot.availability).toBe('ready');
    const composed = snapshot.availability === 'ready' ? snapshot.document : undefined;
    expect(composed?.services?.map((service) => service.id)).toEqual(['events']);
  });
});

describe('a synthesized document and a fetched one that collide', () => {
  it('should keep two services whose documents are identical apart, node id and address', () => {
    // Given two services carrying byte identical documents under two ids, which is what a local
    // synthesized document and a remote copy of the same application look like to the merge
    const merged = mergeDocuments(
      [
        { id: 'local', document: eventsService('same', ['orders.created']) },
        { id: 'remote', document: eventsService('same', ['orders.created']) },
      ],
      { id: 'platform', info: { title: 'Platform', version: '1.0.0' }, onConflict: 'namespace' },
    );

    // When, Then both survive with their own ids and their own addresses, per SPEC 15's rule that
    // `first-wins` and `namespace` decide the name and never the right to exist
    expect([...merged.document.nodes.keys()]).toEqual([
      'local_channel-orders-created',
      'remote_channel-orders-created',
    ]);
    expect(
      [...merged.document.nodes.values()].map((node) =>
        node.kind === 'channel' ? node.address : undefined,
      ),
    ).toEqual(['local/orders.created', 'remote/orders.created']);
    expect(merged.document.services?.map((service) => service.id)).toEqual(['local', 'remote']);
  });

  it('should refuse two services configured under one id rather than merging them into neither', () => {
    // Given a configuration that names one id twice, which is what a copied entry produces
    // When, Then
    expect(() =>
      mergeDocuments(
        [
          { id: 'same', document: eventsService('a', ['x']) },
          { id: 'same', document: eventsService('b', ['y']) },
        ],
        { id: 'platform', info: { title: 'Platform', version: '1.0.0' } },
      ),
    ).toThrow(/two services are configured with the id/u);
  });

  it('should give one hash whichever order a mixed federation is configured in', () => {
    // Given three services of two kinds, configured forwards and backwards
    const services = [
      { id: 'a', document: eventsService('a', ['one']) },
      { id: 'b', document: eventsService('b', ['two']) },
      { id: 'web', document: httpService('web', ['one']) },
    ];

    // When
    const forwards = mergeDocuments(services, {
      id: 'platform',
      info: { title: 'Platform', version: '1.0.0' },
      onConflict: 'namespace',
    });
    const backwards = mergeDocuments([...services].reverse(), {
      id: 'platform',
      info: { title: 'Platform', version: '1.0.0' },
      onConflict: 'namespace',
    });

    // Then. The two inputs are asserted distinct first, so this cannot pass by comparing one
    // arrangement with itself.
    expect([...services].reverse().map((service) => service.id)).not.toEqual(
      services.map((service) => service.id),
    );
    expect(hashDocument(backwards.document)).toBe(hashDocument(forwards.document));
    expect(backwards.document.kind).toBe('mixed');
  });
});

import { describe, expect, it } from 'vitest';
import { buildTopology, hash } from '@openref/core';
import type { IRDocument, IRRelationship } from '@openref/core';
import { mergeDocuments } from '../../src/index';
import type { FederationService } from '../../src/index';
import { buildDocument, channel, operation } from '../mocks/documents';

/**
 * The relationship whose two ends live in two remotes, per SPEC 15.1 and the `T053` done-when.
 *
 * WHY THIS CANNOT BE RESOLVED ANYWHERE ELSE. `@ApiPublishes('orders.placed')` on an HTTP handler
 * produces an `event` end, which SPEC 9.1 defines as a name this document has no node for: the
 * channel is documented by the event service next door. Before the merge there is no second
 * document to resolve against. After the merge it is too late, because the channel's address has
 * moved under its own service's prefix while the event name stayed exactly as it was written. So
 * the merge is the one place the two can meet, and the map it uses is federation wide.
 *
 * EVERY CASE ASSERTS THE ADDRESS REALLY MOVED BEFORE IT ASSERTS THE EDGE FOUND IT. A federation
 * with no prefixes resolves this by accident, because the name never had to move, and a suite
 * built on one would stay green with the whole mechanism deleted.
 */

/** The event service: one channel, at the address the other service publishes to. */
function eventsService(prefix?: string): FederationService {
  const document = buildDocument({
    id: 'orders-api',
    title: 'Orders',
    kind: 'events',
    nodes: [channel({ id: 'channel-placed', address: 'orders.placed' })],
  });

  return prefix === undefined ? { id: 'orders', document } : { id: 'orders', document, prefix };
}

/** The HTTP service: one handler, publishing to an address it documents no channel for. */
function httpService(address = 'orders.placed'): FederationService {
  return {
    id: 'checkout',
    document: buildDocument({
      id: 'checkout-api',
      title: 'Checkout',
      nodes: [operation({ id: 'post-checkout', path: '/checkout', method: 'post' })],
      relationships: [
        {
          from: 'post-checkout',
          fromKind: 'node',
          to: address,
          toKind: 'event',
          type: 'publishes',
          confidence: 'declared',
        },
      ],
    }),
  };
}

const MERGED = { id: 'platform', info: { title: 'Platform', version: '1.0.0' } } as const;

/** The merged address of the one channel in the document, so a case can say it moved. */
function channelAddress(document: IRDocument): string | undefined {
  const found = [...document.nodes.values()].find((node) => node.kind === 'channel');
  return found?.kind === 'channel' ? found.address : undefined;
}

describe('mergeDocuments, an event end that names another service channel', () => {
  it('should move the event name onto the address the target channel now answers', () => {
    // Given an event service mounted under a prefix, so its channel address moves, and an HTTP
    // service publishing to the address the event service's own document wrote
    const services = [httpService(), eventsService('/orders')];

    // When
    const { document } = mergeDocuments(services, MERGED);
    const topology = buildTopology(document);

    // Then the channel really moved, which is what makes the resolution below a move rather than
    // a coincidence, and the edge points at the merged channel node
    expect(channelAddress(services[1]?.document ?? document)).toBe('orders.placed');
    expect(channelAddress(document)).toBe('orders/orders.placed');

    const edge = document.relationships[0];
    expect(edge?.toKind).toBe('event');
    expect(edge?.to).toBe('orders/orders.placed');

    const target = topology.groups[0]?.edges[0]?.to;
    expect(target?.nodeId).toBe('orders_channel-placed');
    expect(target?.outside).toBe(false);
  });

  it('should leave the edge unresolved and outside when the merge is deleted from under it', () => {
    // Given the same two services, merged with no prefix anywhere, so nothing moves. This is the
    // control for the case above: the same assertions pass here for a different reason, and a
    // suite carrying only this one would prove nothing about the move.
    const { document } = mergeDocuments([httpService(), eventsService()], MERGED);

    // When
    const target = buildTopology(document).groups[0]?.edges[0]?.to;

    // Then the address did not move, and the report says so by carrying no move for it
    expect(channelAddress(document)).toBe('orders.placed');
    expect(target?.nodeId).toBe('orders_channel-placed');
  });

  it('should leave an event name alone when two services answer the same address', () => {
    // Given two event services whose channels carry one address, which is the ambiguity SPEC 9.5
    // refuses to resolve, lifted to the federation by SPEC 15.1
    const second: FederationService = {
      id: 'archive',
      document: buildDocument({
        id: 'archive-api',
        title: 'Archive',
        kind: 'events',
        nodes: [channel({ id: 'channel-placed', address: 'orders.placed' })],
      }),
    };

    // When
    const { document, report } = mergeDocuments([httpService(), eventsService(), second], MERGED);
    const target = buildTopology(document).groups[0]?.edges[0]?.to;

    // Then both channels are in the merged document under two addresses, neither of which is the
    // one the edge names, so the edge resolves to nothing and is drawn as leading outside. Moving
    // it onto either channel would be the guess the confidence policy exists to refuse.
    const addresses = [...document.nodes.values()].flatMap((node) =>
      node.kind === 'channel' ? [node.address] : [],
    );

    expect(addresses.sort()).toEqual(['archive/orders.placed', 'orders/orders.placed']);
    expect(document.relationships[0]?.to).toBe('orders.placed');
    expect(target?.nodeId).toBeUndefined();
    expect(target?.outside).toBe(true);
    expect(report.renames.filter((rename) => rename.kind === 'event-name')).toEqual([]);
  });

  it('should move the event name when onConflict renamed the address rather than a prefix', () => {
    // Given the second half of SPEC 15.1's sentence, which is the half a prefix cannot reach: an
    // address that moves because two channels contested it, not because its service is mounted
    // somewhere. Two channels reach one merged address only if their source addresses differ and
    // prefixing brings them together, since two channels writing one address is the ambiguity the
    // case above leaves alone. So `alpha` is mounted where `beta` already writes.
    //
    // A CHANNEL AGAINST AN OPERATION DOES NOT REACH IT, MEASURED RATHER THAN ASSUMED: a channel
    // whose address equals an operation's path does not contest it, and both keep what they wrote.
    // Channel against channel is the only construction that gets here.
    const alpha: FederationService = {
      id: 'alpha',
      prefix: '/orders',
      document: buildDocument({
        id: 'alpha-api',
        title: 'Alpha',
        kind: 'events',
        nodes: [channel({ id: 'channel-placed', address: 'placed' })],
      }),
    };
    const beta: FederationService = {
      id: 'beta',
      document: buildDocument({
        id: 'beta-api',
        title: 'Beta',
        kind: 'events',
        nodes: [channel({ id: 'channel-orders-placed', address: 'orders/placed' })],
      }),
    };

    // Then the collision is really there, asserted before it is resolved: the two services wrote
    // two different addresses, and alpha alone lands exactly on what beta wrote
    expect(channelAddress(alpha.document)).toBe('placed');
    expect(channelAddress(beta.document)).toBe('orders/placed');
    expect(channelAddress(mergeDocuments([alpha], MERGED).document)).toBe('orders/placed');

    // When the three are merged under the default namespace mode, with a handler publishing to
    // the address beta wrote and only beta answered
    const { document, report } = mergeDocuments(
      [httpService('orders/placed'), alpha, beta],
      MERGED,
    );

    // Then both channels were renamed out of the contest, and the reason is the conflict rather
    // than either service's mount, which is what makes this a different branch and not the first
    // case in different clothes
    expect(
      report.renames
        .filter((rename) => rename.kind === 'channel-address')
        .map((rename) => [rename.serviceId, rename.from, rename.to, rename.reason]),
    ).toEqual([
      ['alpha', 'placed', 'alpha/orders/placed', 'address-conflict'],
      ['beta', 'orders/placed', 'beta/orders/placed', 'address-conflict'],
    ]);

    // And the event name went with the channel that actually answered it before the merge, which
    // is beta's, rather than with the address that merely looks like what was written
    expect(report.renames.filter((rename) => rename.kind === 'event-name')).toEqual([
      {
        kind: 'event-name',
        serviceId: 'checkout',
        from: 'orders/placed',
        to: 'beta/orders/placed',
        reason: 'target-moved',
        contestedBy: [],
      },
    ]);

    const target = buildTopology(document).groups[0]?.edges[0]?.to;
    expect(document.relationships[0]?.to).toBe('beta/orders/placed');
    expect(target?.nodeId).toBe('beta_channel-orders-placed');
    expect(target?.outside).toBe(false);
  });

  it('should record the move so the report still inverts the merge', () => {
    // Given the moved case
    const services = [httpService(), eventsService('/orders')];

    // When
    const { document, report } = mergeDocuments(services, MERGED);

    // Then the move is one rename, recorded against the service that DECLARED the edge rather
    // than the one that owns the channel, because inverting the merge means asking each service
    // what it called a thing and the two answers come from two services
    expect(report.renames.filter((rename) => rename.kind === 'event-name')).toEqual([
      {
        kind: 'event-name',
        serviceId: 'checkout',
        from: 'orders.placed',
        to: 'orders/orders.placed',
        reason: 'target-moved',
        contestedBy: [],
      },
    ]);

    // And the whole edge comes back from the merged document and the report alone, which is the
    // losslessness claim of `T044` applied to what `T053` added
    const inverse = new Map<string, string>();
    for (const rename of report.renames) {
      if (rename.serviceId !== 'checkout') continue;
      if (rename.kind === 'node' || rename.kind === 'event-name')
        inverse.set(rename.to, rename.from);
    }

    const restored: IRRelationship[] = document.relationships.map((edge) => ({
      ...edge,
      from: inverse.get(edge.from) ?? edge.from,
      to: inverse.get(edge.to) ?? edge.to,
    }));

    expect(hash(restored)).toBe(hash([...(services[0]?.document.relationships ?? [])]));
  });

  it('should record no move for a federation in which no address moved', () => {
    // Given the two services with no prefix and no conflict
    // When
    const { report } = mergeDocuments([httpService(), eventsService()], MERGED);

    // Then, with the renames list asserted non empty first, so the absence below is a filter over
    // a real report rather than over an empty one
    expect(report.renames.length).toBeGreaterThan(0);
    expect(report.renames.filter((rename) => rename.kind === 'event-name')).toEqual([]);
  });

  it('should move an event name the declaring service also holds a channel for', () => {
    // Given an HTTP service that carries its own channel at the address it publishes to, mounted
    // under a prefix of its own. The name belongs to the address space of the whole federation,
    // not of the service that wrote it, so it moves with whichever channel answers it.
    const own: FederationService = {
      id: 'checkout',
      prefix: '/checkout',
      document: buildDocument({
        id: 'checkout-api',
        title: 'Checkout',
        kind: 'mixed',
        nodes: [
          operation({ id: 'post-checkout', path: '/checkout', method: 'post' }),
          channel({ id: 'channel-placed', address: 'orders.placed' }),
        ],
        relationships: [
          {
            from: 'post-checkout',
            fromKind: 'node',
            to: 'orders.placed',
            toKind: 'event',
            type: 'publishes',
            confidence: 'declared',
          },
        ],
      }),
    };

    // When
    const { document, report } = mergeDocuments([own], MERGED);

    // Then
    expect(channelAddress(document)).toBe('checkout/orders.placed');
    expect(document.relationships[0]?.to).toBe('checkout/orders.placed');
    expect(report.renames.find((rename) => rename.kind === 'event-name')?.reason).toBe(
      'target-moved',
    );
    expect(buildTopology(document).groups[0]?.edges[0]?.to.nodeId).toBe('checkout_channel-placed');
  });
});

describe('mergeDocuments over HTTP, events and mixed services at once', () => {
  /** A mixed service, which only a previous merge can produce, per SPEC 15.1. */
  function mixedService(): FederationService {
    const { document } = mergeDocuments(
      [
        {
          id: 'inner-http',
          document: buildDocument({
            id: 'inner-http-api',
            title: 'Inner HTTP',
            nodes: [operation({ id: 'get-inner', path: '/inner' })],
          }),
        },
        {
          id: 'inner-events',
          document: buildDocument({
            id: 'inner-events-api',
            title: 'Inner Events',
            kind: 'events',
            nodes: [channel({ id: 'channel-inner', address: 'inner.happened' })],
          }),
        },
      ],
      { id: 'inner', info: { title: 'Inner', version: '1.0.0' } },
    );

    return { id: 'inner', document };
  }

  function threeKinds(): FederationService[] {
    return [httpService('inner.happened'), eventsService(), mixedService()];
  }

  it('should merge one of each kind into one document that holds every node', () => {
    // Given three services whose kinds are asserted before the merge, so `mixed` below is a fold
    // of three real kinds rather than a default
    const services = threeKinds();
    expect(services.map((service) => service.document.kind)).toEqual(['http', 'events', 'mixed']);

    // When
    const { document } = mergeDocuments(services, MERGED);

    // Then every node of every service is in the one map, both kinds of node included
    const kinds = [...document.nodes.values()].map((node) => node.kind);
    expect(document.kind).toBe('mixed');
    expect(document.nodes.size).toBe(
      services.reduce((total, service) => total + service.document.nodes.size, 0),
    );
    expect(kinds.filter((kind) => kind === 'operation')).toHaveLength(2);
    expect(kinds.filter((kind) => kind === 'channel')).toHaveLength(2);
    expect((document.services ?? []).map((service) => service.kind)).toEqual([
      'http',
      'mixed',
      'events',
    ]);
  });

  it('should give one hash and one report whichever order the three are configured in', () => {
    // Given the six orderings of three services
    const orderings: readonly (readonly number[])[] = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];

    // When
    const results = orderings.map((order) => {
      const services = threeKinds();
      return mergeDocuments(
        order.map((index) => services[index] ?? services[0]).filter((entry) => entry !== undefined),
        MERGED,
      );
    });

    // Then, with the orderings asserted really different first, so one hash is a property of the
    // merge rather than of six identical inputs
    expect(new Set(orderings.map((order) => order.join(''))).size).toBe(6);
    expect(results.every((result) => result.report.serviceIds.length === 3)).toBe(true);
    expect(new Set(results.map((result) => result.document.hash)).size).toBe(1);
    expect(new Set(results.map((result) => hash(result.report))).size).toBe(1);
  });

  it('should span services in the topology, which is the reason the feature exists', () => {
    // Given the three, where the HTTP service publishes to an address the mixed service documents
    // as a channel, so the edge crosses a service boundary in both directions of the question
    const services = threeKinds();

    // When
    const { document } = mergeDocuments(services, MERGED);
    const topology = buildTopology(document);
    const target = topology.groups[0]?.edges[0]?.to;

    // Then the graph holds one edge whose ends are in two different services, which no single
    // document could produce
    const from = document.nodes.get(topology.groups[0]?.from.name ?? '');
    const to = document.nodes.get(target?.nodeId ?? '');

    expect(from?.serviceId).toBe('checkout');
    expect(to?.serviceId).toBe('inner');
    expect(to?.kind).toBe('channel');
    expect(target?.outside).toBe(false);
  });
});

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildDiffReport,
  buildTopology,
  CycleDepthError,
  normalizeAsyncApiDocument,
  normalizeOpenApiDocument,
  orderRelationships,
  parseSpecification,
  RefResolutionError,
  type IRChannel,
  type IRDocument,
  type IRNode,
  type IROperation,
  type IRRelationship,
} from '../../src/index';

const CORPUS = join(__dirname, '..', 'corpus', 'documents');
const EVENTS = join(__dirname, '..', 'events-corpus', 'documents');

function corpusDocument(name: string): IRDocument {
  return normalizeOpenApiDocument(parseSpecification(readFileSync(join(CORPUS, name), 'utf8')));
}

function eventsDocument(name: string): IRDocument {
  return normalizeAsyncApiDocument(parseSpecification(readFileSync(join(EVENTS, name), 'utf8')));
}

function channel(id: string, address: string): IRChannel {
  return {
    kind: 'channel',
    id,
    address,
    tags: [],
    deprecated: false,
    servers: [],
    operations: [],
    messages: [],
  };
}

function operation(id: string, method: string, path: string): IROperation {
  return {
    kind: 'operation',
    id,
    method,
    path,
    tags: [],
    deprecated: false,
    parameters: [],
    responses: [],
    security: [],
    servers: [],
  };
}

function edge(
  from: string,
  fromKind: IRRelationship['fromKind'],
  to: string,
  toKind: IRRelationship['toKind'],
  type: IRRelationship['type'] = 'publishes',
  confidence: IRRelationship['confidence'] = 'declared',
): IRRelationship {
  return { from, fromKind, to, toKind, type, confidence };
}

function documentWith(
  nodes: readonly IRNode[],
  relationships: readonly IRRelationship[],
): IRDocument {
  return {
    id: 'estate',
    kind: 'mixed',
    hash: '',
    info: { title: 'Estate', version: '1.0.0' },
    servers: [],
    navigation: [],
    nodes: new Map(nodes.map((node) => [node.id, node])),
    schemas: new Map(),
    security: [],
    relationships,
    webhooks: new Map(),
  };
}

describe('orderRelationships', () => {
  it('should fold an edge a document declared twice into one', () => {
    // Given two channel operations that say the same thing about the topology
    const twice = [
      edge('orders', 'service', 'channel-placed', 'node'),
      edge('orders', 'service', 'channel-placed', 'node'),
    ];

    // When
    const folded = orderRelationships(twice);

    // Then, the input had two and they were not the same object, so the fold is by value
    expect(twice).toHaveLength(2);
    expect(folded).toEqual([edge('orders', 'service', 'channel-placed', 'node')]);
  });

  it('should keep two edges that differ only in the kind of an end', () => {
    // Given one name that is a node in one edge and a service in the other, which is exactly the
    // case the old untyped `from` could not tell apart
    const both = [
      edge('payments', 'service', 'channel-a', 'node'),
      edge('payments', 'node', 'channel-a', 'node'),
    ];

    // When
    const folded = orderRelationships(both);

    // Then
    expect(folded).toHaveLength(2);
    expect(folded.map((entry) => entry.fromKind)).toEqual(['node', 'service']);
  });

  it('should produce one order from any input order', () => {
    // Given the same six edges in two different orders
    const edges = [
      edge('b', 'service', 'c', 'node'),
      edge('a', 'node', 'b', 'service', 'subscribes'),
      edge('c', 'node', 'd', 'node', 'calls'),
      edge('a', 'node', 'e', 'node', 'callback'),
      edge('z', 'service', 'y', 'node', 'webhook'),
      edge('a', 'node', 'b', 'service', 'subscribes', 'inferred'),
    ];

    // When
    const forwards = orderRelationships(edges);
    const backwards = orderRelationships([...edges].reverse());

    // Then, and the list is asserted non trivial first so that two empty lists cannot pass
    expect(forwards).toHaveLength(6);
    expect(backwards).toEqual(forwards);
  });
});

describe('buildTopology', () => {
  it('should group edges by their source and label a node end with what the node is', () => {
    // Given a service publishing onto a channel that an operation also calls
    const document = documentWith(
      [channel('channel-placed', 'orders.placed'), operation('post-orders', 'post', '/orders')],
      [
        edge('estate', 'service', 'channel-placed', 'node'),
        edge('post-orders', 'node', 'channel-placed', 'node'),
      ],
    );

    // When
    const topology = buildTopology(document);

    // Then, groups are ordered by the kind of their source and then by name, so a node group is
    // never interleaved with a service group
    expect(topology.groups.map((group) => group.from.name)).toEqual(['post-orders', 'estate']);
    expect(topology.groups[0]?.from.label).toBe('POST /orders');
    expect(topology.groups[1]?.from.label).toBe('estate');
    expect(topology.groups[0]?.edges[0]?.to).toEqual({
      name: 'channel-placed',
      kind: 'node',
      nodeId: 'channel-placed',
      label: 'orders.placed',
      outside: false,
    });
    expect(topology.edgeCount).toBe(2);
  });

  it('should mark an event nobody consumes as a dead end rather than dropping it', () => {
    // Given one event with a consumer and one with none
    const document = documentWith(
      [],
      [
        edge('orders', 'service', 'orders.placed', 'event'),
        edge('orders.placed', 'event', 'ledger', 'service', 'subscribes'),
        edge('orders', 'service', 'orders.archived', 'event'),
      ],
    );

    // When
    const topology = buildTopology(document);

    // Then, both edges are present, which is the half that says nothing was dropped
    const outgoing = topology.groups.find((group) => group.from.name === 'orders')?.edges ?? [];
    expect(outgoing.map((entry) => entry.to.name)).toEqual(['orders.archived', 'orders.placed']);
    expect(outgoing.map((entry) => entry.deadEnd)).toEqual([true, false]);
  });

  it('should resolve an event name to the one channel that answers the address', () => {
    // Given a channel whose address is the event name a decorator declared
    const document = documentWith(
      [channel('channel-orders-placed', 'orders.placed')],
      [edge('post-orders', 'node', 'orders.placed', 'event')],
    );

    // When
    const resolved = buildTopology(document).groups[0]?.edges[0]?.to;

    // Then the kind still records what was declared, and `nodeId` records what was found
    expect(resolved).toEqual({
      name: 'orders.placed',
      kind: 'event',
      nodeId: 'channel-orders-placed',
      label: 'orders.placed',
      outside: false,
    });
  });

  it('should leave an event name unresolved when two channels answer the address', () => {
    // Given the same address on two channels, which a federated estate produces
    const both = [
      channel('billing-placed', 'orders.placed'),
      channel('orders-placed', 'orders.placed'),
    ];
    const document = documentWith(both, [edge('post-orders', 'node', 'orders.placed', 'event')]);

    // When
    const topology = buildTopology(document);

    // Then, the two channels are asserted present first, so this is an ambiguity refused rather
    // than an address nothing held
    expect([...document.nodes.values()].filter((node) => node.kind === 'channel')).toHaveLength(2);
    expect(topology.groups[0]?.edges[0]?.to.nodeId).toBeUndefined();
    expect(topology.groups[0]?.edges[0]?.to.label).toBe('orders.placed');
  });

  it('should keep a node end whose node is not in this document, unresolved', () => {
    // Given an edge naming a node of a service that was not federated in
    const document = documentWith([], [edge('estate', 'service', 'channel-elsewhere', 'node')]);

    // When
    const end = buildTopology(document).groups[0]?.edges[0]?.to;

    // Then
    expect(end?.kind).toBe('node');
    expect(end?.nodeId).toBeUndefined();
    expect(end?.label).toBe('channel-elsewhere');
  });

  it('should treat a resolved event end and the node itself as one place in the graph', () => {
    // Given a handler publishing to an event name, and the channel that answers that address
    // declaring a consumer of its own under its node id
    const document = documentWith(
      [
        channel('channel-orders-placed', 'orders.placed'),
        operation('post-orders', 'post', '/orders'),
      ],
      [
        edge('post-orders', 'node', 'orders.placed', 'event'),
        edge('channel-orders-placed', 'node', 'ledger', 'service', 'subscribes'),
      ],
    );

    // When
    const topology = buildTopology(document);

    // Then the event end is not a dead end, because what it resolved to leads somewhere, and the
    // channel has one group rather than one per spelling
    const publish = topology.groups.find((group) => group.from.name === 'post-orders');
    expect(publish?.edges[0]?.to.nodeId).toBe('channel-orders-placed');
    expect(publish?.edges[0]?.deadEnd).toBe(false);
    expect(topology.groups.map((group) => group.from.label)).toEqual([
      'orders.placed',
      'POST /orders',
    ]);
  });

  it('should still call a resolved event a dead end when the channel leads nowhere', () => {
    // Given the same shape with the channel's own outgoing edge removed, which is the control for
    // the case above: the resolution is identical and only the consumer is gone
    const document = documentWith(
      [channel('channel-orders-placed', 'orders.placed')],
      [edge('post-orders', 'node', 'orders.placed', 'event')],
    );

    // When
    const topology = buildTopology(document);

    // Then
    expect(topology.groups[0]?.edges[0]?.to.nodeId).toBe('channel-orders-placed');
    expect(topology.groups[0]?.edges[0]?.deadEnd).toBe(true);
  });

  it('should arrange a cycle as three groups rather than walking it', () => {
    // Given a cycle of three services, which a real estate produces routinely
    const document = documentWith(
      [],
      [
        edge('a', 'service', 'b', 'service', 'calls'),
        edge('b', 'service', 'c', 'service', 'calls'),
        edge('c', 'service', 'a', 'service', 'calls'),
      ],
    );

    // When
    const topology = buildTopology(document);

    // Then every group holds one edge, nothing is a dead end, and the walk terminated
    expect(topology.groups.map((group) => group.from.name)).toEqual(['a', 'b', 'c']);
    expect(topology.groups.every((group) => group.edges.length === 1)).toBe(true);
    expect(topology.groups.flatMap((group) => group.edges).map((entry) => entry.deadEnd)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('should hold a graph of 500 relationships in one group per source and no more work', () => {
    // Given 500 distinct edges over 100 sources
    const many: IRRelationship[] = [];
    for (let index = 0; index < 500; index += 1)
      many.push(
        edge(
          `service-${String(index % 100).padStart(3, '0')}`,
          'service',
          `event-${String(index).padStart(3, '0')}`,
          'event',
        ),
      );
    const document = documentWith([], many);

    // When
    const topology = buildTopology(document);

    // Then, and the count is the interaction budget's subject: the markup is one row per edge and
    // one group per source, with no nesting that grows with the graph
    expect(topology.edgeCount).toBe(500);
    expect(topology.groups).toHaveLength(100);
    expect(topology.groups.every((group) => group.edges.length === 5)).toBe(true);
    expect(topology.groups.flatMap((group) => group.edges).every((entry) => entry.deadEnd)).toBe(
      true,
    );
  });

  it('should draw an edge the document repeated once rather than three times', () => {
    // Given a document that lists one edge three times, which only a hand assembled document can
    // be: every producer in the repository folds before this is reached
    const once = edge('estate', 'service', 'channel-a', 'node');
    const document = documentWith([], [once, once, once]);

    // When
    const topology = buildTopology(document);

    // Then, with the three asserted present in the document first, so the one below is a fold
    // rather than a document that only ever had one
    expect(document.relationships).toHaveLength(3);
    expect(topology.edgeCount).toBe(1);
    expect(topology.groups).toHaveLength(1);
    expect(topology.groups[0]?.edges).toHaveLength(1);
  });

  it('should change nothing on a real document, which is what the re-fold is insurance against', () => {
    // THE TIMEOUT BELOW IS A HANG CATCHER AND NOT A BUDGET, per F25, and it is declared because
    // this case is the class F25 names rather than the class vitest's default was chosen for.
    // MEASURED: reading and normalizing both corpora whole costs 3396 ms here on its own under V8
    // coverage instrumentation, against 4 ms for the next heaviest case in this file, and 5084 ms
    // in the full instrumented battery, which is 84 ms past vitest's 5000 ms default. That is why
    // the coverage gate went red on code nobody touched, and why which run it went red on moved:
    // the case sits on the line. The cost is the corpus's size, not a property of `buildTopology`:
    // the same case runs uninstrumented well inside the default and the suite is green there. And
    // nothing should be tuned against the number, which is why it is generous: an ordinary case
    // timing out still means exactly what it used to mean.
    //
    // Given every corpus document that declares an edge, HTTP and events both. `duplicateCount`
    // used to carry this and nothing read it; the property it stood for is asserted here instead
    const documents = [
      ...readdirSync(CORPUS)
        .filter((name) => /\.(ya?ml|json)$/.test(name))
        .map((name) => ({ name, load: () => corpusDocument(name) })),
      ...readdirSync(EVENTS)
        .filter((name) => /\.(ya?ml|json)$/.test(name))
        .map((name) => ({ name, load: () => eventsDocument(name) })),
    ];

    // When, every document folded a second time by the view. THE EVENT CLASS IS COUNTED ON THE
    // SAME WALK, per SPEC 15.1, because it is the same forty documents and a second walk would
    // buy a second copy of the cost this comment is about. An end of kind `event` is what
    // `@ApiPublishes` produces and nothing else does, so no published document can carry one; that
    // is the recorded zero the measurement in SPEC 15.1 rests on, and until this line it had no
    // runner at all while the other half of the ratio had two.
    let withEdges = 0;
    let refolded = 0;
    let documentsRead = 0;
    const eventClassEnds: string[] = [];
    for (const entry of documents) {
      const document = entry.load();
      documentsRead += 1;
      for (const edge of document.relationships) {
        if (edge.fromKind === 'event' || edge.fromKind === 'undeclared-event') {
          eventClassEnds.push(`${entry.name} ${edge.from}`);
        }
        if (edge.toKind === 'event' || edge.toKind === 'undeclared-event') {
          eventClassEnds.push(`${entry.name} ${edge.to}`);
        }
      }
      if (document.relationships.length === 0) continue;
      withEdges += 1;
      if (buildTopology(document).edgeCount !== document.relationships.length) refolded += 1;
    }

    // Then, with the population asserted non empty first, so zero re-folds is a measurement and
    // not an empty loop
    expect(withEdges).toBeGreaterThan(20);
    expect(refolded).toBe(0);

    // And the whole corpus, both families, carries no end of the event class, over documents that
    // were asserted above to carry edges in the first place
    expect(documentsRead).toBe(40);
    expect(eventClassEnds).toEqual([]);
  }, 60_000);
});

describe('buildTopology, the end that leads out of the known set', () => {
  /** The same document `documentWith` builds, plus the service list a merged document carries. */
  function federated(
    nodes: readonly IRNode[],
    relationships: readonly IRRelationship[],
    serviceIds: readonly string[],
  ): IRDocument {
    return {
      ...documentWith(nodes, relationships),
      services: serviceIds.map((id) => ({
        id,
        documentId: `${id}-api`,
        documentHash: '',
        kind: 'http' as const,
        info: { title: id, version: '1.0.0' },
        servers: [],
      })),
    };
  }

  it('should mark a service nobody federated in and leave a federated one unmarked', () => {
    // Given a merged document of two services, one of which declares an edge to a third that is
    // not in the federation, which is the estate being larger than the composition
    const document = federated(
      [],
      [
        edge('orders', 'service', 'billing', 'service', 'calls'),
        edge('orders', 'service', 'ledger-service', 'service', 'calls'),
      ],
      ['billing', 'orders'],
    );

    // When
    const topology = buildTopology(document);
    const targets = topology.groups[0]?.edges.map((entry) => entry.to) ?? [];

    // Then, with the federation membership asserted first so the negative below is a reading of
    // the service list rather than of an empty one. Both edges are drawn, which is the half that
    // says nothing was dropped, and only the stranger is marked
    expect((document.services ?? []).map((service) => service.id)).toEqual(['billing', 'orders']);
    expect(targets.map((end) => end.name)).toEqual(['billing', 'ledger-service']);
    expect(targets.map((end) => end.outside)).toEqual([false, true]);
    expect(targets.every((end) => end.nodeId === undefined)).toBe(true);
  });

  it('should read an unmerged document own id as the one service it knows, per SPEC 9.1', () => {
    // Given a document that was never merged, so its only service name is its own id
    const document = documentWith(
      [],
      [
        edge('estate', 'service', 'orders.placed', 'event'),
        edge('stranger', 'service', 'orders.placed', 'event'),
      ],
    );

    // When
    const topology = buildTopology(document);

    // Then, and the document really carries no service list, which is what makes the id the rule
    expect(document.services).toBeUndefined();
    expect(document.id).toBe('estate');
    expect(topology.groups.map((group) => [group.from.name, group.from.outside])).toEqual([
      ['estate', false],
      ['stranger', true],
    ]);
  });

  it('should mark a node end whose node is not in this document and not one that is', () => {
    // Given one edge into a node the document holds and one into a node it does not, which is
    // what a service dropped from a composition leaves behind
    const document = documentWith(
      [operation('post-orders', 'post', '/orders')],
      [
        edge('estate', 'service', 'post-orders', 'node'),
        edge('estate', 'service', 'billing_get-invoices', 'node'),
      ],
    );

    // When
    const topology = buildTopology(document);
    const targets = topology.groups[0]?.edges.map((entry) => entry.to) ?? [];

    // Then, with the present node asserted present first, so `false` below is a resolution
    expect(document.nodes.has('post-orders')).toBe(true);
    expect(document.nodes.has('billing_get-invoices')).toBe(false);
    expect(targets.map((end) => [end.name, end.outside, end.nodeId])).toEqual([
      ['billing_get-invoices', true, undefined],
      ['post-orders', false, 'post-orders'],
    ]);
  });

  it('should mark an event address no channel answers and leave an answered one unmarked', () => {
    // Given a channel and an event name nothing here documents
    const document = documentWith(
      [channel('channel-placed', 'orders.placed')],
      [
        edge('post-orders', 'node', 'orders.placed', 'event'),
        edge('post-orders', 'node', 'invoices.raised', 'event'),
      ],
    );

    // When
    const targets = buildTopology(document).groups[0]?.edges.map((entry) => entry.to) ?? [];

    // Then
    expect(targets.map((end) => [end.name, end.outside])).toEqual([
      ['invoices.raised', true],
      ['orders.placed', false],
    ]);
  });

  it('should keep an ambiguous event address inside, because the document holds it twice', () => {
    // Given two channels answering one address, which SPEC 9.5 leaves unresolved on purpose, and
    // an address no channel answers beside it as the control
    const document = documentWith(
      [channel('billing-placed', 'orders.placed'), channel('orders-placed', 'orders.placed')],
      [
        edge('post-orders', 'node', 'orders.placed', 'event'),
        edge('post-orders', 'node', 'orders.archived', 'event'),
      ],
    );

    // When
    const targets = buildTopology(document).groups[0]?.edges.map((entry) => entry.to) ?? [];
    const ambiguous = targets.find((end) => end.name === 'orders.placed');
    const unknown = targets.find((end) => end.name === 'orders.archived');

    // Then the ambiguous end resolves to nothing and is NOT marked as leading outside: the
    // document holds that address twice, and saying it leads out of the known set would print a
    // false statement about the very document that describes both channels. The control beside
    // it shows the mark is reachable on this same document, so `false` is a decision rather than
    // a mark that never fires
    expect(
      [...document.nodes.values()].filter(
        (node) => node.kind === 'channel' && node.address === 'orders.placed',
      ),
    ).toHaveLength(2);
    expect(ambiguous?.nodeId).toBeUndefined();
    expect(ambiguous?.outside).toBe(false);
    expect(unknown?.outside).toBe(true);
  });

  it('should resolve an event end by address in an unmerged document and refuse to in a merged one', () => {
    // Given one document, twice: the same channel and the same edge, once as a service's own
    // document and once as a federation. The address is what the merge would have invented for a
    // channel of service `a`, and the edge is what a third service wrote by hand, which is the
    // `T053-R1` shape reduced to the one decision this function takes.
    const nodes = [channel('a_channel-created', 'a/created')];
    const edges = [edge('get-p', 'node', 'a/created', 'event')];
    const alone = documentWith(nodes, edges);
    const merged = federated(nodes, edges, ['a', 'b', 'web']);

    // When the same graph is built over both
    const before = buildTopology(alone).groups[0]?.edges[0]?.to;
    const after = buildTopology(merged).groups[0]?.edges[0]?.to;

    // Then the unmerged document resolves it exactly as it always did, because there the address
    // is what the document's own author wrote
    expect(before?.nodeId).toBe('a_channel-created');
    expect(before?.outside).toBe(false);

    // And the merged one resolves nothing, because there the address is what the merge invented,
    // and a hit in the merged address space is not a fact about any event name a service wrote.
    // The end stays inside, which is what an unresolved `event` end of a merged document means:
    // the merge already answered, and what it left is an ambiguity rather than an absence.
    expect(after?.nodeId).toBeUndefined();
    expect(after?.outside).toBe(false);
    expect(merged.nodes.get('a_channel-created')).toBeDefined();
  });

  it('should mark an undeclared event end as outside and never resolve it', () => {
    // Given a merged document holding a channel at the very address the end names, which is the
    // trap: the kind is the merge's answer and it outranks anything the addresses now say
    const document = federated(
      [channel('a_channel-created', 'a/created')],
      [
        edge('get-p', 'node', 'a/created', 'undeclared-event'),
        edge('get-p', 'node', 'a/created', 'event'),
      ],
      ['a', 'web'],
    );

    // When
    const targets = buildTopology(document).groups[0]?.edges.map((entry) => entry.to) ?? [];
    const undeclared = targets.find((end) => end.kind === 'undeclared-event');
    const ambiguous = targets.find((end) => end.kind === 'event');

    // Then the undeclared end is unresolved and outside, and the `event` end beside it, with the
    // same name on the same document, is unresolved and inside. Two facts, two answers, and the
    // only thing separating them is the kind the merge wrote.
    expect(undeclared?.nodeId).toBeUndefined();
    expect(undeclared?.outside).toBe(true);
    expect(ambiguous?.nodeId).toBeUndefined();
    expect(ambiguous?.outside).toBe(false);
  });

  it('should tell a dead end and an outside end apart, since they are different facts', () => {
    // Given a channel this document holds that nothing consumes, and a service it does not hold
    const document = federated(
      [channel('channel-archived', 'orders.archived')],
      [
        edge('orders', 'service', 'channel-archived', 'node'),
        edge('orders', 'service', 'ledger-service', 'service', 'calls'),
      ],
      ['orders'],
    );

    // When
    const edges = buildTopology(document).groups[0]?.edges ?? [];
    const held = edges.find((entry) => entry.to.name === 'channel-archived');
    const stranger = edges.find((entry) => entry.to.name === 'ledger-service');

    // Then the channel is a dead end that is not outside, and the service is outside and also a
    // dead end, so neither member stands in for the other
    expect(held?.deadEnd).toBe(true);
    expect(held?.to.outside).toBe(false);
    expect(stranger?.deadEnd).toBe(true);
    expect(stranger?.to.outside).toBe(true);
  });
});

describe('relationships over the corpus', () => {
  it('should draw a callback edge from the operation that declares it, per SPEC 9.3', () => {
    // Given the OpenAPI callback example, which is the corpus document that declares one
    const document = corpusDocument('oai-callback-example.yaml');

    // When
    const parent = document.nodes.get('post-streams');
    const callbackIds = Object.values(parent?.kind === 'operation' ? (parent.callbacks ?? {}) : {});

    // Then the field is filled, the callback is a node of its own, and the edge names both
    expect(callbackIds.flat()).toHaveLength(1);
    const callbackId = callbackIds.flat()[0] ?? '';
    expect(document.nodes.get(callbackId)?.kind).toBe('operation');
    expect(document.relationships).toEqual([
      {
        from: 'post-streams',
        fromKind: 'node',
        to: callbackId,
        toKind: 'node',
        type: 'callback',
        confidence: 'declared',
      },
    ]);
  });

  it('should read a callback operation whole rather than as a name', () => {
    // Given the same document
    const document = corpusDocument('oai-callback-example.yaml');

    // When
    const node = [...document.nodes.values()].find((entry) => entry.id.startsWith('callback-'));

    // Then the runtime expression is carried as the path, and the body and responses are read
    expect(node?.kind).toBe('operation');
    if (node?.kind !== 'operation') throw new Error('the callback node is not an operation');
    expect(node.method).toBe('post');
    expect(node.path).toBe('{$request.query.callbackUrl}/data');
    expect(node.responses.map((response) => response.statusCode)).toEqual(['202', '204']);
    expect(node.requestBody?.content[0]?.mediaType).toBe('application/json');
  });

  it('should draw a webhook edge from the service, because no operation causes one', () => {
    // Given the OpenAPI webhook example
    const document = corpusDocument('oai-webhook-example.yaml');

    // When
    const edges = document.relationships;

    // Then, with the webhook asserted present first
    expect([...document.webhooks.keys()]).toEqual(['webhook-post-newpet']);
    expect(edges).toEqual([
      {
        from: 'webhook-example',
        fromKind: 'service',
        to: 'webhook-post-newpet',
        toKind: 'node',
        type: 'webhook',
        confidence: 'declared',
      },
    ]);
  });

  it('should draw a document with no callbacks and no webhooks with no edges at all', () => {
    // Given a corpus document that declares neither, which is the control for the two above
    const document = corpusDocument('oai-petstore.yaml');

    // When
    const edges = document.relationships;

    // Then, with the operations asserted present so this is an absence of a subject
    expect(document.nodes.size).toBeGreaterThan(0);
    expect(edges).toEqual([]);
  });

  it('should turn a send and a receive into the two directions of SPEC 9.2', () => {
    // Given the streetlights document, which does three sends and one receive
    const document = eventsDocument('aai-streetlights-kafka.yml');

    // When
    const byType = document.relationships.map((entry) => [entry.type, entry.fromKind] as const);

    // Then a send starts at the service and a receive ends at it
    expect(byType).toEqual([
      ['subscribes', 'node'],
      ['publishes', 'service'],
      ['publishes', 'service'],
      ['publishes', 'service'],
    ]);
    expect(document.relationships.every((entry) => entry.confidence === 'declared')).toBe(true);
  });

  it('should turn a reply channel into one calls edge and not into a second direction', () => {
    // Given the adeo request-reply document, whose one operation declares a reply channel
    const document = eventsDocument('aai-adeo-kafka-request-reply.yml');

    // When
    const calls = document.relationships.filter((entry) => entry.type === 'calls');

    // Then, with the reply asserted present first, and with the operation's own direction the
    // only other edge: nothing says the application listens on the reply channel
    const request = document.nodes.get('channel-adeo-env-case-study-costing-request-version');
    expect(request?.kind === 'channel' && request.operations[0]?.reply?.channelId).toBe(
      'channel-costingresponsechannel',
    );
    expect(calls).toEqual([
      {
        from: 'channel-adeo-env-case-study-costing-request-version',
        fromKind: 'node',
        to: 'channel-costingresponsechannel',
        toKind: 'node',
        type: 'calls',
        confidence: 'declared',
      },
    ]);
    expect(document.relationships).toHaveLength(2);
  });

  it('should fold the repeated edge two operations on one channel would produce', () => {
    // Given a document with two receive operations on the same channel
    const document = normalizeAsyncApiDocument({
      asyncapi: '3.0.0',
      info: { title: 'Twice', version: '1.0.0' },
      channels: { orders: { address: 'orders' } },
      operations: {
        first: { action: 'receive', channel: { $ref: '#/channels/orders' } },
        second: { action: 'receive', channel: { $ref: '#/channels/orders' } },
      },
    });

    // When
    const edges = document.relationships;

    // Then the channel carries two operations and the graph carries one edge
    const node = document.nodes.get('channel-orders');
    expect(node?.kind === 'channel' && node.operations).toHaveLength(2);
    expect(edges).toHaveLength(1);
  });
});

describe('a callback operation once it is a node', () => {
  const withCallback = (responses: Record<string, unknown>): Record<string, unknown> => ({
    openapi: '3.1.0',
    info: { title: 'Callbacks', version: '1.0.0' },
    paths: {
      '/subscribe': {
        post: {
          responses: { '201': { description: 'Subscribed' } },
          callbacks: {
            onData: {
              '{$request.query.url}': { post: { responses } },
            },
          },
        },
      },
    },
  });

  it('should be diffed as the operation it is, which nothing did before T052', () => {
    // Given two documents differing only inside a callback's responses
    const older = normalizeOpenApiDocument(withCallback({ '200': { description: 'Fine' } }));
    const newer = normalizeOpenApiDocument(withCallback({ '500': { description: 'Broken' } }));

    // When
    const report = buildDiffReport(older, newer);

    // Then, with the callback node asserted present on both sides first, so the change below is a
    // change to something that exists rather than to something invented by the comparison
    const id = 'callback-post-subscribe-ondata-post-request-query-url';
    expect(older.nodes.has(id)).toBe(true);
    expect(newer.nodes.has(id)).toBe(true);
    expect([...report.breaking, ...report.nonBreaking]).toEqual([
      {
        kind: 'response-removed',
        classification: 'non-breaking',
        subject: 'response 200 of POST {$request.query.url}',
      },
      {
        kind: 'response-added',
        classification: 'non-breaking',
        subject: 'response 500 of POST {$request.query.url}',
      },
    ]);
  });

  it('should read as no change when only the callback name moves, which is stated in the differ', () => {
    // Given the same callback operation under two different callback names
    const rename = (name: string): Record<string, unknown> => ({
      openapi: '3.1.0',
      info: { title: 'Callbacks', version: '1.0.0' },
      paths: {
        '/subscribe': {
          post: {
            responses: { '201': { description: 'Subscribed' } },
            callbacks: { [name]: { '{$request.query.url}': { post: { responses: {} } } } },
          },
        },
      },
    });
    const older = normalizeOpenApiDocument(rename('onData'));
    const newer = normalizeOpenApiDocument(rename('onEvent'));

    // When
    const report = buildDiffReport(older, newer);

    // Then nothing is reported, and that is the limit the differ states rather than a bug: the
    // callback name is in the node id but operations are matched by method and path shape, so the
    // two callback operations pair up and `IROperation.callbacks` itself is compared by nobody.
    // The node ids are asserted different first, so this is a matcher looking past them rather
    // than two identical documents
    expect([...older.nodes.keys()]).not.toEqual([...newer.nodes.keys()]);
    expect(older.nodes.size).toBe(2);
    expect([...report.breaking, ...report.nonBreaking]).toEqual([]);
  });
});

describe('a callback written as a reference, per SPEC 9.3', () => {
  const PATH_ITEM = {
    '{$request.query.url}': {
      post: {
        requestBody: { content: { 'application/json': { schema: { type: 'string' } } } },
        responses: { '200': { description: 'Fine' } },
      },
    },
  };

  const withCallback = (
    member: unknown,
    components?: Record<string, unknown>,
  ): Record<string, unknown> => ({
    openapi: '3.1.0',
    info: { title: 'Callbacks', version: '1.0.0' },
    paths: {
      '/subscribe': {
        post: {
          responses: { '201': { description: 'Subscribed' } },
          callbacks: { onData: member },
        },
      },
    },
    ...(components === undefined ? {} : { components }),
  });

  const callbacksOf = (document: IRDocument, id: string): Record<string, readonly string[]> => {
    const node = document.nodes.get(id);
    if (node?.kind !== 'operation') throw new Error(`node ${id} is not an operation`);
    return { ...node.callbacks };
  };

  it('should produce the same IR as the same callback written inline', () => {
    // Given one callback written inline and the same callback written at the canonical
    // `#/components/callbacks/*` spelling, which is the one OpenAPI's own examples use
    const inline = normalizeOpenApiDocument(withCallback(PATH_ITEM));
    const referenced = normalizeOpenApiDocument(
      withCallback({ $ref: '#/components/callbacks/onData' }, { callbacks: { onData: PATH_ITEM } }),
    );

    // Then, with the inline reading asserted to have produced a callback at all first, so what
    // follows compares two documents that have one rather than two that have none
    const id = 'callback-post-subscribe-ondata-post-request-query-url';
    expect(callbacksOf(inline, 'post-subscribe')).toEqual({ onData: [id] });
    expect(inline.nodes.has(id)).toBe(true);
    expect(inline.relationships).toHaveLength(1);

    // Then the two are the same document down to the hash: same nodes, same edges, same member.
    // `components.callbacks` reaches no other reader, so the hash needs nothing neutralized
    expect(callbacksOf(referenced, 'post-subscribe')).toEqual({ onData: [id] });
    expect([...referenced.nodes.keys()]).toEqual([...inline.nodes.keys()]);
    expect(referenced.relationships).toEqual(inline.relationships);
    expect(referenced.hash).toBe(inline.hash);
  });

  it('should follow a chain of references to the callback at the end of it', () => {
    // Given a reference that points at another reference
    const document = normalizeOpenApiDocument(
      withCallback(
        { $ref: '#/components/callbacks/hop' },
        {
          callbacks: { hop: { $ref: '#/components/callbacks/real' }, real: PATH_ITEM },
        },
      ),
    );

    // Then the callback at the end of the chain is the one that was read
    expect(callbacksOf(document, 'post-subscribe')).toEqual({
      onData: ['callback-post-subscribe-ondata-post-request-query-url'],
    });
  });

  it('should refuse a reference that resolves to nothing, naming the callback and its operation', () => {
    // Given a callback reference into a `components.callbacks` that does not hold it
    const act = (): IRDocument =>
      normalizeOpenApiDocument(
        withCallback({ $ref: '#/components/callbacks/missing' }, { callbacks: {} }),
      );

    // Then the document is refused rather than rendered as a document with no callback, and the
    // refusal names both the callback and the operation it hangs off, per SPEC 9.4
    expect(act).toThrow(RefResolutionError);
    expect(act).toThrow(/callback onData of operation post-subscribe/);
    expect(act).toThrow(/#\/components\/callbacks\/missing/);
  });

  it('should refuse a reference that resolves to something other than a Callback Object', () => {
    // Given a reference that resolves, but to a string
    const act = (): IRDocument => normalizeOpenApiDocument(withCallback({ $ref: '#/info/title' }));

    // Then
    expect(act).toThrow(RefResolutionError);
    expect(act).toThrow(/callback onData of operation post-subscribe points at #\/info\/title/);
  });

  it('should refuse a callback reference into another file, as every structural reference is', () => {
    // Given a reference that leaves the document, which has no id space here
    const act = (): IRDocument =>
      normalizeOpenApiDocument(withCallback({ $ref: 'other.yaml#/components/callbacks/onData' }));

    // Then
    expect(act).toThrow(RefResolutionError);
    expect(act).toThrow(/rather than in another file/);
  });

  it('should refuse a callback reference that stands on itself', () => {
    // Given a callback whose reference points back at the member that wrote it
    const act = (): IRDocument =>
      normalizeOpenApiDocument(withCallback({ $ref: '#/paths/~1subscribe/post/callbacks/onData' }));

    // Then the walk terminates by refusing rather than by looping
    expect(act).toThrow(CycleDepthError);
    expect(act).toThrow(/callback onData of operation post-subscribe/);
  });

  it('should leave a callback member that is not a reference exactly as it read it before', () => {
    // Given a callback member of the wrong shape written inline, which is a separate question
    // from this one and stays the lenient skip it was
    const document = normalizeOpenApiDocument(withCallback('nonsense'));

    // Then, with the operation asserted present first
    expect(document.nodes.has('post-subscribe')).toBe(true);
    expect(callbacksOf(document, 'post-subscribe')).toEqual({});
    expect(document.relationships).toEqual([]);
  });
});

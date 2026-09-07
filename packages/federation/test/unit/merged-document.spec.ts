import { describe, expect, it } from 'vitest';
import type { IRDocument, IRNavNode } from '@openref/core';
import { mergeDocuments } from '../../src/index';
import { buildDocument, channel, namedSchema, operation } from '../mocks/documents';

/**
 * The shape of the document a merge produces: whose nodes are whose, where the addresses went, and
 * what happened to everything a document says about itself rather than about an endpoint.
 *
 * THE RULE BEHIND MOST OF THIS FILE IS THAT NOTHING IS DROPPED. A service's title, version,
 * servers, collectors, health and vendor extensions have nowhere to go once its nodes are in a
 * shared map, so they go on its `IRService` entry, and the cases below read them back.
 */

const MERGED = { id: 'platform', info: { title: 'Platform', version: '2026.8' } } as const;

/** Labels and ids of a navigation tree, one line per entry, indented by depth. */
function outline(tree: readonly IRNavNode[], depth = 0): string[] {
  return tree.flatMap((entry) => [
    `${'  '.repeat(depth)}${entry.kind} ${entry.id} "${entry.label}"`,
    ...outline(entry.children, depth + 1),
  ]);
}

describe('mergeDocuments, node identity', () => {
  it('should prefix every node id with the id of its service', () => {
    // Given two services with nodes of both kinds and a webhook
    const billing = buildDocument({
      id: 'billing-api',
      nodes: [operation({ id: 'get-total', path: '/total' })],
      webhooks: [operation({ id: 'webhook-post-paid', path: '/paid', method: 'post' })],
    });
    const orders = buildDocument({
      id: 'orders-api',
      kind: 'events',
      nodes: [channel({ id: 'orders-created', address: 'orders.created' })],
    });

    // When they are merged
    const { document } = mergeDocuments(
      [
        { id: 'billing', document: billing },
        { id: 'orders', document: orders },
      ],
      MERGED,
    );

    // Then every id says which service answers it, and each node carries the service back
    expect([...document.nodes.keys()].sort()).toEqual([
      'billing_get-total',
      'orders_orders-created',
    ]);
    expect([...document.webhooks.keys()]).toEqual(['billing_webhook-post-paid']);
    expect([...document.nodes.values()].map((node) => node.serviceId).sort()).toEqual([
      'billing',
      'orders',
    ]);
  });

  it('should report the kind as mixed when the services do not agree', () => {
    // Given an HTTP service and an event service
    const billing = buildDocument({ id: 'billing-api', kind: 'http' });
    const orders = buildDocument({ id: 'orders-api', kind: 'events' });

    // When they are merged
    const { document } = mergeDocuments(
      [
        { id: 'billing', document: billing },
        { id: 'orders', document: orders },
      ],
      MERGED,
    );

    // Then the merged document says so rather than taking the first answer
    expect(document.kind).toBe('mixed');
  });
});

describe('mergeDocuments, mount prefixes', () => {
  it('should move every address of a prefixed service, conflict or not', () => {
    // Given a service mounted at /billing whose paths clash with nothing
    const billing = buildDocument({
      id: 'billing-api',
      nodes: [
        operation({ id: 'get-total', path: '/total' }),
        operation({ id: 'get-invoices', path: '/invoices' }),
      ],
    });
    const orders = buildDocument({
      id: 'orders-api',
      nodes: [operation({ id: 'get-orders', path: '/orders' })],
    });

    // When they are merged
    const { document, report } = mergeDocuments(
      [
        { id: 'billing', document: billing, prefix: '/billing' },
        { id: 'orders', document: orders },
      ],
      MERGED,
    );

    // Then the mounted service is under its mount and the other one is where it was
    const paths = [...document.nodes.values()]
      .map((node) => (node.kind === 'operation' ? node.path : node.address))
      .sort();
    expect(paths).toEqual(['/billing/invoices', '/billing/total', '/orders']);

    // And the reason recorded is the mount rather than a conflict nobody had
    expect(report.renames.filter((rename) => rename.kind === 'path')).toEqual([
      {
        kind: 'path',
        serviceId: 'billing',
        from: '/invoices',
        to: '/billing/invoices',
        reason: 'service-prefix',
        contestedBy: [],
      },
      {
        kind: 'path',
        serviceId: 'billing',
        from: '/total',
        to: '/billing/total',
        reason: 'service-prefix',
        contestedBy: [],
      },
    ]);
  });

  it('should join a channel address that is not a path with a separator', () => {
    // Given two event services that publish the same topic
    const billing = buildDocument({
      id: 'billing-api',
      kind: 'events',
      nodes: [channel({ id: 'created', address: 'orders.created' })],
    });
    const orders = buildDocument({
      id: 'orders-api',
      kind: 'events',
      nodes: [channel({ id: 'created', address: 'orders.created' })],
    });

    // When they are merged
    const { document } = mergeDocuments(
      [
        { id: 'billing', document: billing },
        { id: 'orders', document: orders },
      ],
      MERGED,
    );

    // Then neither topic was turned into a path that no broker has
    const addresses = [...document.nodes.values()]
      .map((node) => (node.kind === 'channel' ? node.address : undefined))
      .sort();
    expect(addresses).toEqual(['billing/orders.created', 'orders/orders.created']);
  });

  it('should leave a webhook where it is, since a gateway does not serve one', () => {
    // Given two services declaring a webhook at the same path, one of them mounted
    const billing = buildDocument({
      id: 'billing-api',
      webhooks: [operation({ id: 'webhook-post-paid', path: '/paid', method: 'post' })],
    });
    const orders = buildDocument({
      id: 'orders-api',
      webhooks: [operation({ id: 'webhook-post-paid', path: '/paid', method: 'post' })],
    });

    // When they are merged
    const { document } = mergeDocuments(
      [
        { id: 'billing', document: billing, prefix: '/billing' },
        { id: 'orders', document: orders },
      ],
      MERGED,
    );

    // Then both keep the path the API really sends to, and only the ids were moved
    const paths = [...document.webhooks.values()].map((node) =>
      node.kind === 'operation' ? node.path : node.address,
    );
    expect(paths).toEqual(['/paid', '/paid']);
    expect([...document.webhooks.keys()].sort()).toEqual([
      'billing_webhook-post-paid',
      'orders_webhook-post-paid',
    ]);
  });
});

describe('mergeDocuments, navigation', () => {
  it('should make the service a parent of the tree its own document produced', () => {
    // Given two services whose own navigation groups operations under tags
    const billing = buildDocument({
      id: 'billing-api',
      title: 'Billing',
      nodes: [operation({ id: 'get-total', path: '/total', summary: 'Total', tags: ['money'] })],
    });
    const orders = buildDocument({
      id: 'orders-api',
      title: 'Orders',
      nodes: [operation({ id: 'get-orders', path: '/orders', summary: 'List' })],
    });

    // When they are merged
    const { document } = mergeDocuments(
      [
        { id: 'billing', document: billing },
        { id: 'orders', document: orders },
      ],
      MERGED,
    );

    // Then each service is a group of its own, holding the arrangement it chose
    expect(outline(document.navigation)).toEqual([
      'group group-service-billing "Billing"',
      '  group billing_group-money "money"',
      '    node nav-billing_get-total "Total"',
      'group group-service-orders "Orders"',
      '  group orders_group-untagged "Other"',
      '    node nav-orders_get-orders "List"',
    ]);
  });

  it('should keep the group of a service that has nothing in it', () => {
    // Given a service that is really in the federation and really has no operations
    const billing = buildDocument({
      id: 'billing-api',
      title: 'Billing',
      nodes: [operation({ id: 'get-total', path: '/total', summary: 'Total' })],
    });
    const empty = buildDocument({ id: 'empty-api', title: 'Not started yet' });

    // When they are merged
    const { document } = mergeDocuments(
      [
        { id: 'billing', document: billing },
        { id: 'empty', document: empty },
      ],
      MERGED,
    );

    // Then it is visible with nothing under it, rather than absent
    expect(outline(document.navigation)).toEqual([
      'group group-service-billing "Billing"',
      '  group billing_group-untagged "Other"',
      '    node nav-billing_get-total "Total"',
      'group group-service-empty "Not started yet"',
    ]);
  });

  it('should move a navigation id that a deduplicated schema made collide, and say so', () => {
    // Given two services carrying the same schema, so both trees name one merged entry
    const money = namedSchema('Money', { type: 'integer' });
    const billing = buildDocument({ id: 'billing-api', title: 'Billing', schemas: [money] });
    const orders = buildDocument({ id: 'orders-api', title: 'Orders', schemas: [money] });

    // When they are merged
    const { document, report } = mergeDocuments(
      [
        { id: 'billing', document: billing },
        { id: 'orders', document: orders },
      ],
      MERGED,
    );

    // Then both entries exist, both point at the one schema, and the second id was moved
    expect(outline(document.navigation)).toEqual([
      'group group-service-billing "Billing"',
      '  group billing_group-schemas "Schemas"',
      '    schema nav-schema-Money "Money"',
      'group group-service-orders "Orders"',
      '  group orders_group-schemas "Schemas"',
      '    schema nav-schema-Money_2 "Money"',
    ]);
    expect(report.renames.filter((rename) => rename.kind === 'navigation')).toEqual([
      {
        kind: 'navigation',
        serviceId: 'orders',
        from: 'nav-schema-Money',
        to: 'nav-schema-Money_2',
        reason: 'uniqueness',
        contestedBy: [],
      },
    ]);
  });
});

describe('mergeDocuments, what a service says about itself', () => {
  it('should keep every document level fact of every service', () => {
    // Given a service whose document carries a header, servers, collectors and vendor data
    const billing = buildDocument({
      id: 'billing-api',
      title: 'Billing',
      version: '3.1.0',
      servers: [{ url: 'https://billing.example.com', description: 'production' }],
      runtime: { collectors: ['sourceCollector'], nestVersion: '11.0.0' },
      extensions: { 'x-owner': 'payments-team' },
      nodes: [operation({ id: 'get-total', path: '/total' })],
    });
    const orders = buildDocument({ id: 'orders-api', title: 'Orders' });

    // When they are merged
    const { document } = mergeDocuments(
      [
        { id: 'billing', document: billing, prefix: '/billing' },
        { id: 'orders', document: orders },
      ],
      MERGED,
    );
    const service = document.services?.find((entry) => entry.id === 'billing');

    // Then all of it is readable from the merged document, under the service that said it
    expect(service).toEqual({
      id: 'billing',
      documentId: 'billing-api',
      documentHash: billing.hash,
      kind: 'http',
      info: { title: 'Billing', version: '3.1.0' },
      servers: [{ url: 'https://billing.example.com', description: 'production' }],
      prefix: '/billing',
      runtime: { collectors: ['sourceCollector'], nestVersion: '11.0.0' },
      extensions: { 'x-owner': 'payments-team' },
    });
  });

  it('should serve the merged document from the servers the caller supplied and no others', () => {
    // Given two services with servers of their own
    const billing = buildDocument({
      id: 'billing-api',
      servers: [{ url: 'https://billing.example.com' }],
    });
    const orders = buildDocument({
      id: 'orders-api',
      servers: [{ url: 'https://orders.example.com' }],
    });

    // When they are merged without a gateway being named
    const { document } = mergeDocuments(
      [
        { id: 'billing', document: billing },
        { id: 'orders', document: orders },
      ],
      MERGED,
    );

    // Then the merged document names no server, rather than one of theirs chosen by sort order
    expect(document.servers).toEqual([]);
    expect(document.services?.map((service) => service.servers)).toEqual([
      [{ url: 'https://billing.example.com' }],
      [{ url: 'https://orders.example.com' }],
    ]);
  });

  it('should freeze the service list, like every other part of a finished document', () => {
    // Given a merged document, which `finalizeDocument` hashed and froze
    const { document } = mergeDocuments(
      [
        { id: 'billing', document: buildDocument({ id: 'billing-api' }) },
        { id: 'orders', document: buildDocument({ id: 'orders-api' }) },
      ],
      MERGED,
    );
    const services = document.services ?? [];

    // When something writes to the field the IR gained at T044
    const write = (): void => {
      (services as { length: number }).length = 0;
    };

    // Then it is refused, because the hash is a claim about content that can no longer change
    expect(write).toThrow(TypeError);
    expect(services).toHaveLength(2);
  });

  it('should take the gateway from the options when the caller knows one', () => {
    // Given a caller that knows where the federation is served from
    const billing = buildDocument({ id: 'billing-api' });

    // When the merge is given it
    const { document } = mergeDocuments([{ id: 'billing', document: billing }], {
      ...MERGED,
      servers: [{ url: 'https://api.example.com' }],
    });

    // Then that is what the merged document is served from
    expect(document.servers).toEqual([{ url: 'https://api.example.com' }]);
  });
});

describe('mergeDocuments, health and topology', () => {
  it('should sum the checks of every service and recompute the score from them', () => {
    // Given two services whose health reports answer the same two questions differently
    const billing = buildDocument({
      id: 'billing-api',
      nodes: [operation({ id: 'get-total', path: '/total' })],
      health: {
        score: 50,
        operationCount: 2,
        checks: [
          { id: 'operation-summary', label: 'Summaries', passed: 1, total: 2, severity: 'warning' },
          { id: 'operation-id', label: 'Operation ids', passed: 2, total: 2, severity: 'warning' },
        ],
        drift: [
          {
            rule: 'orphan-operation',
            severity: 'warning',
            nodeId: 'get-total',
            message: 'no runtime fact',
            suggestion: 'register the collector',
            classification: { bucket: 'silence' },
            edit: 'nothing-to-write',
            basis: { kind: 'unobserved' },
          },
        ],
      },
    });
    const orders = buildDocument({
      id: 'orders-api',
      health: {
        score: 100,
        operationCount: 2,
        checks: [
          { id: 'operation-summary', label: 'Summaries', passed: 2, total: 2, severity: 'warning' },
        ],
        drift: [],
      },
    });

    // When they are merged
    const { document } = mergeDocuments(
      [
        { id: 'billing', document: billing },
        { id: 'orders', document: orders },
      ],
      MERGED,
    );

    // Then the merged report answers the questions of the whole federation
    expect(document.health?.operationCount).toBe(4);
    expect(document.health?.checks).toEqual([
      { id: 'operation-summary', label: 'Summaries', passed: 3, total: 4, severity: 'warning' },
      { id: 'operation-id', label: 'Operation ids', passed: 2, total: 2, severity: 'warning' },
    ]);
    // The score is the weighted mean of SPEC 7.2: `warning` weighs 2, and the root of 4 is 2
    // against the root of 2 which is 1, so the four subject check is worth twice the two subject
    // one and the score is (4 x 0.75 + 2 x 1) / 6 rather than the unweighted (0.75 + 1) / 2.
    expect(document.health?.score).toBe(83);

    // And the finding addresses the node by the name the merged document knows it by
    expect(document.health?.drift[0]?.nodeId).toBe('billing_get-total');

    // And each service keeps the report it wrote about itself
    expect(document.services?.[0]?.health?.score).toBe(50);
  });

  it('should leave health absent when no service reported any', () => {
    // Given two services with no health report
    const billing = buildDocument({ id: 'billing-api' });
    const orders = buildDocument({ id: 'orders-api' });

    // When they are merged
    const { document } = mergeDocuments(
      [
        { id: 'billing', document: billing },
        { id: 'orders', document: orders },
      ],
      MERGED,
    );

    // Then the merged document says nothing rather than reporting a perfect score
    expect(document.health).toBeUndefined();
  });

  it('should move the node end of a topology edge and leave the service end alone', () => {
    // Given two services, each declaring an edge out of a node it owns
    const edge = (from: string): IRDocument['relationships'] => [
      {
        from,
        fromKind: 'node',
        to: 'notification-service',
        toKind: 'service',
        type: 'publishes',
        confidence: 'declared',
      },
    ];
    const billing = buildDocument({
      id: 'billing-api',
      nodes: [operation({ id: 'get-total', path: '/total' })],
      relationships: edge('get-total'),
    });
    const orders = buildDocument({
      id: 'orders-api',
      nodes: [operation({ id: 'get-orders', path: '/orders' })],
      relationships: edge('get-orders'),
    });

    // When they are merged
    const { document } = mergeDocuments(
      [
        { id: 'billing', document: billing },
        { id: 'orders', document: orders },
      ],
      MERGED,
    );

    // Then each node end names the merged node and the service end is left as it was written
    expect(document.relationships).toEqual([
      {
        from: 'billing_get-total',
        fromKind: 'node',
        to: 'notification-service',
        toKind: 'service',
        type: 'publishes',
        confidence: 'declared',
      },
      {
        from: 'orders_get-orders',
        fromKind: 'node',
        to: 'notification-service',
        toKind: 'service',
        type: 'publishes',
        confidence: 'declared',
      },
    ]);
  });

  it('should draw an edge two services both declare once', () => {
    // Given two services that both record the same service to service edge
    const edges: IRDocument['relationships'] = [
      {
        from: 'billing-service',
        fromKind: 'service',
        to: 'notification-service',
        toKind: 'service',
        type: 'publishes',
        confidence: 'declared',
      },
    ];
    const billing = buildDocument({ id: 'billing-api', relationships: edges });
    const orders = buildDocument({ id: 'orders-api', relationships: edges });

    // When they are merged
    const { document } = mergeDocuments(
      [
        { id: 'billing', document: billing },
        { id: 'orders', document: orders },
      ],
      MERGED,
    );

    // Then the topology graph does not weight one edge twice for having been described twice
    expect(document.relationships).toEqual(edges);
  });

  it('should rewrite a service end that names its own document and leave a foreign one alone', () => {
    // Given a service whose event document names itself by its document id, which is what both
    // normalizers write for a `service` end, and a second edge naming a service nobody federated
    const billing = buildDocument({
      id: 'billing-api',
      nodes: [channel({ id: 'paid', address: 'billing.paid' })],
      relationships: [
        {
          from: 'billing-api',
          fromKind: 'service',
          to: 'paid',
          toKind: 'node',
          type: 'publishes',
          confidence: 'declared',
        },
        {
          from: 'paid',
          fromKind: 'node',
          to: 'ledger-service',
          toKind: 'service',
          type: 'subscribes',
          confidence: 'declared',
        },
      ],
    });
    const orders = buildDocument({ id: 'orders-api' });

    // When they are merged under service ids that are not the document ids
    const { document } = mergeDocuments(
      [
        { id: 'billing', document: billing },
        { id: 'orders', document: orders },
      ],
      MERGED,
    );

    // Then the service's own name becomes its federation id, the node end moves with the node,
    // and the service that was named but not federated stays named
    expect(document.relationships).toEqual([
      {
        from: 'billing',
        fromKind: 'service',
        to: 'billing_paid',
        toKind: 'node',
        type: 'publishes',
        confidence: 'declared',
      },
      {
        from: 'billing_paid',
        fromKind: 'node',
        to: 'ledger-service',
        toKind: 'service',
        type: 'subscribes',
        confidence: 'declared',
      },
    ]);
  });

  it('should not rewrite a service whose name happens to equal another node id', () => {
    // Given a service end whose name is spelled exactly like a node id the rewrite map holds,
    // which is the collision the untyped `from` of SPEC 9 could not tell apart before `T052`
    const billing = buildDocument({
      id: 'billing-api',
      nodes: [operation({ id: 'get-total', path: '/total' })],
      relationships: [
        {
          from: 'billing-api',
          fromKind: 'service',
          to: 'get-total',
          toKind: 'service',
          type: 'calls',
          confidence: 'declared',
        },
      ],
    });

    // When it is merged, so that `get-total` is renamed to `billing_get-total` as a node
    const { document } = mergeDocuments([{ id: 'billing', document: billing }], MERGED);

    // Then the node moved and the service end that shares its spelling did not
    expect([...document.nodes.keys()]).toEqual(['billing_get-total']);
    expect(document.relationships).toEqual([
      {
        from: 'billing',
        fromKind: 'service',
        to: 'get-total',
        toKind: 'service',
        type: 'calls',
        confidence: 'declared',
      },
    ]);
  });

  it('should call an event end undeclared when no document of the federation declares it', () => {
    // Given an edge from a handler node to an event name, which is what `@ApiPublishes` declares,
    // in a federation of one service that documents no channel at all
    const orders = buildDocument({
      id: 'orders-api',
      nodes: [operation({ id: 'post-orders', path: '/orders', method: 'post' })],
      relationships: [
        {
          from: 'post-orders',
          fromKind: 'node',
          to: 'orders.placed',
          toKind: 'event',
          type: 'publishes',
          confidence: 'declared',
        },
      ],
    });

    // When it is merged
    const { document, report } = mergeDocuments([{ id: 'orders', document: orders }], MERGED);

    // Then the node end moved, the name of the event end did not, and its kind carries the answer
    // the merge is the only participant able to give: nothing here declares this event
    expect(document.relationships).toEqual([
      {
        from: 'orders_post-orders',
        fromKind: 'node',
        to: 'orders.placed',
        toKind: 'undeclared-event',
        type: 'publishes',
        confidence: 'declared',
      },
    ]);
    expect(report.endpointKinds).toEqual([
      { serviceId: 'orders', name: 'orders.placed', from: 'event', to: 'undeclared-event' },
    ]);
  });
});

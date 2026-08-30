import { describe, expect, it } from 'vitest';
import { hash } from '@openref/core';
import type { IRDocument, IRNode } from '@openref/core';
import { mergeDocuments, rewriteNode } from '../../src/index';
import type { FederationService, MergeReport, RewriteMaps } from '../../src/index';
import {
  bearerScheme,
  buildDocument,
  channel,
  namedSchema,
  operation,
  referenceHeavyOperation,
} from '../mocks/documents';

/**
 * The done-when of T044, tested as one claim rather than as a list of properties.
 *
 * MERGING IS LOSSLESS AND EXPLAINABLE IF AND ONLY IF THE REPORT UNDOES IT. Everything the merge
 * moves, it moves through a name, and the report is where it says which name became which. So the
 * proof is to take nothing but the merged document and the report, put every name back, and get
 * the source documents. A rename the report left out shows up as a node that does not come back;
 * a fact the merge dropped shows up the same way. Neither can be argued around.
 */

/** Three services that overlap in every space the merge decides. */
function federation(): FederationService[] {
  const money = namedSchema('Money', {
    type: 'object',
    properties: { amount: { type: 'integer' }, of: { $ref: 'Currency' } },
  });
  const currency = namedSchema('Currency', { type: 'string' });

  return [
    {
      id: 'billing',
      prefix: '/billing',
      document: buildDocument({
        id: 'billing-api',
        title: 'Billing',
        schemas: [money, currency, namedSchema('Target', { type: 'object' })],
        security: [bearerScheme({ 'invoices:read': 'Read' })],
        nodes: [
          operation({ id: 'get-status', path: '/status' }),
          referenceHeavyOperation('rich', 'Target'),
          channel({ id: 'paid', address: 'billing.paid' }),
          // The one address exactly one channel of this federation answers, which is what makes
          // it move under billing's prefix and makes the `event-name` case below reachable. The
          // `paid` channel above cannot serve that role: orders answers the same address, so the
          // merge refuses to move a name two services could claim.
          channel({ id: 'settled', address: 'billing.settled' }),
        ],
        webhooks: [operation({ id: 'webhook-post-paid', path: '/paid', method: 'post' })],
        relationships: [
          {
            from: 'get-status',
            fromKind: 'node',
            to: 'orders',
            toKind: 'service',
            type: 'calls',
            confidence: 'declared',
          },
        ],
      }),
    },
    {
      id: 'orders',
      document: buildDocument({
        id: 'orders-api',
        title: 'Orders',
        schemas: [money, currency],
        security: [bearerScheme({ 'orders:read': 'Read' })],
        nodes: [
          operation({
            id: 'get-status',
            path: '/status',
            responses: [
              {
                statusCode: '200',
                content: [
                  { mediaType: 'application/json', schema: { kind: 'named', schemaId: 'Money' } },
                ],
              },
            ],
          }),
          channel({ id: 'paid', address: 'billing.paid' }),
        ],
        // Two `event` ends, per SPEC 9.1: names orders documents no channel for. The first is
        // answered by exactly one channel of the federation, billing's, so the merge resolves it
        // onto that channel's node and both the name and the kind have to come back. The second is
        // answered by nothing at all, so the merge calls it `undeclared-event` and only the kind
        // has to come back. Two rather than one because the inversion below would pass on either
        // alone while getting the other wrong.
        relationships: [
          {
            from: 'get-status',
            fromKind: 'node',
            to: 'billing.settled',
            toKind: 'event',
            type: 'publishes',
            confidence: 'declared',
          },
          {
            from: 'get-status',
            fromKind: 'node',
            to: 'nobody.listens',
            toKind: 'event',
            type: 'publishes',
            confidence: 'declared',
          },
        ],
        health: {
          score: 80,
          operationCount: 1,
          checks: [{ id: 'summary', label: 'Summaries', passed: 4, total: 5, severity: 'warning' }],
          drift: [],
        },
      }),
    },
    {
      id: 'shipping',
      document: buildDocument({
        id: 'shipping-api',
        title: 'Shipping',
        schemas: [namedSchema('Money', { type: 'string' })],
        nodes: [operation({ id: 'get-status', path: '/status' })],
      }),
    },
  ];
}

/** The maps that put one service's names back, built from the report and nothing else. */
function inverseMaps(report: MergeReport, serviceId: string): RewriteMaps {
  const nodeIds = new Map<string, string>();
  const schemaIds = new Map<string, string>();
  const schemeIds = new Map<string, string>();

  for (const rename of report.renames) {
    if (rename.serviceId !== serviceId) continue;
    if (rename.kind === 'node' || rename.kind === 'webhook') nodeIds.set(rename.to, rename.from);
    if (rename.kind === 'schema') schemaIds.set(rename.to, rename.from);
    if (rename.kind === 'security-scheme') schemeIds.set(rename.to, rename.from);
  }

  return { nodeIds, schemaIds, schemeIds };
}

/**
 * Merged edge end back to the name one service's own document wrote, for every end kind.
 *
 * A `node` END AND AN `event` END COME FROM TWO RENAME KINDS AND ONE SERVICE. The node id moved
 * because this service's node moved; the event name moved because the merge resolved it onto
 * another service's channel, and the merge records it against the service that declared the edge
 * precisely so that this inversion can be built from one service's renames alone.
 */
function inverseEdgeNames(report: MergeReport, serviceId: string): Map<string, string> {
  const names = new Map<string, string>();

  for (const rename of report.renames) {
    if (rename.serviceId !== serviceId) continue;
    if (rename.kind === 'node' || rename.kind === 'webhook' || rename.kind === 'event-name') {
      names.set(rename.to, rename.from);
    }
  }

  return names;
}

/**
 * Merged edge end back to the kind one service's own document wrote, per SPEC 15.1.
 *
 * THE KIND IS THE HALF A RENAME CANNOT CARRY, and it is why `MergeReport.endpointKinds` exists.
 * The merge answers an `event` end federation wide and writes the answer into the end: a resolved
 * one becomes a `node`, one nothing declares becomes an `undeclared-event`. An inversion built out
 * of names alone would put every name back and hand a reader edges of the wrong kind, which is a
 * merge that is lossless by the letter and not by the claim.
 */
function inverseEdgeKinds(report: MergeReport, serviceId: string): Map<string, string> {
  const kinds = new Map<string, string>();

  for (const change of report.endpointKinds) {
    if (change.serviceId !== serviceId) continue;
    kinds.set(change.name, change.from);
  }

  return kinds;
}

/** Merged address back to the address the service's own document wrote. */
function inverseAddresses(report: MergeReport, serviceId: string): Map<string, string> {
  const addresses = new Map<string, string>();

  for (const rename of report.renames) {
    if (rename.serviceId !== serviceId) continue;
    if (rename.kind === 'path' || rename.kind === 'channel-address') {
      addresses.set(rename.to, rename.from);
    }
  }

  return addresses;
}

/** The address a node answers at, whichever kind of node it is. */
function addressOf(node: IRNode): string | undefined {
  return node.kind === 'operation' ? node.path : node.address;
}

/** One node put back into the names its own service used, ready to compare with the source. */
function restore(node: IRNode, report: MergeReport, serviceId: string): unknown {
  const maps = inverseMaps(report, serviceId);
  const address = addressOf(node);
  const sourceAddress =
    address === undefined
      ? undefined
      : (inverseAddresses(report, serviceId).get(address) ?? address);

  const identity =
    sourceAddress === undefined
      ? { id: maps.nodeIds.get(node.id) ?? node.id, serviceId: '' }
      : { id: maps.nodeIds.get(node.id) ?? node.id, address: sourceAddress, serviceId: '' };

  return { ...rewriteNode(node, identity, maps), serviceId: undefined };
}

describe('mergeDocuments, losslessness proved by undoing it', () => {
  it('should give every source node back from the merged document and the report alone', () => {
    // Given three services that collide on paths, schemas, channels and a security scheme
    const services = federation();

    // When they are merged and every name in the result is put back
    const { document, report } = mergeDocuments(services, {
      id: 'platform',
      info: { title: 'Platform', version: '1' },
    });

    const restored = services.map((service) => {
      const own = [...document.nodes.values(), ...document.webhooks.values()].filter(
        (node) => node.serviceId === service.id,
      );

      return {
        id: service.id,
        count: own.length,
        matches: own.filter((node) => {
          const back = restore(node, report, service.id);
          const source =
            service.document.nodes.get((back as IRNode).id) ??
            service.document.webhooks.get((back as IRNode).id);
          return source !== undefined && hash(back) === hash(source);
        }).length,
      };
    });

    // Then every node of every service came back byte for byte
    expect(restored).toEqual([
      { id: 'billing', count: 5, matches: 5 },
      { id: 'orders', count: 2, matches: 2 },
      { id: 'shipping', count: 1, matches: 1 },
    ]);
  });

  it('should give every source schema back, deduplicated ones included', () => {
    // Given the same three services, two of which describe Money identically
    const services = federation();

    // When they are merged
    const { document, report } = mergeDocuments(services, {
      id: 'platform',
      info: { title: 'Platform', version: '1' },
    });

    // Then each service's own schema map can be rebuilt from the merged one
    const restored = services.map((service) => {
      const maps = inverseMaps(report, service.id);
      const forward = new Map<string, string>();
      for (const [merged, source] of maps.schemaIds) forward.set(source, merged);

      return {
        id: service.id,
        missing: [...service.document.schemas.keys()].filter((sourceId) => {
          const mergedId = forward.get(sourceId) ?? sourceId;
          const merged = document.schemas.get(mergedId);
          if (merged === undefined) return true;

          const source = service.document.schemas.get(sourceId);
          return (
            source === undefined ||
            hash({ ...merged, id: sourceId, normalized: rebuild(merged, maps) }) !== hash(source)
          );
        }),
      };
    });

    expect(restored).toEqual([
      { id: 'billing', missing: [] },
      { id: 'orders', missing: [] },
      { id: 'shipping', missing: [] },
    ]);
  });

  it('should give every source relationship back, both halves of an event end included', () => {
    // Given the same three services, where orders publishes to an address only billing documents
    // a channel for, and billing is mounted under a prefix, so that address moves in the merge
    const services = federation();

    // When they are merged
    const { document, report } = mergeDocuments(services, {
      id: 'platform',
      info: { title: 'Platform', version: '1' },
    });

    // Then the merge really did rewrite an event name, and really did rewrite it in the edge, so
    // the restoration below undoes something rather than comparing two spellings that were never
    // different. Recorded against the service that DECLARED the edge, while the `channel-address`
    // rename beside it is recorded against the service that owns the channel.
    expect(report.renames.filter((rename) => rename.kind === 'event-name')).toEqual([
      {
        kind: 'event-name',
        serviceId: 'orders',
        from: 'billing.settled',
        to: 'billing_settled',
        reason: 'target-moved',
        contestedBy: [],
      },
    ]);
    const ends = document.relationships.map((edge) => edge.to);
    expect(ends).toContain('billing_settled');
    expect(ends).not.toContain('billing.settled');

    // And the merge really did change two kinds, in the two directions it can change one, so the
    // kind inversion below undoes something as well. Presence first: an inversion asserted over a
    // merge that changed no kind would pass with the whole of `endpointKinds` deleted.
    expect(report.endpointKinds).toEqual([
      { serviceId: 'orders', name: 'billing_settled', from: 'event', to: 'node' },
      { serviceId: 'orders', name: 'nobody.listens', from: 'event', to: 'undeclared-event' },
    ]);
    expect(document.relationships.map((edge) => edge.toKind).sort()).toEqual([
      'node',
      'service',
      'undeclared-event',
    ]);

    // And every edge every service declared comes back from the merged document and the report
    // alone, with the count each service declared asserted beside it so that a service whose
    // edges vanished from the source fixture cannot read as a service that lost nothing
    const restored = services.map((service) => {
      const inverse = inverseEdgeNames(report, service.id);
      const kinds = inverseEdgeKinds(report, service.id);
      const back = new Set(
        document.relationships.map((edge) =>
          hash({
            ...edge,
            from: inverse.get(edge.from) ?? edge.from,
            fromKind: kinds.get(edge.from) ?? edge.fromKind,
            to: inverse.get(edge.to) ?? edge.to,
            toKind: kinds.get(edge.to) ?? edge.toKind,
          }),
        ),
      );

      return {
        id: service.id,
        declared: service.document.relationships.length,
        missing: service.document.relationships.filter((edge) => !back.has(hash(edge))).length,
      };
    });

    expect(restored).toEqual([
      { id: 'billing', declared: 1, missing: 0 },
      { id: 'orders', declared: 2, missing: 0 },
      { id: 'shipping', declared: 0, missing: 0 },
    ]);
  });

  it('should keep every service header, so nothing document level is dropped', () => {
    // Given three services with headers of their own
    const services = federation();

    // When they are merged
    const { document } = mergeDocuments(services, {
      id: 'platform',
      info: { title: 'Platform', version: '1' },
    });

    // Then each source header is recoverable from the service entry
    const headers = (document.services ?? []).map((entry) => ({
      id: entry.id,
      documentId: entry.documentId,
      title: entry.info.title,
      hashMatches:
        entry.documentHash === services.find((service) => service.id === entry.id)?.document.hash,
    }));

    expect(headers).toEqual([
      { id: 'billing', documentId: 'billing-api', title: 'Billing', hashMatches: true },
      { id: 'orders', documentId: 'orders-api', title: 'Orders', hashMatches: true },
      { id: 'shipping', documentId: 'shipping-api', title: 'Shipping', hashMatches: true },
    ]);
  });
});

/** A merged schema's body with its references put back into the names its service used. */
function rebuild(
  merged: NonNullable<ReturnType<IRDocument['schemas']['get']>>,
  maps: RewriteMaps,
): unknown {
  if (merged.normalized === undefined) return undefined;
  const back = rewriteNode(
    operation({
      id: 'x',
      path: '/x',
      responses: [
        {
          statusCode: '200',
          content: [{ mediaType: 'application/json', schema: { kind: 'inline', schema: merged } }],
        },
      ],
    }),
    { id: 'x', serviceId: '' },
    maps,
  );

  const slot = back.kind === 'operation' ? back.responses[0]?.content[0]?.schema : undefined;
  return slot?.kind === 'inline' ? slot.schema.normalized : undefined;
}

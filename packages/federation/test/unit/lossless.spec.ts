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
        ],
        webhooks: [operation({ id: 'webhook-post-paid', path: '/paid', method: 'post' })],
        relationships: [
          { from: 'get-status', to: 'orders', type: 'calls', confidence: 'declared' },
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
      { id: 'billing', count: 4, matches: 4 },
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

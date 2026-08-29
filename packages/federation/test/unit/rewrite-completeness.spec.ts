import { describe, expect, it } from 'vitest';
import { federatedSchemaId, normalizeAsyncApiDocument } from '@openref/core';
import type { IRDocument } from '@openref/core';
import { mergeDocuments } from '../../src/index';
import { buildDocument, namedSchema, referenceHeavyOperation } from '../mocks/documents';

/**
 * Whether the rewrite reaches every position a reference can be in.
 *
 * THE FAILURE THIS SUITE IS AGAINST IS A FIELD NOBODY LISTED. Rewriting is field by field, so the
 * defect it can have is silent: a schema slot in a position the list forgot keeps the name the
 * service used, and in a merged document that name belongs to another service or to nothing. The
 * fixture puts a reference in every position the IR admits one and the assertion is not that the
 * ones we thought of moved, but that the old name survives nowhere except in the data this project
 * promises to carry verbatim.
 */

/** One reference found anywhere in a value, with the key it was under and the path to it. */
interface FoundReference {
  readonly at: string;
  readonly key: string;
  readonly value: string;
}

/** Property names the IR uses for a reference, whatever the surrounding shape turns out to be. */
const REFERENCE_KEYS = ['schemaId', '$ref', '$cycle', 'schemeId', 'nodeId'];

/**
 * Collects every reference in a value, including the ones inside verbatim data.
 *
 * IT DOES NOT SKIP WHAT THE ENGINE SKIPS, deliberately: the point is to see what survived, and a
 * collector that also skipped `extensions` could not tell "carried verbatim" from "forgotten".
 */
function collectReferences(value: unknown, at = ''): FoundReference[] {
  if (value === null || typeof value !== 'object') return [];

  if (value instanceof Map) {
    return [...value].flatMap(([key, entry]) => collectReferences(entry, `${at}/${String(key)}`));
  }

  if (Array.isArray(value)) {
    return (value as readonly unknown[]).flatMap((entry, index) =>
      collectReferences(entry, `${at}/${String(index)}`),
    );
  }

  return Object.entries(value).flatMap(([key, entry]) => {
    if (REFERENCE_KEYS.includes(key) && typeof entry === 'string') {
      return [{ at: `${at}/${key}`, key, value: entry }];
    }
    return collectReferences(entry, `${at}/${key}`);
  });
}

/** Two services whose `Target` schemas differ, so the merge has to rename both. */
function mergedWithRenamedTarget(): IRDocument {
  const billing = buildDocument({
    id: 'billing-api',
    schemas: [namedSchema('Target', { type: 'object', properties: { a: { type: 'string' } } })],
    nodes: [referenceHeavyOperation('rich', 'Target')],
    security: [{ id: 'bearer', type: 'http', scheme: 'bearer' }],
  });
  const orders = buildDocument({
    id: 'orders-api',
    schemas: [namedSchema('Target', { type: 'integer' })],
    security: [{ id: 'bearer', type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }],
  });

  return mergeDocuments(
    [
      { id: 'billing', document: billing },
      { id: 'orders', document: orders },
    ],
    { id: 'platform', info: { title: 'Platform', version: '1' } },
  ).document;
}

describe('rewriting, every position a reference can be in', () => {
  it('should leave the old schema id nowhere but in the verbatim data', () => {
    // Given a merge that moved `Target` into the federated id space of SPEC 15
    const document = mergedWithRenamedTarget();
    const node = document.nodes.get('billing_rich');

    // When every reference in the node is collected, verbatim data included
    const stale = collectReferences(node).filter((reference) => reference.value === 'Target');

    // Then the only ones left are inside the vendor extension, which is carried as it was written
    expect(stale.map((reference) => reference.at)).toEqual([
      '/extensions/x-vendor/$ref',
      '/extensions/x-vendor/schemaId',
    ]);
  });

  it('should move the reference in every position the fixture put one', () => {
    // Given the same merge
    const document = mergedWithRenamedTarget();
    const node = document.nodes.get('billing_rich');

    // When the positions that now point at the renamed schema are collected
    const moved = collectReferences(node)
      .filter((reference) => reference.value === federatedSchemaId('billing', 'Target'))
      .map((reference) => reference.at)
      .sort();

    // Then every position of the fixture is among them, and the count is the count it planted
    expect(moved).toEqual([
      '/parameters/0/schema/schemaId',
      '/requestBody/content/0/encoding/part/headers/0/schema/schemaId',
      '/requestBody/content/0/schema/schema/normalized/additionalProperties/$ref',
      '/requestBody/content/0/schema/schema/normalized/allOf/0/$ref',
      '/requestBody/content/0/schema/schema/normalized/anyOf/0/$ref',
      '/requestBody/content/0/schema/schema/normalized/else/$ref',
      '/requestBody/content/0/schema/schema/normalized/if/$ref',
      '/requestBody/content/0/schema/schema/normalized/items/$cycle',
      '/requestBody/content/0/schema/schema/normalized/not/$ref',
      '/requestBody/content/0/schema/schema/normalized/oneOf/0/$ref',
      '/requestBody/content/0/schema/schema/normalized/patternProperties/^x-/$ref',
      '/requestBody/content/0/schema/schema/normalized/prefixItems/0/$ref',
      '/requestBody/content/0/schema/schema/normalized/properties/direct/$ref',
      '/requestBody/content/0/schema/schema/normalized/properties/nested/items/$ref',
      '/requestBody/content/0/schema/schema/normalized/propertyNames/$ref',
      '/requestBody/content/0/schema/schema/normalized/then/$ref',
      '/requestBody/content/0/schema/schema/normalized/variants/0/schema/$ref',
      '/responses/0/content/0/schema/schemaId',
      '/responses/0/headers/0/schema/schemaId',
      '/responses/0/itemSchema/schemaId',
      '/runtime/drift/0/schemaId',
      '/runtime/errors/declared/0/schema/schemaId',
      '/runtime/errors/global/0/schema/schemaId',
      '/runtime/errors/runtimeDerived/0/schema/schemaId',
      '/runtime/streaming/value/itemSchema/schemaId',
    ]);
  });

  it('should move the security requirement onto the scheme its own service declared', () => {
    // Given a merge in which two services configured `bearer` differently
    const document = mergedWithRenamedTarget();
    const node = document.nodes.get('billing_rich');

    // When the requirement is read
    const requirement = node?.kind === 'operation' ? node.security[0]?.schemeId : undefined;

    // Then it names the renamed scheme rather than the plain one
    expect(requirement).toBe(federatedSchemaId('billing', 'bearer'));
    expect(document.security.map((scheme) => scheme.id).sort()).toEqual(
      [federatedSchemaId('billing', 'bearer'), federatedSchemaId('orders', 'bearer')].sort(),
    );
  });

  it('should move a drift finding onto the merged node id', () => {
    // Given the same merge, whose fixture carries a finding about its own node
    const document = mergedWithRenamedTarget();
    const node = document.nodes.get('billing_rich');

    // When the finding is read
    const nodeId = node?.kind === 'operation' ? node.runtime?.drift?.[0]?.nodeId : undefined;

    // Then it addresses the node by the name the merged document knows it by
    expect(nodeId).toBe('billing_rich');
  });

  it('should not write into the documents it was handed', () => {
    // Given a frozen source document, which is what `finalizeDocument` produces
    const billing = buildDocument({
      id: 'billing-api',
      schemas: [namedSchema('Target', { type: 'object' })],
      nodes: [referenceHeavyOperation('rich', 'Target')],
    });
    const orders = buildDocument({
      id: 'orders-api',
      schemas: [namedSchema('Target', { type: 'integer' })],
    });

    // When it is merged
    mergeDocuments(
      [
        { id: 'billing', document: billing },
        { id: 'orders', document: orders },
      ],
      { id: 'platform', info: { title: 'Platform', version: '1' } },
    );

    // Then the source still says what it said, under the names it used
    const node = billing.nodes.get('rich');
    expect(node?.id).toBe('rich');
    expect(node?.serviceId).toBeUndefined();
    expect(billing.schemas.get('Target')?.id).toBe('Target');
  });
});

/**
 * Two event services whose security schemes share one name, normalized from real AsyncAPI input.
 *
 * THE SCHEME POSITIONS OF AN EVENT DOCUMENT ARE NOT THE SAME POSITIONS AS AN HTTP ONE'S, which is
 * why this fixture is here rather than folded into the operation above. `T051` gave `IRServer` and
 * `IRChannelOperation` a `security` member, and neither is reachable from an `IROperation`: the
 * first travels on `IRService.servers` and the second on a channel. A merge that renamed the
 * schemes and left either position alone would carry an id no merged document holds, and the
 * reference walk of `references.ts` would refuse the merge by name.
 *
 * @param serviceId - The federation id to build the document for, which becomes the namespace
 * @returns A one channel, one server events document declaring a scheme called `sasl`
 */
function eventService(serviceId: string): IRDocument {
  return normalizeAsyncApiDocument({
    asyncapi: '3.1.0',
    info: { title: `${serviceId} events`, version: '1.0.0' },
    servers: {
      broker: {
        host: `${serviceId}.example.com`,
        protocol: 'kafka',
        security: [{ $ref: '#/components/securitySchemes/sasl' }],
      },
    },
    channels: { orders: { address: `${serviceId}/orders`, messages: { placed: {} } } },
    operations: {
      publish: {
        action: 'send',
        channel: { $ref: '#/channels/orders' },
        security: [{ $ref: '#/components/securitySchemes/sasl' }],
      },
    },
    // The description differs per service on purpose. Two byte identical schemes claiming one
    // name are one scheme to the merge, which deduplicates them and renames nothing, and a
    // rewrite that never ran cannot be proved by a name that never moved.
    components: {
      securitySchemes: { sasl: { type: 'scramSha256', description: `${serviceId} credentials` } },
    },
  });
}

describe('rewriting the two security positions an events document brings', () => {
  it('should move a channel operation requirement onto the scheme its own service declared', () => {
    // Given two services that both call their scheme `sasl`, so the merge has to rename both.
    // The requirement below means nothing unless the source really carried one, so it is read off
    // the source first: a normalizer that stopped carrying it would otherwise make the merged
    // answer trivially correct by having nothing to move.
    const billing = eventService('billing');
    const orders = eventService('orders');
    const sourceChannel = billing.nodes.get('channel-billing-orders');
    expect(sourceChannel?.kind).toBe('channel');
    expect(
      sourceChannel?.kind === 'channel' ? sourceChannel.operations[0]?.security : undefined,
    ).toEqual([{ schemeId: 'sasl', scopes: [] }]);

    // When
    const { document } = mergeDocuments(
      [
        { id: 'billing', document: billing },
        { id: 'orders', document: orders },
      ],
      { id: 'platform', info: { title: 'Platform', version: '1' } },
    );
    const merged = document.nodes.get('billing_channel-billing-orders');

    // Then it names the renamed scheme, and that scheme is one the merged document holds
    const schemeId =
      merged?.kind === 'channel' ? merged.operations[0]?.security?.[0]?.schemeId : undefined;
    expect(schemeId).toBe(federatedSchemaId('billing', 'sasl'));
    expect(document.security.map((scheme) => scheme.id)).toContain(schemeId);
  });

  it('should move a server requirement carried on the per service record', () => {
    // Given the same two services, whose servers each name their own `sasl`
    const billing = eventService('billing');
    expect(billing.servers[0]?.security).toEqual([{ schemeId: 'sasl', scopes: [] }]);

    // When
    const { document } = mergeDocuments(
      [
        { id: 'billing', document: billing },
        { id: 'orders', document: eventService('orders') },
      ],
      { id: 'platform', info: { title: 'Platform', version: '1' } },
    );
    const service = (document.services ?? []).find((entry) => entry.id === 'billing');

    // Then the record's own server names the renamed scheme. The merged document's `servers` come
    // from the caller and carry none, per SPEC 15.1, so this record is the only place it lives.
    expect(service?.servers[0]?.security).toEqual([
      { schemeId: federatedSchemaId('billing', 'sasl'), scopes: [] },
    ]);
    expect(document.servers).toEqual([]);
  });

  it('should leave no reference in the merged document that resolves to nothing', () => {
    // Given the merge of two event services, which is where an unrewritten `schemeId` would sit
    const { document, report } = mergeDocuments(
      [
        { id: 'billing', document: eventService('billing') },
        { id: 'orders', document: eventService('orders') },
      ],
      { id: 'platform', info: { title: 'Platform', version: '1' } },
    );

    // When the schemes the document holds are compared with the ones its positions name
    const declared = new Set(document.security.map((scheme) => scheme.id));
    const named = [
      ...(document.services ?? []).flatMap((service) =>
        service.servers.flatMap((server) => server.security ?? []),
      ),
      ...[...document.nodes.values()].flatMap((node) =>
        node.kind === 'channel'
          ? node.operations.flatMap((operation) => operation.security ?? [])
          : node.security,
      ),
    ];

    // Then, and the merge returning at all is half the proof: it refuses a document whose
    // references resolve to nothing, so this assertion and that refusal check each other.
    expect(named.length).toBe(4);
    expect(named.filter((requirement) => !declared.has(requirement.schemeId))).toEqual([]);
    expect(report.renames.filter((rename) => rename.kind === 'security-scheme')).toHaveLength(2);
  });
});

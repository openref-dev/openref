import { describe, expect, it } from 'vitest';
import { federatedSchemaId } from '@openref/core';
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

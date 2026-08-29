import { describe, expect, it } from 'vitest';
import type { IRDocument } from '@openref/core';
import { mergeDocuments, mismatchedKeys, unresolvedReferences } from '../../src/index';
import { buildDocument, namedSchema, operation } from '../mocks/documents';

/**
 * The check the merge runs on its own output.
 *
 * IT IS ALSO THE CHECK THAT DECIDES WHAT THE MERGE IS ANSWERABLE FOR. Real documents arrive with a
 * security requirement naming a scheme nobody declared, and a merge that refused those would be
 * this tool inventing a rule OpenAPI does not have. So the comparison is against the sources: a
 * reference that was already dangling stays dangling and is nobody's fault here, and one that
 * resolved before and does not now stops the merge.
 */

const MERGED = { id: 'platform', info: { title: 'Platform', version: '1' } } as const;

describe('unresolvedReferences', () => {
  it('should find nothing in a document whose references all resolve', () => {
    // Given a document whose response points at a schema it declares
    const document = buildDocument({
      id: 'billing-api',
      schemas: [namedSchema('Money', { type: 'integer' })],
      nodes: [
        operation({
          id: 'get-total',
          path: '/total',
          responses: [
            {
              statusCode: '200',
              content: [
                { mediaType: 'application/json', schema: { kind: 'named', schemaId: 'Money' } },
              ],
            },
          ],
        }),
      ],
    });

    // When it is checked
    const findings = unresolvedReferences(document);

    // Then there is nothing to report
    expect(findings).toEqual([]);
  });

  it('should find a slot, a $ref, a navigation target and a callback that point at nothing', () => {
    // Given a document with one of each
    const document = buildDocument({
      id: 'billing-api',
      schemas: [namedSchema('Money', { type: 'object', properties: { of: { $ref: 'Gone' } } })],
      nodes: [
        operation({
          id: 'get-total',
          path: '/total',
          responses: [
            {
              statusCode: '200',
              content: [
                { mediaType: 'application/json', schema: { kind: 'named', schemaId: 'Absent' } },
              ],
            },
          ],
          callbacks: { onEvent: ['no-such-node'] },
        }),
      ],
    });
    const broken: IRDocument = {
      ...document,
      navigation: [{ id: 'nav-x', label: 'x', kind: 'node', nodeId: 'no-such-node', children: [] }],
    };

    // When it is checked
    const findings = unresolvedReferences(broken).map(
      (finding) => `${finding.kind} ${finding.target} at ${finding.at}`,
    );

    // Then every one of them is named, with where it was found
    expect(findings.sort()).toEqual([
      'node no-such-node at /navigation/0/nodeId',
      'node no-such-node at nodes/get-total/callbacks/onEvent',
      'schema Absent at /nodes/get-total/responses/0/content/0/schema/schemaId',
      'schema Gone at /schemas/Money/normalized/properties/of/$ref',
    ]);
  });

  it('should not read a reference shaped string inside verbatim data as a reference', () => {
    // Given a document whose vendor extension and whose example both contain a $ref
    const document = buildDocument({
      id: 'billing-api',
      nodes: [
        operation({
          id: 'get-total',
          path: '/total',
          extensions: { 'x-vendor': { $ref: 'Nowhere', schemaId: 'Nowhere' } },
          responses: [
            {
              statusCode: '200',
              content: [
                {
                  mediaType: 'application/json',
                  example: { $ref: 'AlsoNowhere' },
                  examples: { one: { value: { schemaId: 'StillNowhere' } } },
                },
              ],
            },
          ],
        }),
      ],
    });

    // When it is checked
    const findings = unresolvedReferences(document);

    // Then nothing is reported, because none of that is a reference this project resolves
    expect(findings).toEqual([]);
  });

  it('should find a service id on a node that no service entry declares', () => {
    // Given a document claiming a node belongs to a service it does not list
    const document = buildDocument({
      id: 'billing-api',
      nodes: [{ ...operation({ id: 'get-total', path: '/total' }), serviceId: 'ghost' }],
    });

    // When it is checked
    const findings = unresolvedReferences(document);

    // Then the claim is reported rather than rendered as a service page that does not exist
    expect(findings).toEqual([
      { kind: 'service', target: 'ghost', at: '/nodes/get-total/serviceId' },
    ]);
  });
});

describe('mismatchedKeys', () => {
  it('should find a map key that disagrees with the id of what it holds', () => {
    // Given a document whose node map was keyed by something other than the node's id
    const document = buildDocument({ id: 'billing-api' });
    const broken: IRDocument = {
      ...document,
      nodes: new Map([['wrong-key', operation({ id: 'get-total', path: '/total' })]]),
    };

    // When it is checked
    const problems = mismatchedKeys(broken);

    // Then the disagreement is named, because a link built from the key lands nowhere
    expect(problems).toEqual(['nodes/wrong-key holds a node whose id is get-total']);
  });

  it('should find nothing in a merged document', () => {
    // Given two merged services
    const { document } = mergeDocuments(
      [
        {
          id: 'billing',
          document: buildDocument({
            id: 'billing-api',
            nodes: [operation({ id: 'get-total', path: '/total' })],
            schemas: [namedSchema('Money', { type: 'integer' })],
          }),
        },
        {
          id: 'orders',
          document: buildDocument({
            id: 'orders-api',
            webhooks: [operation({ id: 'webhook-post-hook', path: '/hook', method: 'post' })],
          }),
        },
      ],
      MERGED,
    );

    // When the merged document is checked
    const problems = mismatchedKeys(document);

    // Then every map key is the id of what it holds
    expect(problems).toEqual([]);
  });
});

describe('mergeDocuments, references it did not break', () => {
  it('should merge a document whose security requirement names an undeclared scheme', () => {
    // Given a document of a kind that really exists: a requirement with no declaration
    const billing = buildDocument({
      id: 'billing-api',
      nodes: [
        operation({
          id: 'get-total',
          path: '/total',
          security: [{ schemeId: 'apiKey', scopes: [] }],
        }),
      ],
    });
    const orders = buildDocument({ id: 'orders-api' });

    // When it is merged
    const { document } = mergeDocuments(
      [
        { id: 'billing', document: billing },
        { id: 'orders', document: orders },
      ],
      MERGED,
    );
    const node = document.nodes.get('billing_get-total');

    // Then the merge does not refuse over a hole it did not make, and leaves the name alone
    expect(node?.kind === 'operation' ? node.security[0]?.schemeId : undefined).toBe('apiKey');
    expect(unresolvedReferences(document).map((finding) => finding.target)).toEqual(['apiKey']);
  });
});

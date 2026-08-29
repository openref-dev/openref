import { describe, expect, it } from 'vitest';
import { ErrorCode, FederationError } from '@openref/core';
import type { IRDocument } from '@openref/core';
import { refuseBrokenReferences, unresolvedReferences } from '../../src/index';
import { buildDocument, namedSchema, operation } from '../mocks/documents';

/**
 * The refusal itself, fired.
 *
 * NO INPUT TO `mergeDocuments` CAN PROVOKE THIS WHILE THE REWRITE IS COMPLETE, which is the point
 * of both. The throw exists for the day a field is added to the IR and forgotten in `rewrite.ts`,
 * so the only honest way to watch it fire is to hand the check a document the rewrite never
 * built: one carrying exactly the stale reference such a gap would leave behind. What these cases
 * pin is that when that day comes, the merge refuses loudly, names the broken position, and
 * blames only the hole it introduced, never one a source already had.
 */

/** A response whose body is the named schema `Money`, before and after the imagined gap. */
const MONEY_RESPONSE = {
  statusCode: '200',
  content: [{ mediaType: 'application/json', schema: { kind: 'named', schemaId: 'Money' } }],
} as const;

describe('refuseBrokenReferences', () => {
  it('should refuse a document with an introduced dangling reference, naming its position', () => {
    // Given a source in which `Money` resolves and only the `apiKey` hole is pre-existing
    const source = buildDocument({
      id: 'billing-api',
      schemas: [namedSchema('Money', { type: 'integer' })],
      nodes: [
        operation({
          id: 'get-total',
          path: '/total',
          responses: [MONEY_RESPONSE],
          security: [{ schemeId: 'apiKey', scopes: [] }],
        }),
      ],
    });
    expect(unresolvedReferences(source).map((finding) => finding.target)).toEqual(['apiKey']);

    // And the document a gap in the rewrite would build: the schema moved, the slot did not
    const merged = buildDocument({
      id: 'platform',
      schemas: [namedSchema('~s0c95c7ec~Money', { type: 'integer' }, 'Money')],
      nodes: [
        operation({
          id: 'billing_get-total',
          path: '/total',
          responses: [MONEY_RESPONSE],
          security: [{ schemeId: 'apiKey', scopes: [] }],
        }),
      ],
    });
    expect(
      unresolvedReferences(merged)
        .map((finding) => finding.target)
        .sort(),
    ).toEqual(['Money', 'apiKey']);

    // When the merge checks that document against its source
    let error: unknown;
    try {
      refuseBrokenReferences([{ id: 'billing', document: source }], merged);
    } catch (caught) {
      error = caught;
    }

    // Then the refusal is a FederationError carrying the code SPEC 15 assigns an incomplete merge
    expect(error).toBeInstanceOf(FederationError);
    expect(error).toMatchObject({ code: ErrorCode.FED_MERGE_INCOMPLETE });

    // And it names the broken position and its target
    expect((error as FederationError).message).toContain(
      '/nodes/billing_get-total/responses/0/content/0/schema/schemaId refers to the schema Money',
    );

    // And the pre-existing hole, asserted present in both documents above, is not blamed
    expect((error as FederationError).message).not.toContain('apiKey');
    expect((error as FederationError).context).toEqual({ introduced: 1, mismatched: 0 });
  });

  it('should refuse a document whose map key disagrees with the id of what it holds', () => {
    // Given a source with nothing dangling in it
    const source = buildDocument({ id: 'billing-api' });
    expect(unresolvedReferences(source)).toEqual([]);

    // And a merged document whose schema map was keyed by something other than the schema's id
    const merged: IRDocument = {
      ...buildDocument({ id: 'platform' }),
      schemas: new Map([['Money', namedSchema('Coin', { type: 'integer' })]]),
    };

    // When the merge checks it
    let error: unknown;
    try {
      refuseBrokenReferences([{ id: 'billing', document: source }], merged);
    } catch (caught) {
      error = caught;
    }

    // Then the refusal names the disagreement, with no empty clause for the zero references
    expect(error).toBeInstanceOf(FederationError);
    expect(error).toMatchObject({ code: ErrorCode.FED_MERGE_INCOMPLETE });
    expect((error as FederationError).message).toBe(
      'the merge produced a document whose own references do not resolve: ' +
        'schemas/Money holds a schema whose id is Coin',
    );
    expect((error as FederationError).context).toEqual({ introduced: 0, mismatched: 1 });
  });
});

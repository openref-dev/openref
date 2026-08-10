import { describe, expect, it } from 'vitest';
import { normalizeOpenApiDocument } from '@openref/core';
import { largeDocument } from '../../../../packages/render/test/mocks/documents';
import { largeSpecification, TTI_NODE_COUNT } from '../../src/fixture/specification';

/**
 * The generated document is the one the jsdom ceilings already use.
 *
 * `client-cost.spec.ts` in `@openref/render` bounds hydration work on a thousand nodes cheaply
 * and in every CI run, and this package measures the same page in a real browser. They are only
 * two views of one thing while they measure one document. Two generators drifting apart would
 * leave both claiming a thousand nodes and measuring different pages, and nothing would say so.
 *
 * Read across the package boundary on purpose. It is a test reading a test fixture, not an
 * import edge in `src`, so the dependency graph is untouched; `theme.spec.ts` reads the
 * renderer's source from disk for the same reason and records it.
 */
describe('the document TTI is measured on', () => {
  it('should be the same document the jsdom ceilings measure, hash included', () => {
    // Given
    const fromRenderMocks = largeDocument(TTI_NODE_COUNT);

    // When
    const fromFixture = normalizeOpenApiDocument(largeSpecification(TTI_NODE_COUNT));

    // Then
    expect(fromFixture.hash).toBe(fromRenderMocks.hash);
    expect(fromFixture.nodes.size).toBe(TTI_NODE_COUNT);
  });

  it('should carry the node count SPEC 20 writes the budget about', () => {
    // Given, the budget says a thousand nodes, so a fixture of nine hundred would pass a
    // threshold that was never about nine hundred.
    // When
    const document = normalizeOpenApiDocument(largeSpecification(TTI_NODE_COUNT));

    // Then
    expect(TTI_NODE_COUNT).toBe(1000);
    expect(document.nodes.size).toBe(1000);
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeOpenApiDocument } from '@openref/core';
import { largeDocument } from '../../../../packages/render/test/mocks/documents';
import { largeSpecification, TTI_NODE_COUNT } from '../../src/fixture/specification';
import { TTI_PAGE, TTI_PAGE_MARKER } from '../../src/study';

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

/**
 * The page the study navigates to, held to the fixture it is read off.
 *
 * A route and a marker written out by hand beside a generated document are two facts that can
 * disagree, and when they disagreed the study threw instead of measuring. That is the right
 * failure and it is a slow one: it costs a runner round trip to find out. This is the same
 * check, in the suite that runs on every push.
 */
describe('the page the study measures', () => {
  it('should be a real operation of the fixture, with the text the guard looks for', () => {
    // Given
    const document = normalizeOpenApiDocument(largeSpecification(TTI_NODE_COUNT));
    const id = TTI_PAGE.replace('/docs/', '');

    // When
    const node = document.nodes.get(id);

    // Then
    expect(node).toBeDefined();
    expect(node?.summary).toBe(TTI_PAGE_MARKER);
  });

  it('should be a page out of the middle of the navigation rather than the first', () => {
    // Given, because the first page of a document is the one whose navigation slice is cheapest
    const document = normalizeOpenApiDocument(largeSpecification(TTI_NODE_COUNT));

    // When
    const position = [...document.nodes.keys()].indexOf(TTI_PAGE.replace('/docs/', ''));

    // Then
    expect(position).toBe(500);
  });
});

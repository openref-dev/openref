import { describe, expect, it } from 'vitest';
import { createMemoryRenderCache } from '../../src/cache/infrastructure/adapters/memory-render-cache.adapter';
import { createOpenRefHighlighter } from '../../src/highlight/domain/highlight';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { renderPage } from '../../src/render/application/services/render.service';
import { largeDocument } from '../mocks/documents';

/**
 * The prerender budget of SPEC 20: a document of 1000 nodes, 2 seconds, once per hash.
 *
 * The unit being measured is the SSR that SPEC 12 performs and then caches: the shell, the
 * navigation over all 1000 nodes, and the current node. Rendering all 1000 pages is the
 * static build, which SPEC 20 budgets separately at 60 seconds and T039 owns.
 *
 * A wall clock assertion is loose by nature and machine dependent, which is why the suite
 * also asserts the shape of the work: the navigation is rendered once per page and the
 * cache answers the second call without rendering at all.
 */
const NODE_COUNT = 1000;
const BUDGET_MS = 2000;

describe('prerender budget', () => {
  it('should render a page of a 1000 node document within the budget', async () => {
    // Given
    const document = largeDocument(NODE_COUNT);
    const highlighter = await createOpenRefHighlighter(['json']);
    const markdown = createMarkdownRenderer({ highlighter });
    const nodeId = [...document.nodes.keys()][0] ?? '';

    // When
    const started = performance.now();
    const page = await renderPage(document, { nodeId, markdown });
    const elapsed = performance.now() - started;

    // Then
    expect(document.nodes.size).toBe(NODE_COUNT);
    expect(page.appHtml).toContain('oref-nav');
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('should answer the second render of one page from the cache', async () => {
    // Given
    const document = largeDocument(NODE_COUNT);
    const cache = createMemoryRenderCache();
    const nodeId = [...document.nodes.keys()][0] ?? '';
    await renderPage(document, { nodeId, cache });

    // When
    const started = performance.now();
    const second = await renderPage(document, { nodeId, cache });
    const elapsed = performance.now() - started;

    // Then
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1 });
    expect(second.appHtml).toContain('oref-nav');
    expect(elapsed).toBeLessThan(BUDGET_MS / 10);
  });

  it('should render every navigation entry rather than truncating a large document', async () => {
    // Given
    const document = largeDocument(NODE_COUNT);

    // When
    const page = await renderPage(document);

    // Then
    const links = page.appHtml.match(/<a class="oref-nav-item/g) ?? [];
    expect(links).toHaveLength(NODE_COUNT);
  });
});

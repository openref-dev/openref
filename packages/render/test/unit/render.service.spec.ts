import { describe, expect, it } from 'vitest';
import { createMemoryRenderCache } from '../../src/cache/infrastructure/adapters/memory-render-cache.adapter';
import {
  renderAllPages,
  renderCacheKey,
  renderPage,
  serializePageModel,
} from '../../src/render/application/services/render.service';
import { buildPageModel } from '../../src/page/domain/page-model';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { hostileDocument, smallDocument } from '../mocks/documents';

describe('renderCacheKey', () => {
  it('should separate two nodes of one document', () => {
    // Given
    const hash = 'abc';

    // When
    const keys = [renderCacheKey(hash, 'a'), renderCacheKey(hash, 'b')];

    // Then
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('should separate the overview from a node whose id is empty', () => {
    // Given
    const hash = 'abc';

    // When
    const overview = renderCacheKey(hash, null);

    // Then
    expect(overview).toContain(hash);
  });

  it('should separate two mount points, because links are part of the bytes', () => {
    // Given
    const hash = 'abc';

    // When
    const keys = [renderCacheKey(hash, 'a', ''), renderCacheKey(hash, 'a', '/docs')];

    // Then
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('should carry the versions that can change the bytes without the document changing', () => {
    // Given
    const key = renderCacheKey('abc', null);

    // When
    const versioned = /^oref:\d+\.\d+\.\d+:abc:/.test(key);

    // Then
    expect(versioned).toBe(true);
  });
});

describe('renderPage', () => {
  it('should render the overview when no node is asked for', async () => {
    // Given
    const document = smallDocument();

    // When
    const page = await renderPage(document);

    // Then
    expect(page.nodeId).toBeNull();
    expect(page.title).toBe('Orders API');
    expect(page.appHtml).toContain('oref-overview');
  });

  it('should render the navigation and the current node together', async () => {
    // Given
    const document = smallDocument();
    const nodeId = [...document.nodes.keys()].find((id) => id.includes('get')) ?? '';

    // When
    const page = await renderPage(document, { nodeId });

    // Then
    expect(page.appHtml).toContain('oref-nav');
    expect(page.appHtml).toContain('oref-operation');
    expect(page.appHtml).toContain('/orders');
    expect(page.title).toContain('Orders API');
  });

  it('should mark the active navigation entry for the node it rendered', async () => {
    // Given
    const document = smallDocument();
    const nodeId = [...document.nodes.keys()][0] ?? '';

    // When
    const page = await renderPage(document, { nodeId });

    // Then
    expect(page.appHtml).toContain('aria-current="page"');
  });

  it('should hit the cache on a second render of the same hash and node', async () => {
    // Given
    const document = smallDocument();
    const cache = createMemoryRenderCache();
    const nodeId = [...document.nodes.keys()][0] ?? '';

    // When
    const first = await renderPage(document, { nodeId, cache });
    const second = await renderPage(document, { nodeId, cache });

    // Then
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1, entries: 1 });
    expect(second).toBe(first);
  });

  it('should produce identical bytes whether or not the cache answered', async () => {
    // Given
    const document = smallDocument();
    const nodeId = [...document.nodes.keys()][0] ?? '';

    // When
    const uncached = await renderPage(document, { nodeId });
    const alsoUncached = await renderPage(document, { nodeId });

    // Then
    expect(alsoUncached.appHtml).toBe(uncached.appHtml);
    expect(alsoUncached.stateJson).toBe(uncached.stateJson);
  });

  it('should keep two nodes apart in one cache', async () => {
    // Given
    const document = smallDocument();
    const cache = createMemoryRenderCache();
    const ids = [...document.nodes.keys()];

    // When
    const first = await renderPage(document, { nodeId: ids[0] ?? '', cache });
    const second = await renderPage(document, { nodeId: ids[1] ?? '', cache });

    // Then
    expect(first.appHtml).not.toBe(second.appHtml);
    expect(cache.stats().entries).toBe(2);
  });

  it('should write no script and no inline style into the application markup', async () => {
    // Given
    const document = hostileDocument();
    const nodeId = [...document.nodes.keys()][0] ?? '';

    // When
    const page = await renderPage(document, { nodeId });

    // Then
    expect(page.appHtml).not.toContain('<script');
    expect(page.appHtml).not.toContain('onerror');
    expect(/[\s'"`;{(]style\s*=/.test(page.appHtml)).toBe(false);
  });

  it('should build links against the mount point it was given', async () => {
    // Given
    const document = smallDocument();

    // When
    const page = await renderPage(document, { basePath: '/docs' });

    // Then
    expect(page.appHtml).toContain('href="/docs/');
  });
});

describe('serializePageModel', () => {
  it('should serialize canonically, so two runs produce one string', () => {
    // Given
    const document = smallDocument();
    const markdown = createMarkdownRenderer();
    const model = buildPageModel(document, { markdown });

    // When
    const results = [serializePageModel(model), serializePageModel(model)];

    // Then
    expect(results[0]).toBe(results[1]);
    expect(results[0]?.startsWith('{')).toBe(true);
  });
});

describe('renderAllPages', () => {
  it('should render the overview and one page per node', async () => {
    // Given
    const document = smallDocument();

    // When
    const pages = await renderAllPages(document);

    // Then
    expect(pages).toHaveLength(document.nodes.size + 1);
    expect(pages[0]?.nodeId).toBeNull();
  });

  it('should fill the cache it was given', async () => {
    // Given
    const document = smallDocument();
    const cache = createMemoryRenderCache();

    // When
    await renderAllPages(document, { cache });

    // Then
    expect(cache.stats().entries).toBe(document.nodes.size + 1);
  });
});

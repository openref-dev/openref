import { normalizeOpenApiDocument } from '@openref/core';
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
    // Given a node page, because an overview opens no group and so renders no operation link
    const document = smallDocument();
    const nodeId = [...document.nodes.keys()][0] ?? '';

    // When
    const page = await renderPage(document, { basePath: '/docs', nodeId });

    // Then
    expect(page.appHtml).toContain('href="/docs/');
  });
});

describe('serializePageModel', () => {
  it('should produce one string from two independently built models', async () => {
    // Given two models built from scratch over one document. TWO MODELS AND NOT ONE MODEL TWICE:
    // serializing the same object twice is green under any implementation, so it asserts nothing
    // about the property this budget and the static build rest on.
    const markdown = await createMarkdownRenderer();
    const models = [
      buildPageModel(smallDocument(), { markdown }),
      buildPageModel(smallDocument(), { markdown }),
    ];

    // When
    const results = models.map((model) => serializePageModel(model));

    // Then
    expect(results[0]).toBe(results[1]);
    expect(results[0]?.startsWith('{')).toBe(true);
  });

  it('should ship a schema in the order its author wrote it, not in alphabetical order', async () => {
    // Given a schema whose properties are deliberately not alphabetical, which is what an address
    // is. The server renders the tree from the model in memory and the browser renders it from
    // this JSON, so a serializer that sorts keys makes the two disagree the moment the client
    // renders anything, and the tree reorders itself under a reader who opened a position. Found
    // in a browser on the demo, recorded in SPEC 12.
    // The schema travels on the request side, because response schemas left the payload with
    // TX-PARITY-UI and a payload that ships nothing has no order to assert.
    const authored = ['line1', 'city', 'postalCode', 'country', 'geo'];
    const document = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'Addresses', version: '1.0.0' },
      paths: {
        '/a': {
          post: {
            operationId: 'postA',
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/AddressDto' } },
              },
            },
            responses: { '201': { description: 'ok' } },
          },
        },
      },
      components: {
        schemas: {
          AddressDto: {
            type: 'object',
            properties: Object.fromEntries(authored.map((name) => [name, { type: 'string' }])),
          },
        },
      },
    });
    const markdown = await createMarkdownRenderer();
    // The id is the one SPEC 5.1 derives from the method and the path, not the `operationId`.
    const model = buildPageModel(document, { markdown, nodeId: 'post-a' });

    // When
    const parsed = JSON.parse(serializePageModel(model)) as {
      schemas: Record<string, { normalized?: { properties?: Record<string, unknown> } }>;
    };

    // Then
    expect(Object.keys(parsed.schemas.AddressDto?.normalized?.properties ?? {})).toEqual(authored);
  });
});

describe('renderAllPages', () => {
  /**
   * Pages the walk produces: overview, health, states, nodes, a bench per operation, schemas
   * and a shapes page per schema. The showcase pages entered the walk with TX-PARITY-UI, when
   * the bar gained their tabs: the walk is every page a tab links to.
   */
  function expectedCount(document: ReturnType<typeof smallDocument>): number {
    const operations = [...document.nodes.values()].filter(
      (node) => node.kind === 'operation',
    ).length;

    return document.nodes.size + operations + document.schemas.size * 2 + 3;
  }

  it('should render every page a link can reach: overview, health, states, nodes, benches, schemas, shapes', async () => {
    // Given, a schema has a page because the navigation ends in a Schemas group that links to
    // one; the health page and a bench per operation are here since TX-FRAME because the tab
    // bar links to them, and the states and shapes pages since TX-PARITY-UI for the same
    // reason: a build whose tabs 404 is the same broken link.
    const document = smallDocument();

    // When
    const pages = await renderAllPages(document);

    // Then
    expect(pages).toHaveLength(expectedCount(document));
    expect(pages[0]?.nodeId).toBeNull();
    expect(pages[0]?.schemaId).toBeNull();
    expect(pages.filter((page) => page.schemaId !== null)).toHaveLength(document.schemas.size * 2);
    expect(pages.filter((page) => page.title.startsWith('Bench:'))).toHaveLength(
      [...document.nodes.values()].filter((node) => node.kind === 'operation').length,
    );
    expect(pages.filter((page) => page.title.startsWith('Documentation health'))).toHaveLength(1);
  });

  it('should fill the cache it was given', async () => {
    // Given
    const document = smallDocument();
    const cache = createMemoryRenderCache();

    // When
    await renderAllPages(document, { cache });

    // Then
    expect(cache.stats().entries).toBe(expectedCount(document));
  });
});

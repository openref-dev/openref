// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeOpenApiDocument, parseSpecification } from '@openref/core';
import { afterEach, describe, expect, it } from 'vitest';
import { hydrateReference } from '../../src/browser/index';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { buildPageModel } from '../../src/page/domain/page-model';
import { renderHtmlDocument } from '../../src/page/domain/shell';
import { renderPage } from '../../src/render/application/services/render.service';
import { largeDocument } from '../mocks/documents';

/**
 * What the client pays, per SPEC 20 and BUILD T012.
 *
 * WHAT IS MEASURED HERE AND WHAT IS NOT, because the difference decides what these numbers are
 * worth. SPEC 20 budgets TTI at 150 ms under a 4x CPU throttle and peak client memory at 250 MB.
 * Neither is a Node measurement: a throttle is a browser control, and jsdom is a different and
 * much slower DOM than a browser engine. `tools/gates/src/config.ts` says as much, listing both
 * as NOT MEASURED HERE and naming T015, which is where a real browser arrives.
 *
 * So this file measures the two things that ARE measurable without a browser and that would
 * make those budgets impossible if they regressed:
 *
 * - the work hydration does on a document of a thousand nodes, which is bounded loosely because
 *   the absolute number is jsdom's rather than a browser's, and which fails at once if the
 *   sidebar ever stops being windowed
 * - the heap a page of a large document costs, against SPEC 20's own figure, because a heap is
 *   a heap in either runtime and the number is not a proxy for anything
 */

const markdown = createMarkdownRenderer();

/** Nodes SPEC 20 budgets TTI and the prerender against. */
const NODE_COUNT = 1000;

/**
 * A loose ceiling on hydration in jsdom, which is not the browser number and does not pretend
 * to be. It is set about an order of magnitude above what a windowed sidebar costs today, so it
 * catches the regression that matters, a page that renders its whole navigation, and nothing
 * else.
 */
const HYDRATION_CEILING_MS = 1500;

/** SPEC 20, peak client memory for a large document. */
const MEMORY_CEILING_BYTES = 250 * 1024 * 1024;

/**
 * The largest document in the corpus, which is what SPEC 20's figure is about.
 *
 * `stripe.yaml` is 1.9 MB of source and 5.3 MB of IR, with 589 operations and 1440 schemas. A
 * synthetic document of a thousand identical nodes measures the renderer; this measures a real
 * one, and it is the document every other cost in this project was found on.
 */
function stripe(): ReturnType<typeof normalizeOpenApiDocument> {
  const path = join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    'core',
    'test',
    'corpus',
    'documents',
    'stripe.yaml',
  );

  return normalizeOpenApiDocument(parseSpecification(readFileSync(path, 'utf8')));
}

afterEach(() => {
  document.documentElement.innerHTML = '';
});

describe('the cost of a page of a thousand nodes', () => {
  it('should hydrate without doing the work of a whole navigation', async () => {
    // Given
    const document_ = largeDocument(NODE_COUNT);
    const nodeId = [...document_.nodes.keys()][500] ?? '';
    const page = await renderPage(document_, { nodeId, markdown });
    document.documentElement.innerHTML = renderHtmlDocument(page, {
      assets: { stylesheets: [], modules: [] },
    });

    // When
    const started = performance.now();
    const hydrated = hydrateReference();
    const elapsed = performance.now() - started;

    // Then
    expect(hydrated).toBe(true);
    expect(elapsed).toBeLessThan(HYDRATION_CEILING_MS);
  }, 120_000);

  it('should keep the rows it hydrated bounded, which is what makes the budget reachable', async () => {
    // Given, the assertion that carries the meaning: TTI on a thousand nodes is only reachable
    // because the document holds sixty rows rather than a thousand, and that is a property of
    // the markup rather than of the machine the test ran on. Hydrated here rather than left over
    // from the test above, which `afterEach` clears: a count of zero would satisfy a ceiling.
    const document_ = largeDocument(NODE_COUNT);
    const nodeId = [...document_.nodes.keys()][500] ?? '';
    const page = await renderPage(document_, { nodeId, markdown });
    document.documentElement.innerHTML = renderHtmlDocument(page, {
      assets: { stylesheets: [], modules: [] },
    });
    hydrateReference();

    // When
    const rows = document.querySelectorAll('.oref-nav-item').length;

    // Then
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThanOrEqual(60);
    expect(document_.nodes.size).toBe(NODE_COUNT);
  }, 120_000);

  it('should keep the heap of one page of the largest corpus document under the ceiling', async () => {
    // Given, a heap is a heap in either runtime, so this number is not a proxy. It is measured
    // over the whole path a client pays for: the state parsed out of the document, the page
    // model held, and the tree hydrated from it. The document is the real large one rather than
    // a synthetic one, because SPEC 20's figure is about a document of that size.
    const document_ = stripe();
    const nodeId = [...document_.nodes.keys()][0] ?? '';
    const page = await renderPage(document_, { nodeId, markdown });

    globalThis.gc?.();
    const before = process.memoryUsage().heapUsed;

    // When
    document.documentElement.innerHTML = renderHtmlDocument(page, {
      assets: { stylesheets: [], modules: [] },
    });
    hydrateReference();
    const after = process.memoryUsage().heapUsed;

    // Then
    expect(document_.schemas.size).toBeGreaterThan(1000);
    expect(after - before).toBeLessThan(MEMORY_CEILING_BYTES);
  }, 300_000);

  it('should carry a page state whose schemas cannot outgrow the bound', () => {
    // Given, the one part of the state that grows with the document rather than with the page.
    const document_ = largeDocument(NODE_COUNT);
    const nodeId = [...document_.nodes.keys()][0] ?? '';

    // When
    const model = buildPageModel(document_, { nodeId, markdown });
    const bytes = JSON.stringify(model.schemas).length;

    // Then
    expect(bytes).toBeLessThanOrEqual(128 * 1024);
  }, 120_000);
});

import { describe, expect, it } from 'vitest';
import { createMemoryRenderCache } from '../../src/cache/infrastructure/adapters/memory-render-cache.adapter';
import { createOpenRefHighlighter } from '../../src/highlight/domain/highlight';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { flattenNavigation, NAV_MAX_ROWS } from '../../src/page/domain/nav-rows';
import type { PageModel } from '../../src/page/domain/page-model';
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
 *
 * THIS BUDGET CATCHES A HANG AND NOT A LATENCY, AND IS LOOSE BY AN ORDER OF MAGNITUDE ON
 * PURPOSE. It measures about 145 ms of its 2000 on a workstation, and that fourteenfold headroom
 * is the design rather than slack waiting to be taken up: what has to fail here is a render that
 * did not finish at all, through a cycle, a wait that should not exist, or a parse that went
 * exponential. It names no machine deliberately. Recording the processor is worth doing where a
 * figure is compared with a previous figure; this one is compared with a ceiling an order of
 * magnitude above anything a sound implementation produces on any machine, and telling a
 * regression from a slow runner is something elapsed time on unfixed hardware cannot do. That
 * was established over six studies on five processors and is why SPEC 20 stopped setting elapsed
 * thresholds; a latency budget written next to that conclusion would contradict it.
 *
 * SPEC 20 says the same, and it is repeated here because the reader of a threshold opens the
 * file and not the specification. The second elapsed bound in this file, on the cached render,
 * is the other one `TX-CLOCK` asks of it and it is stated at its own constant below.
 */
const NODE_COUNT = 1000;
const BUDGET_MS = 2000;

/**
 * Ceiling on the second render of one page, which the cache answers.
 *
 * THIS ONE IS A HANG CATCHER TOO, AND BY A WIDER MARGIN THAN THE ONE ABOVE. It names no machine
 * for the same reason and states the reason here, which is what `TX-CLOCK` asks of every elapsed
 * threshold a committed test enforces. A cache hit is a map read: measured about 0.005 ms of its
 * 200 on a workstation, four orders of magnitude inside.
 *
 * IT IS NOT WHAT PROVES THE CACHE ANSWERED, and that matters more than the number. A cache that
 * silently missed would re-render, which costs about 32 ms on the same machine and passes this
 * bound comfortably. What proves the cache answered is the `hits` and `misses` assertion in the
 * case below. What is left for this bound to catch is a second render that never returned at all.
 */
const CACHED_BUDGET_MS = BUDGET_MS / 10;

describe('prerender budget', () => {
  it('should render a page of a 1000 node document within the budget', async () => {
    // Given
    const document = largeDocument(NODE_COUNT);
    const highlighter = await createOpenRefHighlighter(['json']);
    const markdown = await createMarkdownRenderer({ highlighter });
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
    expect(elapsed).toBeLessThan(CACHED_BUDGET_MS);
  });

  it('should window the navigation in the markup and ship only what it can draw', async () => {
    // Given the two halves of the same rule, one measured in the markup and one in the state.
    // SPEC 11 puts about sixty rows in the document at once, which T012 implements. T012-R2
    // then measured what the state cost and found the whole index in it: 173 KB of a 192 KB
    // page, of which the sidebar could show sixty rows. What must hold now is that the page
    // carries what it draws, and that what it left out is counted rather than lost.
    const document = largeDocument(NODE_COUNT);
    const nodeId = [...document.nodes.keys()][500] ?? '';

    // When
    const page = await renderPage(document, { nodeId });
    const state = JSON.parse(page.stateJson) as PageModel;
    const rows = flattenNavigation(state.navigation);

    // Then
    const links = page.appHtml.match(/<a class="oref-nav-item/g) ?? [];
    expect(links.length).toBeLessThanOrEqual(NAV_MAX_ROWS);

    // The slice is one group and the headers of the rest, which is two orders of magnitude
    // under the document and is the entry the reader is on plus its neighbours.
    expect(rows.length).toBeLessThan(NODE_COUNT / 4);
    expect(rows.some((row) => row.nodeId === nodeId)).toBe(true);

    // And what is missing is stated rather than implied.
    expect(state.navigationComplete).toBe(false);
    expect(state.navigationRows).toBeGreaterThan(NODE_COUNT);
  });
});

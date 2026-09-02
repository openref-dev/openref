// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeOpenApiDocument, parseSpecification } from '@openref/core';
import { afterEach, describe, expect, it } from 'vitest';
import { hydrateReference } from '../../src/browser/index';
import { createOpenRefHighlighter } from '../../src/highlight/domain/highlight';
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

/**
 * The markdown renderer the served page uses, highlighter included.
 *
 * IT WAS BUILT WITHOUT ONE UNTIL TX-SERVED, AND THAT OMISSION WAS 15,692 BYTES. `ReferenceService`
 * always hands `renderPage` a highlighter; this file handed it a renderer built without one, so
 * every fenced block the server tokenises came out here as plain `pre` and `code`. Measured at
 * commit dd18885, the commit the gap was filed on: the same page rendered 49,114 bytes here and
 * 64,806 with the highlighter, against 65,326 served. On today's tree the term is zero, because
 * after TX-FRAME and TX-ADOPT the server rendered markup of an operation page carries no code
 * block at all. Zero today is exactly why it is passed now rather than when it next matters: a
 * quantity that was once fifteen kilobytes must be inside the cheap early warning on the day a
 * sample returns to the first paint, not on the day somebody notices it did.
 */
const markdown = await createMarkdownRenderer({
  highlighter: await createOpenRefHighlighter(['json', 'yaml', 'bash', 'http']),
});

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
 * The served document of the thousand node page, in raw bytes, as THIS harness measures it.
 *
 * RAW RATHER THAN GZIP, alone among the size budgets, and that is the whole point of it. The
 * page this budget was written about was 191,975 raw bytes and 13,534 gzip: the navigation
 * blob compressed to nothing, so every existing budget would have shrugged at it while the
 * browser spent 143 ms of a 150 ms budget parsing it. What costs the reader here is bytes
 * parsed, so bytes parsed is what is bounded.
 *
 * IT IS NOT THE SPEC 20 NUMBER AND IT MEASURES A DIFFERENT QUANTITY, WHICH IS NOW SAID IN BOTH
 * BUDGET LINES. This file used to claim that it and the browser study were "one measurement in
 * two places", and on the old fixture that was nearly true: 28,217 here against 29,682 there,
 * five percent apart. On the representative fixture of T016 the two were 49,114 here and 65,326
 * in Chrome, and TX-SERVED closed the question of what the difference was. It is three things,
 * measured at commit dd18885 by adding one condition at a time to this render: 15,692 bytes of
 * syntax highlighting this harness was not doing, 259 bytes of `basePath` written into every
 * link, and 261 bytes the host brings, being three real hashed stylesheet hrefs against one
 * `/s.css`, the real module href, and the nonce on the state element. 15,692 + 259 + 261 =
 * 16,212, which is the whole gap; the 16,083 recorded before was a subtraction slip. The
 * highlighter is now passed above, so what remains between the two is the host's contribution
 * alone, and `tools/browser-budget/test/integration/served-document-parity.spec.ts` holds it to
 * that position by position rather than as one sum.
 *
 * SO THIS IS AN APPROXIMATION AND IT ALWAYS UNDERSTATES. Every term of the difference is
 * something the host adds and this harness does not, so a served page cannot be lighter than
 * what is measured here; this ceiling is a floor on the reader's cost, never a promise about it.
 * The size of the error is not bounded by anything: it was 616 bytes on the tree that derived
 * this figure and 16,212 on dd18885, from the same check.
 *
 * THE FIGURE FOLLOWS THIS HARNESS DOWN. Derived from its own measurement plus about ten percent,
 * rounded up to the whole KB, which is the rule every other re-derived cap here uses: 54 KB from
 * 49,114 when it was written, 61 KB from 56,355 at TX-MARKUP when the rail rows gained the method
 * badge, and 41 KB now from 37,278, after TX-ADOPT's compact response index and redacted state
 * block took the page down. 61 KB against 37,278 was 67 percent of slack, which is the thing this
 * separate ceiling exists not to be.
 */
const DOCUMENT_CEILING_BYTES = 41 * 1024;

/**
 * How many named schemas of the corpus document get a schema page in the bound case below.
 *
 * BOUNDED BECAUSE THE DOCUMENT HAS 1,440 OF THEM and each page builds a closure; sixty is enough
 * to reach the limit, measured, and is a few seconds rather than a few minutes.
 */
const SCHEMA_PAGE_SAMPLE = 60;

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

  it('should keep the shell the renderer produces, with no host contribution, under its own ceiling', async () => {
    // Given the page SPEC 20 writes both the TTI budget and this one about. This one runs in
    // every CI run and costs a second; the browser study measures what it actually costs a
    // reader. THE TWO ARE TWO QUANTITIES AND THE NAME OF THIS CASE IS THE ONE IT MEASURES: no
    // base path, no asset catalogue and no nonce, all three of which the host adds and the
    // ceiling above accounts for.
    const document_ = largeDocument(NODE_COUNT);
    const nodeId = [...document_.nodes.keys()][500] ?? '';

    // When
    const page = await renderPage(document_, { nodeId, markdown });
    const html = renderHtmlDocument(page, {
      assets: { stylesheets: ['/s.css'], modules: ['/m.js'] },
    });

    // Then
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(DOCUMENT_CEILING_BYTES);
  }, 120_000);

  it('should carry a page state whose schemas cannot outgrow the bound', () => {
    // Given, THE SUBJECT HAS TO BE PRESENT AND IT WAS NOT UNTIL `T065`. This case used to weigh
    // `largeDocument`, whose generated operations have no request body and whose parameters carry
    // inline schemas, so `buildSchemaPayload` got no seed and the payload was `{}`: 2 bytes
    // measured against 131,072, on a document with 1,750 named schemas. A bound with no subject
    // passes whatever the code does. The subject is the real document the rest of this file
    // measures, on a page whose operation takes a body that pulls named schemas in.
    // THE PAGE THAT CARRIES ONE IS THE SCHEMA PAGE, WHICH IS ALSO A FACT WORTH RECORDING. The
    // payload is seeded from the parameter and request body slots of the page, and every one of
    // this document's 589 operations has a request body whose schema is written inline with no
    // `$ref` in it, so `seedsOf` yields nothing and a node page of it legitimately ships `{}`.
    // Measured: all 589 node pages weigh 2 bytes. A schema page seeds from the named schema
    // itself, so that is where the closure grows and where the bound binds.
    const document_ = stripe();
    const sampled = [...document_.schemas.keys()].slice(0, SCHEMA_PAGE_SAMPLE);
    let heaviest = { id: '', bytes: 0, keys: 0 };

    // When
    for (const schemaId of sampled) {
      const model = buildPageModel(document_, { page: 'schema', schemaId, markdown });
      const bytes = JSON.stringify(model.schemas).length;
      if (bytes > heaviest.bytes) {
        heaviest = { id: schemaId, bytes, keys: Object.keys(model.schemas).length };
      }
    }

    // Then, the payload is really there on the page it is heaviest on, it is large enough for the
    // bound to be the thing that stopped it, and it is under the bound. The builder truncates at
    // the limit rather than overshooting it, which is what the last two assertions together say.
    expect(sampled.length).toBe(SCHEMA_PAGE_SAMPLE);
    expect(heaviest.keys).toBeGreaterThan(0);
    expect(heaviest.bytes).toBeGreaterThan(64 * 1024);
    expect(heaviest.bytes).toBeLessThanOrEqual(128 * 1024);
  }, 180_000);
});

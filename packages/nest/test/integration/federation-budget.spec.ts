import { gzipSync } from 'node:zlib';
import { mergeDocuments } from '@openref/federation';
import { createMarkdownRenderer, renderPage } from '@openref/render';
import { buildSearchIndex } from '@openref/search';
import type { IRDocument } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { largeDocument } from '../../../render/test/mocks/documents';

/**
 * The SPEC 20 budgets re-checked on a merged document three times the size, which is what `T047`
 * asks of the M4 gates.
 *
 * EVERY SIZE BUDGET IN SPEC 20 IS STATED FOR A THOUSAND NODES, and federation is the first thing
 * this project builds that hands a reader a document nobody wrote: three services of a thousand
 * nodes each is one page of three thousand. The budgets do not move for it, because a budget is
 * about the input it names. What has to hold instead is that the merged document costs three
 * times a thousand nodes rather than something worse, and that is the property here: each
 * quantity is checked against three times its own row, so a per node cost that grows with the
 * number of services fails while an honest tripling passes.
 *
 * THE INPUT IS THE SAME FIXTURE THE BUDGETS THEMSELVES ARE TAKEN ON, `largeDocument`, so the
 * comparison is with the recorded figures rather than with a document invented here. The three
 * services carry the same generated material under three service ids, which is one real shape of
 * a federation, three deployments of one service, and it is the input that exercises the merge
 * hardest: every schema name and every address collides across all three.
 *
 * WHAT "THREE TIMES THE SIZE" MEANS HERE IS THE UNIT SPEC 20 COUNTS IN, WHICH IS NODES, and the
 * cases below state the rest of the composition rather than leave it to be assumed. Measured
 * 2026-08-28: 3000 nodes against 1000, 1750 schemas against 1750 because three copies of one
 * model are one model and the merge deduplicates them, and 4750 index records against 2750. The
 * index is 380,623 bytes gzip and 2,108,610 raw against 177,080 and 946,269 for one service, and
 * the page prerenders in about 30 ms of the 6000 three rows allow.
 *
 * WHAT IS NOT HERE, AND WHY. The browser side budgets of SPEC 20, TTI, main thread work and the
 * served document, are measured in a real browser by `tools/browser-budget` against a served page,
 * and a federated mount serves the same page from the same renderer over the merged document. They
 * are not re-derived here because nothing in this file could measure them honestly; what this file
 * can measure is what the server produces, which is where a federated document differs at all.
 */

/** Nodes per service, which is the size every SPEC 20 row is stated for. */
const NODES_PER_SERVICE = 1000;

/** Services in the federation, and therefore the multiple every budget is allowed. */
const SERVICES = 3;

/** SPEC 20: the search index of 1000 nodes is at most 250 KB gzip. */
const SEARCH_INDEX_GZIP = 250 * 1024;

/** SPEC 20: and at most 1 MB of raw bytes, which is the cap that binds. */
const SEARCH_INDEX_RAW = 1024 * 1024;

/**
 * SPEC 20: a page of a 1000 node document prerenders in at most 2 seconds, once per hash.
 *
 * IT IS A HANG CATCHER RATHER THAN A LATENCY BUDGET, exactly as the row itself and
 * `prerender-budget.spec.ts` both say, and naming no machine is deliberate for the reason SPEC 20
 * records about elapsed thresholds on hardware nobody pinned. What it has to catch here is a merge
 * or a navigation whose cost stops being linear in the number of services.
 */
const PRERENDER_MS = 2000;

/** The merged document of three thousand nodes, built once for the file. */
function federated(): IRDocument {
  const service = largeDocument(NODES_PER_SERVICE);
  const { document } = mergeDocuments(
    ['alpha', 'beta', 'gamma'].map((id) => ({ id, document: service, prefix: `/${id}` })),
    { id: 'platform', info: { title: 'Platform', version: '2026.8' } },
  );
  return document;
}

describe('the SPEC 20 budgets on a merged document three times the size', () => {
  it('should merge three thousand node services into one document of three thousand nodes', () => {
    // Given three services of a thousand nodes each, under one id space
    // When they are merged
    const document = federated();

    // Then nothing was lost and nothing was invented: three thousand nodes, three services
    expect(document.nodes.size).toBe(NODES_PER_SERVICE * SERVICES);
    expect(document.services?.length).toBe(SERVICES);
    expect(document.navigation.length).toBe(SERVICES);

    // And the schema half is one model rather than three, which is the merge deduplicating three
    // copies of one service and is stated here so the sizes below are read for what they are
    expect(document.schemas.size).toBe(largeDocument(NODES_PER_SERVICE).schemas.size);
  }, 60_000);

  it('should keep the search index of the merged document inside three times its row', () => {
    // Given the merged document
    const document = federated();

    // When its index is built the way the mount serves it
    const index = buildSearchIndex(document);
    const raw = Buffer.byteLength(index.serialized, 'utf8');
    const transfer = gzipSync(Buffer.from(index.serialized, 'utf8')).byteLength;

    // Then the index really covers all three services, so the sizes below are of the whole page
    expect(index.documentCount).toBeGreaterThan(NODES_PER_SERVICE * SERVICES);
    expect(index.serialized).toContain('alpha_');
    expect(index.serialized).toContain('gamma_');

    // And both SPEC 20 caps hold at three times the thousand node figure they are stated for
    expect(transfer).toBeLessThan(SEARCH_INDEX_GZIP * SERVICES);
    expect(raw).toBeLessThan(SEARCH_INDEX_RAW * SERVICES);
  }, 60_000);

  it('should prerender a page of the merged document inside three times its row', async () => {
    // Given the merged document and the renderer a mount uses
    const document = federated();
    const markdown = await createMarkdownRenderer({});
    const nodeId = [...document.nodes.keys()][0] ?? '';

    // When one page is rendered, navigation over three thousand nodes included
    const started = performance.now();
    const page = await renderPage(document, { nodeId, markdown });
    const elapsed = performance.now() - started;

    // Then the page really is the federated one, so the time below is of this work
    expect(page.appHtml).toContain('oref-nav');
    expect(nodeId.startsWith('alpha_')).toBe(true);

    // And it is inside three times the row stated for a thousand nodes
    expect(elapsed).toBeLessThan(PRERENDER_MS * SERVICES);
  }, 60_000);
});

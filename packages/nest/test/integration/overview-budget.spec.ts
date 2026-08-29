import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeAsyncApiDocument, parseSpecification, type IRDocument } from '@openref/core';
import { mergeDocuments } from '@openref/federation';
import {
  buildPageModel,
  createMarkdownRenderer,
  createOpenRefHighlighter,
  renderHtmlDocument,
  renderPage,
} from '@openref/render';
import { describe, expect, it } from 'vitest';

/**
 * The SPEC 20 cap on the overview page, over the document that cap was derived from.
 *
 * WHY THIS FILE IS IN `@openref/nest`. The deriving document is a federation, whose only producer
 * is `mergeDocuments` in `@openref/federation`, and drawing it is `@openref/render`, which per
 * STANDARDS 3.5 may reach `core` and `vue` and nothing else. `nest` is the first package allowed
 * to see both, which is the reason `mixed-page.spec.ts` gives for living here as well.
 *
 * WHAT THE CAP IS ABOUT. SPEC 9.5.1 measured the topology section at 346.1 bytes an edge and said
 * in the same paragraph that no recorded threshold has the overview page as its subject: the
 * browser study loads an operation page, and both `served-document` figures are stated for the
 * 1000 node fixture and promise nothing about another document. A page nothing weighs grows until
 * somebody notices, so SPEC 20 now carries a row for it and this is what would go red.
 *
 * THE INPUT IS THE EVENT CORPUS AND NOT A NUMBER SOMEBODY PICKED, which is why the counts below
 * are asserted by exact equality before a single byte is weighed. One document cannot be the
 * input, because the section exists for a composition of services: the largest event document of
 * the corpus carries 25 edges. The upper shape the EVENT corpus gives is every event document it
 * holds, federated into one estate. A corpus that gains a document moves this input, and the
 * failure of the equalities below is the notice that the cap has to be re-derived from the new
 * measurement rather than quietly inherited.
 *
 * IT IS NOT THE UPPER SHAPE OF THE WHOLE CORPUS. All 40 corpus documents federate to 95 edges,
 * 1,310 nodes, 2,582 schemas and an overview page of 77,328 bytes, over this cap by 6,672, and
 * almost none of that growth is the graph. That measurement and the question it leaves open are
 * recorded in SPEC 9.5.1 for the maintainer; nothing here is scoped to it, and this suite is
 * deliberately not the place where a cap somebody has not ruled on would go red.
 */

/** The event corpus, whose every document is one service of the deriving estate. */
const EVENT_DOCUMENTS = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'core',
  'test',
  'events-corpus',
  'documents',
);

/**
 * The shape of the deriving document, measured rather than chosen, per SPEC 20.
 *
 * Each of these is an exact equality in the cases below. A band would let the input drift back to
 * something cheaper one edit at a time with nothing going red, which is the reason SPEC 20 gives
 * for holding the 1000 node fixture to exact figures rather than to ranges.
 */
const SERVICES = 23;
const EDGES = 91;
const GROUPS = 64;

/**
 * SPEC 20: the overview page of the deriving federation, raw bytes, as the renderer produces it.
 *
 * DERIVED FROM ITS OWN MEASUREMENT BY THE STANDING RULE, which SPEC 9.5.1 names for this page in
 * so many words: the measurement plus ten percent, up to the whole KB. Measured 63,951 bytes, of
 * which 18,159 is the same page with an empty edge list and 45,792 is the section, which is 503.2
 * bytes an edge. 69 KB is 70,656 and leaves 6,705, so thirteen more rows of this page fit at
 * 70,493 and fourteen do not at 70,996, and a service the size of the corpus's largest event
 * document reads 76,531 and fails.
 *
 * IT BOUNDS THE RENDERER'S SHELL AND NOT THE DOCUMENT A HOST ASSEMBLES, which is the same quantity
 * as the jsdom half of `served-document` and carries the same known direction of error: every term
 * of the difference is something a host adds and this harness does not, so the served page cannot
 * be lighter than what is weighed here and this ceiling is a floor on the reader's cost rather
 * than a promise about it.
 */
const OVERVIEW_CEILING_BYTES = 69 * 1024;

/**
 * The markdown renderer the served page uses, highlighter included.
 *
 * The same one `client-cost.spec.ts` builds, and for the reason stated there: `ReferenceService`
 * always hands `renderPage` a highlighter, so a harness that omits it weighs a page the host does
 * not serve. SPEC 9.5.1 took its own figures through this path.
 */
const markdown = await createMarkdownRenderer({
  highlighter: await createOpenRefHighlighter(['json', 'yaml', 'bash', 'http']),
});

/** Every event corpus document, normalized, in the order the directory names them. */
function services(): { readonly id: string; readonly document: IRDocument }[] {
  return readdirSync(EVENT_DOCUMENTS)
    .sort()
    .map((file) => ({
      id: file.replace(/\.(ya?ml)$/, ''),
      document: normalizeAsyncApiDocument(
        parseSpecification(readFileSync(join(EVENT_DOCUMENTS, file), 'utf8')),
      ),
    }));
}

/** The deriving document: the whole event corpus federated into one estate. */
function estate(): IRDocument {
  return mergeDocuments(services(), {
    id: 'estate',
    info: { title: 'Estate', version: '2026.8' },
  }).document;
}

describe('the overview page of the deriving federation', () => {
  it('should be the composition SPEC 20 derived the cap from, by exact count', () => {
    // Given every event document of the corpus
    const sources = services();

    // When they are federated into one estate
    const document = estate();
    const model = buildPageModel(document, { markdown });

    // Then the input is the one the derivation names, in services, in edges and in the groups the
    // section draws them under. A corpus that gained or lost a document lands here rather than in
    // the byte assertion below, where it would read as the page having grown
    expect(sources).toHaveLength(SERVICES);
    expect(document.relationships).toHaveLength(EDGES);
    expect(model.topology?.edgeCount).toBe(EDGES);
    expect(model.topology?.groups).toHaveLength(GROUPS);
  });

  it('should draw the topology section, which is what makes the weight below mean anything', async () => {
    // Given the deriving document
    const document = estate();

    // When the overview page is rendered the way a host serves it
    const page = await renderPage(document, { markdown });

    // Then the section really is in the markup, with one row per edge and no group dropped: a
    // ceiling over a page that stopped drawing the graph would be a ceiling over nothing
    const rows = page.appHtml.split('class="oref-topology-edge"').length - 1;
    const groups = page.appHtml.split('class="oref-topology-node"').length - 1;

    expect(page.appHtml).toContain('oref-section-topology');
    expect(rows).toBe(EDGES);
    expect(groups).toBe(GROUPS);
  });

  it('should keep the shell the renderer produces under the SPEC 20 overview cap', async () => {
    // Given the deriving document and the serving path SPEC 9.5.1 measured on: one stylesheet,
    // one module, and no base path, asset catalogue or nonce, all three of which a host adds
    const document = estate();

    // When
    const page = await renderPage(document, { markdown });
    const html = renderHtmlDocument(page, {
      assets: { stylesheets: ['/s.css'], modules: ['/m.js'] },
    });

    // Then
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(OVERVIEW_CEILING_BYTES);
  }, 120_000);
});

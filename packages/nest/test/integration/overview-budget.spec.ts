import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeSpecification, parseSpecification, type IRDocument } from '@openref/core';
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
 * THE INPUT IS THE WHOLE CORPUS AND NOT A NUMBER SOMEBODY PICKED, which is why the counts below
 * are asserted by exact equality before a single byte is weighed. One document cannot be the
 * input, because the section exists for a composition of services: the largest event document of
 * the corpus carries 25 edges. The upper shape the corpus gives is every document it holds, both
 * families, federated into one estate. A corpus that gains a document moves this input, and the
 * failure of the equalities below is the notice that the cap has to be re-derived from the new
 * measurement rather than quietly inherited.
 *
 * THE FIRST EDITION OF THE ROW TOOK THE EVENT HALF ALONE, 23 documents and 91 edges, and measured
 * 63,951 bytes for a cap of 69 KB. The forty document estate read 77,328, over that cap by 6,672,
 * and almost none of the difference was the graph: four more edges took the section from 45,792 to
 * 48,046 while the page with no edges at all went from 18,159 to 29,282. That is a cap derived on a
 * document an order smaller measuring something other than what it was set for, so the maintainer
 * re-derived it here on 2026-08-30 by the standing rule. A bounded view of the overview page was
 * refused in the same ruling, and the reason is the rule itself: choosing a product shape under
 * budget pressure is the move this project forbids. SPEC 9.5.1 carries both halves of that record.
 */

/** Both corpus directories, whose every document is one service of the deriving estate. */
const CORE_TEST = join(import.meta.dirname, '..', '..', '..', 'core', 'test');

/**
 * The shape of the deriving document, measured rather than chosen, per SPEC 20.
 *
 * Each of these is an exact equality in the cases below. A band would let the input drift back to
 * something cheaper one edit at a time with nothing going red, which is the reason SPEC 20 gives
 * for holding the 1000 node fixture to exact figures rather than to ranges.
 */
const SERVICES = 40;
const EDGES = 95;
const GROUPS = 68;
const NODES = 1310;
const SCHEMAS = 2582;

/**
 * SPEC 20: the overview page of the deriving federation, raw bytes, as the renderer produces it.
 *
 * DERIVED FROM ITS OWN MEASUREMENT BY THE STANDING RULE, which SPEC 9.5.1 names for this page in
 * so many words: the measurement plus ten percent, up to the whole KB. Measured 77,328 bytes, of
 * which 29,282 is the same page with an empty edge list and 48,046 is the section, which is 505.7
 * bytes an edge. 77,328 plus ten percent is 85,060.8, so the cap is 84 KB, which is 86,016 and
 * leaves 8,688. Seventeen more rows of this page fit at 85,926 and eighteen do not at 86,431.
 *
 * AND THE SERVICE SIZED GROWTH IS A MEASUREMENT RATHER THAN AN EXTRAPOLATION: the same estate with
 * a second copy of the corpus's largest event document, at the copy id `everest-system-api-two`,
 * reads 41 services, 120 edges and 89,647 bytes, section 59,959 and base page 29,688, so it fails
 * this cap. The copy id is named because the figure depends on its length, 88,239 + 64 x len, and
 * the cap fails at every length since even an empty id reads 88,239. An estate that grew by a whole
 * event service is re-derived with a figure attached rather than passing in silence.
 *
 * IT BOUNDS THE RENDERER'S SHELL AND NOT THE DOCUMENT A HOST ASSEMBLES, which is the same quantity
 * as the jsdom half of `served-document` and carries the same known direction of error: every term
 * of the difference is something a host adds and this harness does not, so the served page cannot
 * be lighter than what is weighed here and this ceiling is a floor on the reader's cost rather
 * than a promise about it.
 */
const OVERVIEW_CEILING_BYTES = 84 * 1024;

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

/**
 * Every document of one corpus family, read as a service of the estate.
 *
 * THE SERVICE ID IS THE FILE NAME, sanitized to the alphabet SPEC 15 allows an id, because the id
 * is prefixed onto every node id and therefore onto both ends of every topology row: a shorter or
 * a longer spelling of the same forty documents is a different number of bytes. The measurement in
 * SPEC 20 was taken through exactly this derivation.
 *
 * @param family - Which corpus directory to read
 * @returns One service per document, in the order the directory names them
 */
function corpusServices(
  family: 'corpus' | 'events-corpus',
): { readonly id: string; readonly document: IRDocument }[] {
  const directory = join(CORE_TEST, family, 'documents');

  return readdirSync(directory)
    .sort()
    .map((name) => ({
      id: name
        .replace(/\.(ya?ml|json)$/, '')
        .replace(/[^a-z0-9-]/gi, '-')
        .toLowerCase(),
      document: normalizeSpecification(
        parseSpecification(readFileSync(join(directory, name), 'utf8')),
        { documentId: name },
      ),
    }));
}

/** The deriving estate and the services it was built from, built on the first case that asks. */
interface Deriving {
  readonly sources: readonly { readonly id: string; readonly document: IRDocument }[];
  readonly document: IRDocument;
}

let built: Deriving | undefined;

/**
 * The deriving document: the whole corpus federated into one estate.
 *
 * BUILT ONCE AND LAZILY, which is a cost decision with a measurement behind it and not a style
 * one. Reading and merging the corpus four times bought four copies of the figures SPEC 15.1
 * records, 3,275 ms of instrumented normalization and 2,566 ms of instrumented merge, and answered
 * no question one read leaves open. It stays lazy rather than moving to module scope on purpose:
 * work at module scope is not covered by any timeout a case declares, so the sanctioned hang
 * catcher below would stop reaching the only expensive thing in the file. Nothing here writes to
 * the documents, and the one case that needs a different edge list copies rather than mutates.
 *
 * @returns The estate and the services it federates, the same objects on every call
 */
function deriving(): Deriving {
  if (built === undefined) {
    const sources = [...corpusServices('events-corpus'), ...corpusServices('corpus')];
    const { document } = mergeDocuments(sources, {
      id: 'estate',
      info: { title: 'Estate', version: '2026.8' },
    });
    built = { sources, document };
  }

  return built;
}

/**
 * THE TIMEOUTS BELOW ARE HANG CATCHERS AND NOT BUDGETS, per F25, and they are declared because
 * this file is the class F25 names rather than the class vitest's default was chosen for. MEASURED
 * under V8 coverage instrumentation, which is the run the coverage gate makes: SPEC 15.1 records
 * normalizing the seventeen HTTP corpus documents at 3,275 ms and merging all forty at 2,566 ms,
 * which is why a merged forty document case was dropped from the federation suite once already
 * rather than have a timeout raised for it. Here the read and the merge are paid once, by whichever
 * case runs first: measured on this file, that case costs 6,282 ms and the other three cost 26 ms
 * between them, so exactly one case is past vitest's 5,000 ms default and the cap it declares is
 * the only thing standing between the coverage run and a red gate on code nobody touched. Raising a
 * timeout to fit a measurement would be tuning the instrument to the reading; declaring a generous
 * hang catcher is not, because nothing here is tuned against the number and an ordinary case timing
 * out still means exactly what it used to mean.
 */
const HANG_CATCHER_MS = 60_000;

describe('the overview page of the deriving federation', () => {
  it(
    'should be the composition SPEC 20 derived the cap from, by exact count',
    () => {
      // Given every corpus document, both families, federated into one estate
      const { sources, document } = deriving();

      // When the page model behind the overview page is built over it
      const model = buildPageModel(document, { markdown });

      // Then the input is the one the derivation names, in services, in edges, in the groups the
      // section draws them under, and in the two counts the base page charges for. A corpus that
      // gained or lost a document lands here rather than in the byte assertion below, where it would
      // read as the page having grown
      expect(sources).toHaveLength(SERVICES);
      expect(document.relationships).toHaveLength(EDGES);
      expect(model.topology?.edgeCount).toBe(EDGES);
      expect(model.topology?.groups).toHaveLength(GROUPS);
      expect(document.nodes.size).toBe(NODES);
      expect(document.schemas.size).toBe(SCHEMAS);
    },
    HANG_CATCHER_MS,
  );

  it(
    'should draw the topology section, which is what makes the weight below mean anything',
    async () => {
      // Given the deriving document
      const { document } = deriving();

      // When the overview page is rendered the way a host serves it
      const page = await renderPage(document, { markdown });

      // Then the section really is in the markup, with one row per edge and no group dropped: a
      // ceiling over a page that stopped drawing the graph would be a ceiling over nothing
      const rows = page.appHtml.split('class="oref-topology-edge"').length - 1;
      const groups = page.appHtml.split('class="oref-topology-node"').length - 1;

      expect(page.appHtml).toContain('oref-section-topology');
      expect(rows).toBe(EDGES);
      expect(groups).toBe(GROUPS);
    },
    HANG_CATCHER_MS,
  );

  it(
    'should keep the shell the renderer produces under the SPEC 20 overview cap',
    async () => {
      // Given the deriving document and the serving path SPEC 9.5.1 measured on: one stylesheet,
      // one module, and no base path, asset catalogue or nonce, all three of which a host adds
      const { document } = deriving();

      // When
      const page = await renderPage(document, { markdown });
      const html = renderHtmlDocument(page, {
        assets: { stylesheets: ['/s.css'], modules: ['/m.js'] },
      });

      // Then
      expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(OVERVIEW_CEILING_BYTES);
    },
    HANG_CATCHER_MS,
  );

  it(
    'should charge the base page per service rather than per node, which is what moved the cap',
    async () => {
      // Given the deriving document with its edge list emptied, which is the base page SPEC 20
      // itemises the re-derivation against: 29,282 of the 77,328, against 18,159 for the event half
      const { document } = deriving();

      // When the same page is weighed with no graph on it at all
      const page = await renderPage({ ...document, relationships: [] }, { markdown });
      const html = renderHtmlDocument(page, {
        assets: { stylesheets: ['/s.css'], modules: ['/m.js'] },
      });

      // Then the rail carries one entry per service and not one per node, which is the reading SPEC
      // 9.5.1 records for what "document scale" means on this page: the estate holds 1,310 nodes and
      // the base page draws 40 rows. A rail that started listing nodes would be a different page and
      // would land here rather than only in the byte assertion above
      const entries = html.split('class="oref-nav-entry oref-nav-entry-service"').length - 1;

      expect(document.nodes.size).toBe(NODES);
      expect(entries).toBe(SERVICES);
    },
    HANG_CATCHER_MS,
  );
});

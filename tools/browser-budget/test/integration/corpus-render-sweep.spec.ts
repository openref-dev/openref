import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizeAsyncApiDocument,
  normalizeOpenApiDocument,
  parseSpecification,
  type IRDocument,
} from '@openref/core';
import { mergeDocuments } from '@openref/federation';
import {
  createMarkdownRenderer,
  renderHtmlDocument,
  renderPage,
  type PageKind,
} from '@openref/render';
import { defaultTheme } from '@openref/theme';
import { beforeAll, describe, expect, it } from 'vitest';
import { scanForCspViolations } from '../../../gates/src/lib/csp.ts';

/**
 * Every page kind of every corpus document, rendered by the product and scanned, per `T065`.
 *
 * WHY IT EXISTS. The `csp` gate's roots are `packages/<name>/dist`, which holds no `.html`, so the
 * rule for a rendered page had never been applied to one until `T063` built the documentation site
 * and found the scan and the browser disagreeing. What that left open is what the scan says about
 * the pages the PRODUCT renders, rather than the one page a documentation build happens to write.
 * Until this file the answer was a script that printed totals and exited zero whatever it found,
 * which is not evidence of anything, and the reading it produced is withdrawn in favour of this.
 *
 * WHY IT LIVES IN `tools/` AND NOT IN A PACKAGE. It needs the scanner, the renderer, a theme, the
 * merge engine and both normalizers at once, and no package in this workspace may see that set:
 * STANDARDS 3.5 puts `@openref/theme-telltale` above `@openref/nest` and `@openref/theme` beside
 * it, so a package hosting this would need a new edge, which is a layout decision and not a test's
 * to take.
 *
 * WHAT IT DOES NOT COVER, SAID RATHER THAN LEFT TO BE INFERRED. One theme. The second shipped theme
 * cannot be reached from here for the same reason, and what it has instead is
 * `packages/theme-telltale/test/integration/theme-boundary.spec.ts`.
 *
 * WHY NO NONCE IS PASSED. With a nonce on every script element the `inline-script-element` rule
 * short circuits on the nonce and never reads a `type`, so a sweep that always passed one would be
 * silent about the data block rule it is cited as covering. These pages are rendered the way
 * `openref build` writes them, with no nonce, and the two data block elements are asserted PRESENT
 * before any violation count is read.
 */

const CORE_TEST = join(import.meta.dirname, '..', '..', '..', '..', 'packages', 'core', 'test');
const HTTP_DOCUMENTS = join(CORE_TEST, 'corpus', 'documents');
const EVENT_DOCUMENTS = join(CORE_TEST, 'events-corpus', 'documents');

/**
 * Every member of `PageKind`, bound to the type in both directions.
 *
 * A HAND LIST IS WHAT THE FIRST FORM OF THIS FILE HAD, AND IT WAS THE CLAIM THAT WAS FALSE RATHER
 * THAN THE UNION. `covered` below is derived by iterating this list, so a list that had drifted
 * from `PageKind` would report itself complete: measured, a ninth member added to `PageKind` left
 * this suite 3 of 3 green while claiming to check the union. The pair below is the idiom
 * `SLOT_NAMES` and `SLOT_NAMES_ARE_COMPLETE` already use in `@openref/vue`, for the same reason
 * and in the same two directions. `satisfies` catches a name that is not a page kind; the type
 * beside it catches a page kind that is not named, which is the direction that would otherwise
 * ship a page nothing in this sweep ever renders.
 */
const PAGE_KINDS = [
  'overview',
  'node',
  'schema',
  'bench',
  'health',
  'shapes',
  'states',
  'service',
] as const satisfies readonly PageKind[];

/** Compile time proof that {@link PAGE_KINDS} lists every member of `PageKind`. */
type PAGE_KINDS_ARE_COMPLETE = PageKind extends (typeof PAGE_KINDS)[number] ? true : never;

interface Rendered {
  readonly html: string;
  readonly document: string;
  readonly page: string;
}

let pages: Rendered[] = [];

beforeAll(async () => {
  const load = (directory: string, normalize: (parsed: unknown) => IRDocument): IRDocument[] =>
    readdirSync(directory)
      .sort()
      .map((file) => normalize(parseSpecification(readFileSync(join(directory, file), 'utf8'))));

  const corpus = [
    ...load(HTTP_DOCUMENTS, (parsed) => normalizeOpenApiDocument(parsed)),
    ...load(EVENT_DOCUMENTS, (parsed) => normalizeAsyncApiDocument(parsed)),
  ];
  const estate = mergeDocuments(
    corpus.map((document, index) => ({ id: `s${String(index)}`, document })),
    { id: 'estate', info: { title: 'Estate', version: '1' } },
  ).document;

  const markdown = await createMarkdownRenderer();
  const rendered: Rendered[] = [];

  for (const document of [...corpus, estate]) {
    const nodeId = [...document.nodes.keys()][0] ?? null;
    const schemaId = [...document.schemas.keys()][0] ?? null;
    const serviceId = document === estate ? (document.services?.[0]?.id ?? null) : null;

    for (const page of PAGE_KINDS) {
      if ((page === 'node' || page === 'bench') && nodeId === null) continue;
      if ((page === 'schema' || page === 'shapes') && schemaId === null) continue;
      if (page === 'service' && serviceId === null) continue;

      const built = await renderPage(document, {
        basePath: '/docs',
        theme: defaultTheme,
        markdown,
        page,
        nodeId,
        schemaId,
        serviceId,
      });

      // ONE PAGE PER DOCUMENT CARRIES STRUCTURED DATA, and it is the overview, because that is
      // where a host writes it. Without it the `application/ld+json` spelling of the data block
      // rule is never reached by this sweep at all, which is how the first form of this file
      // passed while covering one of the two spellings it is cited for.
      const head =
        page === 'overview'
          ? { jsonLd: '{"@context":"https://schema.org","@type":"WebSite","name":"Corpus"}' }
          : undefined;

      rendered.push({
        html: renderHtmlDocument(built, head === undefined ? undefined : { head }),
        document: document.id,
        page,
      });
    }
  }

  pages = rendered;
}, 900_000);

describe('every page kind of every corpus document, rendered by the product', () => {
  it('should cover every member of PageKind, so this is the union and not a sample', () => {
    // Given, the list is the union by construction and not by inspection: this assignment does not
    // compile when `PageKind` gains a member `PAGE_KINDS` does not carry, which is the half a
    // runtime check over a hand list can never have.
    const complete: PAGE_KINDS_ARE_COMPLETE = true;

    // When
    const covered = [...new Set(pages.map((page) => page.page))].sort();

    // Then, the type level half first
    expect(complete).toBe(true);

    // Then, all eight, at a scale that is the corpus rather than one document
    expect(covered).toEqual([...PAGE_KINDS].sort());
    expect(pages.length).toBeGreaterThan(200);
    expect(new Set(pages.map((page) => page.document)).size).toBeGreaterThan(30);
  });

  it('should carry both data block script elements and no nonce, before anything else is read', () => {
    // Given, without this the zero below is the zero of pages with no script elements at all, and
    // the data block rule the count is cited as covering would never be reached.
    const withState = pages.filter((page) =>
      page.html.includes('<script type="application/json" id="oref-state">'),
    );
    const withLinkedData = pages.filter((page) =>
      page.html.includes('<script type="application/ld+json">'),
    );

    // Then
    expect(withState.length).toBe(pages.length);
    expect(withLinkedData.length).toBeGreaterThan(0);
    expect(pages.filter((page) => page.html.includes('nonce='))).toEqual([]);
  });

  it('should produce no construct a strict policy would refuse, on any of them', () => {
    // Given / When
    const offending = pages.flatMap((page) =>
      scanForCspViolations(page.html).map(
        (violation) => `${page.document} ${page.page}: ${violation.rule} ${violation.excerpt}`,
      ),
    );

    // Then
    expect(offending).toEqual([]);
  });
});

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeOpenApiDocument, parseSpecification, type IRDocument } from '@openref/core';
import { describe, expect, it } from 'vitest';
import telltale from '../../src/theme';
import { createMarkdownRenderer } from '../../../render/src/markdown/domain/markdown';
import { renderPage } from '../../../render/src/render/application/services/render.service';

/**
 * Both themes over every vendored specification, per T032's own definition of done.
 *
 * WHY BOTH AND NOT ONLY THE NEW ONE. The question is not whether telltale survives seventeen real
 * documents; it is whether the two themes survive the same seventeen, because a document that
 * breaks one and not the other is a document that found a position where the contract is a
 * different shape for each of them. The reference is rendered with no theme, which is the L0 case,
 * and telltale is rendered with all 21 positions replaced.
 *
 * WHAT COUNTS AS SURVIVING IS SPELT OUT RATHER THAN LEFT TO "IT DID NOT THROW". A page that
 * rendered to the empty string does not throw either. Each page has to carry the root the client
 * hydrates on, this theme's own frame, and more bytes than an empty frame would produce.
 *
 * NOTHING IS SAMPLED AND NOTHING IS CAPPED. Every document in the corpus is rendered on three
 * pages: the overview, the first node, and the first named schema. A run that quietly skipped the
 * documents with no nodes would be reporting on a smaller corpus than the one it named.
 */

const CORPUS = join(import.meta.dirname, '..', '..', '..', 'core', 'test', 'corpus', 'documents');
const markdown = await createMarkdownRenderer();

const FILES = readdirSync(CORPUS)
  .filter((name) => /\.(json|ya?ml)$/.test(name))
  .sort();

function documentOf(file: string): IRDocument {
  return normalizeOpenApiDocument(
    parseSpecification(readFileSync(join(CORPUS, file), 'utf8'), { source: file }),
  );
}

/** Every page of one document, under one theme, with what each one has to satisfy. */
async function pagesOf(document: IRDocument, themed: boolean): Promise<readonly string[]> {
  const theme = themed ? telltale : undefined;
  const firstNode = [...document.nodes.keys()][0] ?? null;
  const firstSchema = [...document.schemas.keys()][0] ?? null;

  const rendered = await Promise.all([
    renderPage(document, { markdown, ...(theme === undefined ? {} : { theme }) }),
    renderPage(document, {
      nodeId: firstNode,
      markdown,
      ...(theme === undefined ? {} : { theme }),
    }),
    renderPage(document, {
      schemaId: firstSchema,
      markdown,
      ...(theme === undefined ? {} : { theme }),
    }),
  ]);

  return rendered.map((page) => page.appHtml);
}

/**
 * The hang catcher the rendering cases declare, because their cost is the corpus.
 *
 * F25, AND THE CLASS IS THE ONE `vitest.spawn-timeout.ts` NAMES rather than the class vitest's
 * five second default was chosen for. What these cases spend is reading, parsing and normalizing
 * real published specifications, `stripe.yaml` at 6 MB among them, before this theme draws
 * anything at all. That is the subject's input and not the subject: `packages/core` records the
 * seventeen HTTP corpus documents at 3,275 ms of instrumented normalization on their own, and the
 * assertion each case then makes is a substring test over the markup.
 *
 * MEASURED ON THE RUNNER, WHICH IS THE ONLY INSTRUMENT THAT COUNTS HERE. Nine coverage runs on
 * 2026-09-03, on the four vCPU `ubuntu-latest` runner under V8 instrumentation, over Node 22.22.2
 * and Node 24, spread across an AMD EPYC 7763, an EPYC 9V45 and an EPYC 9V74 as the pool handed
 * them out. `should draw this theme own frame` measured 8,309 to 13,557 ms and the `stripe.yaml`
 * member of the loop measured 4,835 to 9,223 ms. The same two cases measure 3,508 and 2,383 ms on
 * an Apple M3 Ultra workstation, comfortably inside the default, which is why this suite was green
 * for a whole run of commits that never reached CI and red the first time it did. The workstation
 * figures are here for contrast and are not what this number is derived from.
 *
 * THE MARGIN IS THE ONE THE PROJECT ALREADY USES, an order of magnitude over the measured maximum,
 * rounded to the value this repository already carries for this class. 13,557 ms times ten is
 * 135,570, and `packages/render/test/integration/corpus-navigation.spec.ts` carries 180,000 for
 * the same corpus, under the same instrumentation, after the same failure. Adopting it lowers no
 * bound anybody had already found they needed, which is the property `vitest.spawn-timeout.ts`
 * asks of one number for a whole class.
 *
 * NOTHING HERE IS TUNED AGAINST THIS NUMBER AND NOTHING SHOULD BE. It is a hang catcher, not a
 * budget: what has to fail against it is a render that never returned. An ordinary case timing out
 * still means exactly what it always meant, which is the property a raised global default would
 * have destroyed, so the global default does not move.
 */
const CORPUS_HANG_CATCHER_MS = 180_000;

describe('the whole corpus, under both themes', () => {
  it('should have found the corpus at all, before anything is asserted about it', () => {
    // Given, a sweep that found nothing reports the same clean line as a sweep that found nothing
    // wrong. SPEC 21 puts the floor at fifteen documents.
    // When, Then
    expect(FILES.length).toBeGreaterThanOrEqual(15);
  });

  for (const file of FILES) {
    it(
      `should render ${file} under the reference and under telltale`,
      async () => {
        // Given a real published specification, through the real normalizer
        const document = documentOf(file);

        // When
        const reference = await pagesOf(document, false);
        const themed = await pagesOf(document, true);

        // Then every page of both is a page, and telltale's is telltale's
        for (const page of reference) {
          expect(page).toContain('oref-root');
          expect(page.length).toBeGreaterThan(200);
        }

        for (const page of themed) {
          expect(page).toContain('oref-root');
          expect(page).toContain('tt-shell');
          expect(page).toContain('tt-status');
          expect(page.length).toBeGreaterThan(200);
        }
      },
      // EVERY MEMBER OF THE LOOP AND NOT ONLY THE HEAVY ONE, which is how the file beside it
      // declares the same thing: `corpus-navigation.spec.ts` puts one number on an `it.each` over
      // the same documents. Which member is heavy is a property of the corpus and moves when a
      // document is added, so a declaration on `stripe.yaml` alone would be a bound aimed at
      // today's largest file rather than at the class.
      CORPUS_HANG_CATCHER_MS,
    );
  }

  it(
    'should draw this theme own frame on every page of every document',
    async () => {
      // Given, the count is asserted from the other end so that a document skipped by the loop
      // above is a failure here rather than a smaller green run.
      let pages = 0;

      // When
      for (const file of FILES) {
        const themed = await pagesOf(documentOf(file), true);
        pages += themed.filter((page) => page.includes('tt-shell')).length;
      }

      // Then three pages per document, every one of them this theme's
      expect(pages).toBe(FILES.length * 3);
    },
    CORPUS_HANG_CATCHER_MS,
  );
});

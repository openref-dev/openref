import { readdirSync, readFileSync, statSync } from 'node:fs';
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

/** Themed pages carrying this theme's frame, per document, recorded by the loop that drew them. */
const framed = new Map<string, number>();

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
 * The margin every bound in this file clears over what was measured, and the checked one.
 *
 * AN ORDER OF MAGNITUDE, WHICH IS WHAT THE REPOSITORY ALREADY USES FOR THIS CLASS, and it is a
 * constant here rather than a sentence because a sentence cannot go red. The first draft of this
 * file stated the margin in prose over a maximum taken from nine of the ten samples that existed,
 * and the arithmetic on all ten came out at 9.14, under the number the prose claimed. A margin the
 * file asserts about itself moves the bound or changes the claim; a margin in a comment does
 * neither.
 */
const MARGIN = 10;

/**
 * The heaviest reading any case in this file produced on the runner, and where it came from.
 *
 * MEASURED ON THE RUNNER, WHICH IS THE ONLY INSTRUMENT THAT COUNTS HERE. Ten coverage runs on
 * 2026-09-03, on the four vCPU `ubuntu-latest` runner under V8 instrumentation, over Node 22.22.2
 * and Node 24, spread across an AMD EPYC 7763, an EPYC 9V45 and an EPYC 9V74 as the pool handed
 * them out. Ten and not nine: the first derivation read six artifacts from one study run and four
 * from a second, called the total nine, and dropped the sample that carried every maximum.
 *
 * WHAT THESE CASES SPEND IS THE CORPUS AND NOT THIS THEME. Reading, parsing and normalizing real
 * published specifications, `stripe.yaml` at 6 MB among them, happens before this theme draws
 * anything at all. SPEC 15.1 records the seventeen HTTP corpus documents at 3,275 ms of
 * instrumented normalization on their own, cited from that record by
 * `packages/federation/test/integration/mixed-corpus.spec.ts` and
 * `packages/nest/test/integration/overview-budget.spec.ts`; the first draft of this file credited
 * `packages/core`, which holds no such figure. The assertion each case then makes is a substring
 * test over the markup.
 */
const MEASURED = {
  /** `stripe.yaml`, the heaviest member of the loop, at 6,364,174 bytes. */
  heaviestMemberMs: 12_425,
  /** `stripe.yaml`'s size, so the bound below is derived from the same member it is checked on. */
  heaviestMemberBytes: 6_364_174,
  /** `oai-webhook-example.yaml` at 947 bytes, the reading the fixed term has to clear. */
  lightestMemberMs: 15,
} as const;

/**
 * What one loop member is allowed, sized to the member rather than to the class.
 *
 * A BOUND SIZED FOR THE HEAVIEST MEMBER IS NOT A BOUND ON THE LIGHTEST ONE. Every member used to
 * carry one number taken from the whole class, so `oai-webhook-example.yaml` at 947 bytes and a 15
 * ms maximum sat behind 180,000 ms, which is 12,857 times its own reading, and a member that hung
 * took three minutes to say so. A hang catcher that cannot catch a hang inside the job it runs in
 * is a hang catcher on paper: the Node 22 verify job absorbed exactly one 180,000 ms timeout on
 * this tip and finished 65 seconds inside its own wall.
 *
 * DERIVED FROM SIZE, WHICH IS WHY IT IS STILL A RULE ABOUT THE CLASS. The objection the first draft
 * raised against declaring on `stripe.yaml` alone was right: which member is heavy is a property of
 * the corpus and moves when a document is added. Size is the property that makes a member heavy, so
 * evaluating it per member answers that objection instead of ignoring it, and a document added
 * tomorrow is sized on arrival with nothing to edit here.
 *
 * THE TWO TERMS ARE READ OFF THE TEN SAMPLES. Across the seventeen members the cost is a fixed
 * per case cost plus a term proportional to the bytes parsed: the five members over 900 KB ran
 * between 0.72 and 1.95 microseconds per byte, and the twelve small ones are almost all fixed cost.
 * The terms below are the top of each range, and {@link MARGIN} is applied on top.
 *
 * @param file - The corpus document the member renders
 * @returns The member's timeout, in milliseconds
 */
function memberHangCatcherMs(file: string): number {
  const FIXED_MS = 100;
  const MS_PER_BYTE = 0.002;
  const bytes = statSync(join(CORPUS, file)).size;

  return Math.ceil(MARGIN * (FIXED_MS + MS_PER_BYTE * bytes));
}

/*
 * NOTHING HERE IS TUNED AGAINST THESE NUMBERS AND NOTHING SHOULD BE. They are hang catchers, not
 * budgets: what has to fail against one is a render that never returned. The three cases in this
 * file that render nothing declare nothing and keep vitest's five second default, because they are
 * the class the default was chosen for, and an ordinary case timing out still means exactly what it
 * always meant. The global default does not move.
 */

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

        // The count the case below reads, recorded where the pages were actually drawn rather
        // than by drawing them a second time.
        framed.set(file, themed.filter((page) => page.includes('tt-shell')).length);

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
      // EVERY MEMBER OF THE LOOP DECLARES ONE, AND EACH DECLARES ITS OWN. Which member is heavy is
      // a property of the corpus and moves when a document is added, so a declaration on
      // `stripe.yaml` alone would be a bound aimed at today's largest file; a declaration of
      // `stripe.yaml`'s number on all seventeen is that same bound wearing a loop.
      // {@link memberHangCatcherMs} is the rule about the class, evaluated per member.
      memberHangCatcherMs(file),
    );
  }

  it('should draw this theme own frame on every page of every document', () => {
    // Given, the count is asserted from the other end so that a document skipped by the loop above
    // is a failure here rather than a smaller green run. IT IS READ OFF THE LOOP AND NOT
    // RE-RENDERED: this case used to render the whole corpus under telltale a second time to
    // arrive at a number the loop had already produced, which on the runner made it the single
    // most expensive case in the file at 19,691 ms, for no assertion the loop does not already
    // make. The property that mattered is kept whole, because `FILES` is the directory listing and
    // not the loop's own output: a document the loop never reached contributes nothing to the map
    // and the total comes up short. Counting a map is not rendering, so this case declares no
    // bound and keeps vitest's default.

    // When
    const pages = [...framed.values()].reduce((total, count) => total + count, 0);

    // Then three pages per document, every one of them this theme's
    expect([...framed.keys()].sort()).toEqual([...FILES]);
    expect(pages).toBe(FILES.length * 3);
  });

  it('should hold a bound over every reading that was taken, by the margin it claims', () => {
    // Given, the margin used to be a sentence, and a sentence cannot go red. It was written over
    // nine of the ten samples that existed, and on all ten the arithmetic it claimed came out at
    // 9.14 rather than an order of magnitude. Both numbers live in this file now, so the next
    // reading that overruns moves a bound or changes the claim.

    // When, Then the heaviest member's own bound clears the heaviest reading by the margin
    expect(memberHangCatcherMs('stripe.yaml')).toBeGreaterThanOrEqual(
      MEASURED.heaviestMemberMs * MARGIN,
    );

    // And the fixed term clears the lightest reading, which is what a per member bound is for:
    // 947 bytes behind the class's number was 12,857 times its own maximum.
    expect(memberHangCatcherMs('oai-webhook-example.yaml')).toBeGreaterThanOrEqual(
      MEASURED.lightestMemberMs * MARGIN,
    );
    expect(memberHangCatcherMs('oai-webhook-example.yaml')).toBeLessThan(
      MEASURED.lightestMemberMs * 200,
    );

    // And the size the bound is derived from is the size on disk, so a re-vendored document that
    // grew is sized on arrival rather than at the figure recorded here.
    expect(statSync(join(CORPUS, 'stripe.yaml')).size).toBe(MEASURED.heaviestMemberBytes);
  });
});

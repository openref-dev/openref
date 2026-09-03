import { describe, expect, it } from 'vitest';
import {
  createMarkdownRenderer,
  createOpenRefHighlighter,
  renderHtmlDocument,
  renderPage,
  runnerOperationOf,
  STATE_ELEMENT_ID,
} from '@openref/render';
import { withGeneratedSamples } from '@openref/samples';
import type { IRDocument } from '@openref/core';
import { largeDocument } from '../../../../packages/render/test/mocks/documents';
import { createFixture, FIXTURE_BASE_PATH } from '../../src/fixture/app';
import type { Express } from 'express';

/**
 * What separates the two served document figures, position by position.
 *
 * SPEC 20 CARRIES TWO FIGURES FOR ONE PAGE AND TX-SERVED IS WHY. `client-cost.spec.ts` renders
 * the shell in jsdom in every CI run and bounds it at 41 KB; the browser study loads the page a
 * host actually serves and SPEC 20 bounds that at 72 KB. They were once called "one measurement
 * in two places", and on the representative fixture they were 49,114 and 65,326 apart, of which
 * 15,824 bytes were recorded as unattributed for two milestones.
 *
 * THE ATTRIBUTION IS COMPLETE AND THIS FILE IS WHERE IT STAYS COMPLETE. Measured at commit
 * dd18885 by adding one condition at a time to the jsdom render: 15,692 bytes of syntax
 * highlighting the harness was not doing, 259 of `basePath` in every link, and 261 the host
 * brings as real asset hrefs and a nonce. The highlighter is passed by `client-cost.spec.ts`
 * since TX-SERVED, so what is left between the two is the host's contribution and nothing else,
 * and prose saying so is a hypothesis. The case below feeds the host's three inputs back into
 * the renderer and requires the served bytes back, identically. A fourth cause arriving makes
 * that equality fail and names the position it arrived in.
 *
 * IT ALSO FIXES THE DIRECTION OF THE ERROR. Every term is something the host adds and the jsdom
 * harness does not, so its figure understates what a reader receives; the three terms are
 * asserted positive rather than described as such, because a term that went negative would mean
 * the cheap check had started overstating and its ceiling had stopped being a floor.
 */

/** Nodes the thousand node budgets are taken on. */
const NODE_COUNT = 1000;

/**
 * The document the host serves, which is the mock plus the generated samples of SPEC 18.
 *
 * ADDED AT `TX-PAGE-SAMPLES`, AND IT IS THE DOCUMENT RATHER THAN A FOURTH TERM. `ReferenceService`
 * puts the samples on before anything reads the document, so the fixture serves pages of a
 * document that carries them; a bare render of the mock would be a render of a different document,
 * and the second case below is exactly the one that says a byte comparison of two documents
 * attributes nothing. The three host terms this file is about are unchanged by it: the base path,
 * the asset catalogue and the nonce are what the host adds to a page, whichever document it is of.
 *
 * @returns The document both halves render
 */
function servedDocument(): IRDocument {
  return withGeneratedSamples(largeDocument(NODE_COUNT), runnerOperationOf);
}

/** Assets `client-cost.spec.ts` passes, which stand in for a host's catalogue. */
const PLACEHOLDER_ASSETS = { stylesheets: ['/s.css'], modules: ['/m.js'] } as const;

/** Boots the fixture on a port the operating system picks and returns its origin. */
async function boot(app: Express): Promise<string> {
  return new Promise<string>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve(`http://127.0.0.1:${String(port)}`);
    });
  });
}

/** Stylesheet hrefs of a served document, in the order the head writes them. */
function stylesheetsOf(html: string): string[] {
  return [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(
    (match) => match[1] ?? '',
  );
}

/** Module hrefs of a served document, in the order the body writes them. */
function modulesOf(html: string): string[] {
  return [...html.matchAll(/<script type="module" src="([^"]+)"/g)].map((match) => match[1] ?? '');
}

/** The nonce a served document carries, or undefined when it carries none. */
function nonceOf(html: string): string | undefined {
  const state = new RegExp(`id="${STATE_ELEMENT_ID}" nonce="([^"]+)"`).exec(html);
  return state?.[1];
}

describe('the two served document figures', () => {
  it('should differ by the host base path, the host asset catalogue and the host nonce, and by nothing else', async () => {
    // Given the page both budgets are written about, rendered exactly as `client-cost.spec.ts`
    // renders it: the fifth hundredth node, the same markdown renderer, the same placeholders.
    const document_ = servedDocument();
    const nodeId = [...document_.nodes.keys()][500] ?? '';
    const markdown = await createMarkdownRenderer({
      // THE HOST'S OWN LANGUAGE SET AND NOT THE FOUR `client-cost.spec.ts` LOADS, since
      // `TX-PAGE-SAMPLES`. `ReferenceService` calls `createOpenRefHighlighter()` with no argument,
      // which is all of `HIGHLIGHT_LANGUAGES`, and until a page carried a block in a language
      // outside those four the two sets produced identical bytes. A samples section carries nine,
      // so the difference became visible as six blocks the harness rendered plain and the host
      // highlighted: a fourth cause, exactly as the header says one would arrive, and it is the
      // harness that was wrong about the host rather than a new thing the host does.
      highlighter: await createOpenRefHighlighter(),
    });

    const bare = renderHtmlDocument(await renderPage(document_, { nodeId, markdown }), {
      assets: {
        stylesheets: [...PLACEHOLDER_ASSETS.stylesheets],
        modules: [...PLACEHOLDER_ASSETS.modules],
      },
    });

    // When the same page is asked of a real host, over HTTP, under the strict policy
    const origin = await boot(createFixture('large', { policy: true }));
    const served = await (await fetch(`${origin}${FIXTURE_BASE_PATH}/${nodeId}`)).text();

    const stylesheets = stylesheetsOf(served);
    const modules = modulesOf(served);
    const nonce = nonceOf(served);

    // Then the host's three inputs are all there is between them. Fed back into the same
    // renderer, they reproduce the served document byte for byte.
    expect(nonce).toBeDefined();
    const hosted = renderHtmlDocument(
      await renderPage(document_, { nodeId, markdown, basePath: FIXTURE_BASE_PATH }),
      { assets: { stylesheets, modules }, ...(nonce === undefined ? {} : { nonce }) },
    );

    expect(hosted).toBe(served);

    // And each of the three is a separate, named, positive term, measured by adding one at a
    // time. A single sum would let one term grow while another shrank and say nothing.
    const withBasePath = renderHtmlDocument(
      await renderPage(document_, { nodeId, markdown, basePath: FIXTURE_BASE_PATH }),
      {
        assets: {
          stylesheets: [...PLACEHOLDER_ASSETS.stylesheets],
          modules: [...PLACEHOLDER_ASSETS.modules],
        },
      },
    );
    const withAssets = renderHtmlDocument(
      await renderPage(document_, { nodeId, markdown, basePath: FIXTURE_BASE_PATH }),
      { assets: { stylesheets, modules } },
    );

    const size = (html: string): number => Buffer.byteLength(html, 'utf8');
    const basePathTerm = size(withBasePath) - size(bare);
    const assetTerm = size(withAssets) - size(withBasePath);
    const nonceTerm = size(served) - size(withAssets);

    expect(basePathTerm).toBeGreaterThan(0);
    expect(assetTerm).toBeGreaterThan(0);
    expect(nonceTerm).toBeGreaterThan(0);
    expect(basePathTerm + assetTerm + nonceTerm).toBe(size(served) - size(bare));
  }, 600_000);

  it('should have both halves rendering one document, which is what makes the difference the serving path', async () => {
    // Given, because a byte comparison of two different documents attributes nothing. The hash
    // equality of the two generators is held in `test/unit/specification.spec.ts`; what is
    // checked here is that the two pages carry the same document identity on the wire.
    const document_ = servedDocument();
    const nodeId = [...document_.nodes.keys()][500] ?? '';
    const markdown = await createMarkdownRenderer();
    const bare = renderHtmlDocument(await renderPage(document_, { nodeId, markdown }), {});

    // When
    const origin = await boot(createFixture('large', { policy: true }));
    const served = await (await fetch(`${origin}${FIXTURE_BASE_PATH}/${nodeId}`)).text();

    // Then
    const identity = (html: string): string =>
      /data-oref-document="([0-9a-f]+)"/.exec(html)?.[1] ?? '';

    expect(identity(served)).toHaveLength(64);
    expect(identity(bare)).toBe(identity(served));
  }, 600_000);
});

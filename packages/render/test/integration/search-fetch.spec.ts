// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeOpenApiDocument } from '@openref/core';
import { defineTheme } from '@openref/vue';
import { h, type VNode } from 'vue';
import { hydrateReference } from '../../src/browser/index';
import { PALETTE_NOTICES } from '../../src/components/palette-notices';
import { renderHtmlDocument } from '../../src/page/domain/shell';
import { renderPage } from '../../src/render/application/services/render.service';
import { buildNavigation } from '../../src/page/domain/page-model';
import type { IRDocument, IROperation } from '@openref/core';
import type { SearchHit } from '@openref/vue';
import type { SearchIndexPort, SearchIndexSource } from '../../src/browser/index';

/**
 * The full text index reaching the palette, which is the whole of `full-text-search`.
 *
 * The index has been built, budgeted and served at `<mount>/_search-index` since T007, and until
 * T042 no file this project shipped ever asked for it: the palette matched navigation labels and
 * hints, which is a path, a method and part of a summary, and nothing of a description. What
 * this file asserts is the four things that have to be true for that to have changed.
 *
 * - the request goes to this page's own origin, under the mount point the page was served at
 * - a word that lives only in a description is findable, which is the capability
 * - a request that fails leaves a working palette, which is the fail open policy
 * - an index about another document is refused rather than searched
 *
 * EVERY ABSENCE HERE IS SHOWN ABLE TO SEE WHAT IT DENIES BEFORE IT DENIES IT, per SPEC 0. A
 * palette that rendered no hits for any query would satisfy "the index only word is absent"
 * perfectly, so each case that asserts nothing was found first asserts that the same palette,
 * driven the same way, finds the control query.
 *
 * IN JSDOM AND NOT IN A BROWSER, `deferred-gate.spec.ts`'s reasoning: what is under test is the
 * wiring and not the module graph. That the chunk loads under the strict policy is the browser
 * suite's claim.
 */

/** The word that appears in one description and in no label, hint or path of this document. */
const INDEX_ONLY_WORD = 'ptarmigan';

/** Where the reference is mounted in every case here, so the address has a prefix to carry. */
const BASE_PATH = '/docs';

/** Operations beyond the one that matters, so the page ships a slice and not the whole tree. */
const FILLER_OPERATIONS = 200;

/**
 * A document with one word that only a full text index can reach.
 *
 * The navigation carries a label and a `METHOD /path` hint per row, so the word is put where
 * neither can see it: the description of one operation, which no navigation row quotes. Every
 * other operation exists to make the navigation larger than a page ships, which is what puts the
 * `_navigation` fetch beside the `_search-index` one and lets the case tell them apart.
 */
function searchableDocument(): IRDocument {
  const paths: Record<string, unknown> = {};

  for (let index = 0; index < FILLER_OPERATIONS; index += 1) {
    paths[`/v1/resource-${String(index)}`] = {
      get: {
        operationId: `getResource${String(index)}`,
        summary: `Read resource ${String(index)}`,
        description: 'An ordinary operation with an ordinary description.',
        tags: [`group-${String(index % 12)}`],
        responses: { '200': { description: 'Found' } },
      },
    };
  }

  paths['/orders'] = {
    get: {
      operationId: 'listOrders',
      summary: 'List orders',
      description: `Returns every order the ${INDEX_ONLY_WORD} warehouse holds.`,
      tags: ['orders'],
      responses: { '200': { description: 'A page of orders' } },
    },
  };

  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Orders API', version: '1.0.0' },
    paths,
  });
}

/** What the fake index serves over the wire: one record per searchable document. */
interface IndexFile {
  readonly documentHash: string;
  readonly records: readonly {
    readonly id: string;
    readonly kind: 'operation' | 'schema';
    readonly title: string;
    readonly text: string;
    readonly path: string;
    readonly method: string;
  }[];
}

/**
 * The index this suite serves, built from the document the page is about.
 *
 * NOT `@openref/search`, and that is the dependency rule rather than a shortcut. STANDARDS 3.5
 * gives this package `core` and `vue`, so the renderer cannot see the real index builder in its
 * source or in its tests, and what the renderer owns is the seam: the address, the port, the
 * refusal and the palette. That a real serialized index loads and answers is
 * `packages/nest/test/unit/search-factory.spec.ts`, where the package that may see both halves
 * is the one under test.
 *
 * What matters for this file is that the records carry the descriptions, because that is the
 * text no navigation row holds.
 */
function serializeIndex(document_: IRDocument, documentHash = document_.hash): string {
  const records: IndexFile['records'] = [...document_.nodes.values()]
    .filter((node): node is IROperation => node.kind === 'operation')
    .map((node) => ({
      id: node.id,
      kind: 'operation' as const,
      title: node.summary ?? node.path,
      text: `${node.summary ?? ''} ${node.description ?? ''}`,
      path: node.path,
      method: node.method,
    }));

  return JSON.stringify({ documentHash, records } satisfies IndexFile);
}

/** The operation the index only word belongs to, read off the document rather than written out. */
function ordersNode(document_: IRDocument): IROperation {
  for (const node of document_.nodes.values()) {
    if (node.kind === 'operation' && node.path === '/orders') return node;
  }

  throw new Error('the fixture document has no /orders operation');
}

/** Turns the served body into the port the palette is handed, hash and all. */
function loadFakeIndex(source: SearchIndexSource): Promise<SearchIndexPort> {
  const file = JSON.parse(source.serialized) as IndexFile;

  return Promise.resolve({
    documentHash: file.documentHash,
    search(query: string, limit = 20): SearchHit[] {
      const needle = query.trim().toLowerCase();
      if (needle === '') return [];

      return file.records
        .filter((record) => record.text.toLowerCase().includes(needle))
        .slice(0, limit)
        .map((record, at) => ({
          id: record.id,
          kind: record.kind,
          title: record.title,
          score: file.records.length - at,
          path: record.path,
          method: record.method,
        }));
    },
  });
}

/** Absolute addresses, which is what SPEC 19.4 forbids a page to reach for by itself. */
function isForeign(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//');
}

/** What the reader's browser did, and what it was answered with. */
interface Wire {
  readonly urls: string[];
}

/**
 * Serves this page's own two payloads and nothing else.
 *
 * @param document_ - The document the page is about
 * @param index - The index body, or null for a request that fails the way an offline one does
 * @returns The recorded addresses
 */
function serve(document_: IRDocument, index: string | null): Wire {
  const urls: string[] = [];

  vi.stubGlobal('fetch', (url: string): Promise<Response> => {
    urls.push(url);

    if (url.endsWith('/_search-index')) {
      return index === null
        ? Promise.resolve(new Response('no index here', { status: 404 }))
        : Promise.resolve(new Response(index, { status: 200 }));
    }

    return Promise.resolve(
      new Response(
        JSON.stringify({
          documentHash: document_.hash,
          navigation: buildNavigation(document_),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
  });

  return { urls };
}

/** Puts the served page in the document, exactly as a host would send it. */
async function servePage(document_: IRDocument): Promise<void> {
  const page = await renderPage(document_, { basePath: BASE_PATH, nodeId: null });

  document.documentElement.innerHTML = renderHtmlDocument(page, {
    nonce: 'r4nd0mNONCEvalue',
    assets: { stylesheets: ['/assets/theme.css'], modules: ['/assets/openref.js'] },
  });
}

/** The whole interaction a browser sends when a reader presses a control. */
function press(element: Element): void {
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/** Presses the palette open and waits for the field the reader types into. */
async function openPalette(): Promise<void> {
  const button = document.querySelector('.oref-palette-open');
  if (button === null) throw new Error('the page rendered no palette button');

  press(button);

  await vi.waitFor(() => {
    expect(document.querySelector('.oref-palette-input')).not.toBeNull();
  });
}

/** Types a query, the way a reader does, and lets the results settle. */
async function typeQuery(text: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('.oref-palette-input');
  if (input === null) throw new Error('the palette is not open');

  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.waitFor(() => {
    expect(document.querySelector('.oref-palette-list')).not.toBeNull();
  });
}

/** What the reader is being shown. */
function hitLabels(): string[] {
  return Array.from(
    document.querySelectorAll('.oref-palette-label'),
    (element) => element.textContent,
  );
}

/** The sentence in the palette's empty state, or null when there is no notice. */
function noticeText(): string | null {
  return document.querySelector('.oref-palette-empty')?.textContent ?? null;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.innerHTML = '';
});

describe('the palette fetching a full text index', () => {
  it('should ask this page own origin under the mount point, and no other origin at all', async () => {
    // Given a page served under a mount point, with its own index behind it
    const document_ = searchableDocument();
    const wire = serve(document_, serializeIndex(document_));
    await servePage(document_);
    hydrateReference({ loadSearch: loadFakeIndex });

    // Nothing is asked for by a page that was opened and not touched, per SPEC 14.4.1
    expect(wire.urls).toEqual([]);

    // When the reader opens the palette
    await openPalette();
    await vi.waitFor(() => {
      expect(wire.urls.some((url) => url.endsWith('/_search-index'))).toBe(true);
    });

    // Then the address is the mount point's own, and it is the only index it asked for
    expect(wire.urls.filter((url) => url.endsWith('/_search-index'))).toEqual([
      `${BASE_PATH}/_search-index`,
    ]);

    // And no request left this origin. THE ABSENCE IS SHOWN ABLE TO SEE WHAT IT DENIES: the
    // same predicate reports a foreign address when it is handed one, so an empty result is a
    // fact about the page rather than about the check.
    expect(isForeign('https://cdn.example.com/_search-index')).toBe(true);
    expect(wire.urls.filter(isForeign)).toEqual([]);
  });

  it('should show a hit that lives in a description, which no navigation row carries', async () => {
    // Given the same page with no index wired in, which is the palette as it shipped until T042
    const document_ = searchableDocument();
    serve(document_, serializeIndex(document_));
    await servePage(document_);
    hydrateReference();
    await openPalette();

    // The rows can be searched, and they answer a path, which is what they hold
    await typeQuery('/orders');
    await vi.waitFor(() => {
      expect(hitLabels()).toContain('List orders');
    });

    // And the word in the description is not in them, which is the absence this case is about
    await typeQuery(INDEX_ONLY_WORD);
    await vi.waitFor(() => {
      expect(document.querySelector('.oref-palette-empty')).not.toBeNull();
    });
    expect(hitLabels()).toEqual([]);

    // When the same page is served again with the index wired in
    document.documentElement.innerHTML = '';
    await servePage(document_);
    hydrateReference({ loadSearch: loadFakeIndex });
    await openPalette();
    await typeQuery(INDEX_ONLY_WORD);

    // Then the operation whose description holds the word is offered, with its own address
    await vi.waitFor(() => {
      expect(hitLabels()).toContain('List orders');
    });
    expect(
      document.querySelector('.oref-palette-hit .oref-palette-link')?.getAttribute('href'),
    ).toBe(`${BASE_PATH}/${encodeURIComponent(ordersNode(document_).id)}`);
    expect(document.querySelector('.oref-palette-hint')?.textContent).toBe('GET /orders');
  });

  it('should keep searching the navigation when the index cannot be fetched', async () => {
    // Given a page whose index answers 404 and whose navigation does not
    const document_ = searchableDocument();
    const wire = serve(document_, null);
    await servePage(document_);
    hydrateReference({ loadSearch: loadFakeIndex });

    // When the reader opens the palette and types a path
    await openPalette();
    await vi.waitFor(() => {
      expect(wire.urls.some((url) => url.endsWith('/_search-index'))).toBe(true);
    });
    await typeQuery('/orders');

    // Then the palette is a working palette over the navigation, which is the fail open policy
    await vi.waitFor(() => {
      expect(hitLabels()).toContain('List orders');
    });

    // And it does not pretend to have searched more than it did. THE ABSENCE IS SHOWN ABLE TO
    // SEE: the assertion above is the same palette, driven the same way, finding a row.
    await typeQuery(INDEX_ONLY_WORD);
    await vi.waitFor(() => {
      expect(document.querySelector('.oref-palette-empty')).not.toBeNull();
    });
    expect(hitLabels()).toEqual([]);
  });

  it('should refuse an index about another document rather than searching a stale one', async () => {
    // Given a page served an index built from something else, which is what a cache in front of
    // an address that never changes can answer with
    const document_ = searchableDocument();
    serve(document_, serializeIndex(document_, 'sha256:another-document'));
    await servePage(document_);
    hydrateReference({ loadSearch: loadFakeIndex });
    await openPalette();

    // When the reader types the word only that index holds
    await typeQuery(INDEX_ONLY_WORD);
    await vi.waitFor(() => {
      expect(document.querySelector('.oref-palette-empty')).not.toBeNull();
    });

    // Then nothing from it is shown, and the navigation still is. THE ABSENCE IS SHOWN ABLE TO
    // SEE WHAT IT DENIES: the same body, with the page's own hash on it, is found by the case
    // above, and this same palette answers a path from the rows below.
    expect(hitLabels()).toEqual([]);
    await typeQuery('/orders');
    await vi.waitFor(() => {
      expect(hitLabels()).toContain('List orders');
    });
  });
});

/**
 * The three states a reader can be in once the palette has a port, told apart.
 *
 * THE DECISION IS T042'S AND IT IS RECORDED IN SPEC 11 BEFORE IT IS HERE. A failed index fetch was
 * shown as `search-no-results`, which is true of the search that ran and silent about what it ran
 * over, so a reader learned that this reference holds nothing matching their query when what had
 * happened is that the index never arrived. `search-unavailable` is the fourth notice kind, and the
 * point of the three cases below is that the fourth did not swallow the third: an index that loaded
 * and answered with nothing still says "No matches".
 *
 * PRESENCE FIRST, per SPEC 0. The first case is the working index, so the two that assert a
 * sentence about a degradation are driven against a palette already shown answering.
 */
describe('the palette telling a failed index apart from an empty answer', () => {
  it('should answer out of the index when it loads, which is the state the other two are not', async () => {
    // Given a page whose index is served
    const document_ = searchableDocument();
    serve(document_, serializeIndex(document_));
    await servePage(document_);
    hydrateReference({ loadSearch: loadFakeIndex });

    // When the reader opens the palette and types the word only the index holds
    await openPalette();
    await typeQuery(INDEX_ONLY_WORD);

    // Then there are results and therefore no notice at all
    await vi.waitFor(() => {
      expect(hitLabels()).toContain('List orders');
    });
    expect(noticeText()).toBeNull();
  });

  it('should say the index could not be loaded, and not that there are no matches', async () => {
    // Given the same page with the index answering 404, which is the degraded state
    const document_ = searchableDocument();
    serve(document_, null);
    await servePage(document_);
    hydrateReference({ loadSearch: loadFakeIndex });

    // When the reader opens the palette and types the word only an index could answer
    await openPalette();
    await typeQuery(INDEX_ONLY_WORD);

    // Then the reader is told which search actually ran, and is not told there are no matches
    await vi.waitFor(() => {
      expect(noticeText()).toBe(PALETTE_NOTICES['search-unavailable']);
    });
    expect(noticeText()).not.toBe(PALETTE_NOTICES['search-no-results']);
  });

  it('should still say there are no matches when the index loaded and answered with nothing', async () => {
    // Given the same page with a working index, so the two states differ by the fetch alone
    const document_ = searchableDocument();
    serve(document_, serializeIndex(document_));
    await servePage(document_);
    hydrateReference({ loadSearch: loadFakeIndex });

    // When the reader types something neither the index nor a navigation row holds
    await openPalette();
    await typeQuery('quagga-nothing-holds-this');

    // Then the empty answer keeps its own sentence: the fourth kind did not swallow the third
    await vi.waitFor(() => {
      expect(noticeText()).toBe(PALETTE_NOTICES['search-no-results']);
    });
  });

  it('should print the sentence through a theme whose notice map predates the kind', async () => {
    // Given a theme written against the nine kinds that existed before T042, which is every theme
    // published before it. `message` is a prop and the kind is only what a theme marks it with, so
    // the words reach the reader whether or not the theme has heard of the state.
    const olderMarks: Readonly<Record<string, string>> = {
      'nav-unavailable': 'NAV',
      'search-empty': 'FIND',
      'search-no-results': 'FIND',
      'search-partial': 'FIND',
      'no-server': 'SRV',
      'no-body-fields': 'BODY',
      'schema-missing': 'SCH',
      'no-schema': 'SCH',
      'health-missing': 'HLTH',
    };
    const theme = defineTheme({
      name: 'older-than-the-kind',
      components: {
        StateNotice: (props: { readonly kind: string; readonly message: string }): VNode =>
          h('li', { class: 'older-notice' }, [
            h('span', { class: 'older-notice-mark' }, olderMarks[props.kind] ?? ''),
            h('span', { class: 'older-notice-text' }, props.message),
          ]),
      },
    });

    const document_ = searchableDocument();
    serve(document_, null);
    await servePage(document_);
    hydrateReference({ theme, loadSearch: loadFakeIndex });

    // When the reader reaches the state that theme has no entry for
    await openPalette();
    await typeQuery(INDEX_ONLY_WORD);

    // Then the theme drew the notice, the mark it had none for is empty, and the sentence is there
    await vi.waitFor(() => {
      expect(document.querySelector('.older-notice-text')?.textContent).toBe(
        PALETTE_NOTICES['search-unavailable'],
      );
    });
    expect(document.querySelector('.older-notice-mark')?.textContent).toBe('');
  });
});

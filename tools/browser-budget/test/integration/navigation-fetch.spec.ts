/**
 * The acceptance test for T012-R2, in the browser, on the page the budget is about.
 *
 * The condition set for taking the navigation out of the state block was this, in the
 * maintainer's words: the sidebar and the palette still work on a cold page with no network
 * beyond origin. Every other test of that change runs in jsdom against a loader written by the
 * test. This one runs the shipped bundle against the shipped server, under the strict policy of
 * SPEC 19.2, and watches the wire.
 *
 * IT IS ALSO WHERE THE TWO CLAIMS MEET. SPEC 19.4 says the page fetches nothing outside its
 * origin, and this change makes the page fetch something. Both are true and the boundary is the
 * one SPEC 14.4.1 already draws: the request goes to the reader's own origin, and it happens
 * because the reader opened something rather than because the page loaded.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeOpenApiDocument } from '@openref/core';
import {
  bootFixture,
  largeSpecification,
  launchChrome,
  TTI_NODE_COUNT,
  TTI_PAGE,
} from '../../src/index';
import type { IRDocument } from '@openref/core';
import type { BootedFixture, LaunchedChrome } from '../../src/index';
import type { Page, Request } from 'playwright-core';

const TIMEOUT = 300_000;

let chrome: LaunchedChrome;
let fixture: BootedFixture;

beforeAll(async () => {
  chrome = await launchChrome();
  fixture = await bootFixture('large');
}, TIMEOUT);

afterAll(async () => {
  await fixture.stop();
  await chrome.close();
});

/** One navigation, with everything the page asked for and everything the policy refused. */
interface Session {
  readonly page: Page;
  readonly requests: string[];
  readonly violations: string[];
  close(): Promise<void>;
}

async function open(path: string): Promise<Session> {
  const context = await chrome.browser.newContext();
  const page = await context.newPage();
  const requests: string[] = [];
  const violations: string[] = [];

  await page.addInitScript(`
    globalThis.__openrefCspViolations = [];
    addEventListener('securitypolicyviolation', (event) => {
      globalThis.__openrefCspViolations.push(
        (event.effectiveDirective || event.violatedDirective) + ' ' + event.blockedURI,
      );
    });
  `);

  page.on('request', (request: Request) => {
    requests.push(request.url());
  });

  const response = await page.goto(`${fixture.url}${path}`, {
    waitUntil: 'load',
    timeout: 120_000,
  });

  // THE PAGE IS ASSERTED PRESENT HERE, per SPEC 0, because every case below asserts an absence:
  // no external request, no policy violation, no navigation fetch. A 404 satisfies all three by
  // loading nothing at all, which is how six proofs of M0 stayed green while proving nothing.
  expect(response?.status()).toBe(200);
  expect(await page.locator('#oref-app').count()).toBe(1);

  return {
    page,
    requests,
    violations,
    close: async () => {
      violations.push(
        ...(await page.evaluate(
          () =>
            (globalThis as unknown as { __openrefCspViolations?: string[] })
              .__openrefCspViolations ?? [],
        )),
      );
      await context.close();
    },
  };
}

/** Requests that went anywhere but the fixture's own origin. */
function external(session: Session): string[] {
  return session.requests.filter((url) => !url.startsWith(fixture.url) && !url.startsWith('data:'));
}

/** A word the full text index can answer and no navigation row can, with who answers it. */
interface IndexOnlyWord {
  readonly word: string;
  /** Ids of the operations whose description carries it. */
  readonly ids: readonly string[];
}

/**
 * Finds a word that lives only where a full text index can see it.
 *
 * WHY IT IS DERIVED AND NOT WRITTEN OUT, which is the finding the case above already records
 * about `/resource-742`: a literal that stops existing when the fixture changes turns this case
 * into a query that matches nothing, and a query that matches nothing looks exactly like an
 * index that never arrived.
 *
 * A navigation row carries a label and a `METHOD /path` hint, and `searchNavigation` matches
 * substrings of those two fields alone. So a word that is a substring of no label, no hint and no
 * schema name cannot be produced by the palette's fallback search at all, whatever the navigation
 * holds by the time the reader types.
 *
 * THE IDS ARE THE IR'S AND NOT THE DOCUMENT'S, because the address a hit links to is built from
 * `IRNode.id`, which is derived per SPEC 5.4 and is not the author's `operationId`.
 *
 * @param document_ - The fixture document, normalized, which is what the server serves
 * @param schemaNames - Schema names, which are navigation rows of their own
 * @returns The word and the ids of the operations whose description carries it
 */
function indexOnlyWord(document_: IRDocument, schemaNames: readonly string[]): IndexOnlyWord {
  const rowText: string[] = schemaNames.map((name) => name.toLowerCase());
  const described: { readonly id: string; readonly words: readonly string[] }[] = [];

  for (const node of document_.nodes.values()) {
    if (node.kind !== 'operation') continue;

    rowText.push(
      `${node.summary ?? ''} ${node.method} ${node.path} ${node.tags.join(' ')}`.toLowerCase(),
    );
    described.push({
      id: node.id,
      words: (node.description ?? '')
        .toLowerCase()
        .split(/[^a-z]+/u)
        .filter((word) => word.length >= 7),
    });
  }

  const rows = rowText.join('\n');
  const counted = new Map<string, string[]>();

  for (const { id, words } of described) {
    for (const word of words) {
      if (rows.includes(word)) continue;
      counted.set(word, [...(counted.get(word) ?? []), id]);
    }
  }

  for (const [word, ids] of counted) {
    if (ids.length > 0) return { word, ids };
  }

  throw new Error('the fixture carries no description word outside its navigation rows');
}

describe('a cold page of the thousand node document', () => {
  it(
    'should open a closed group by asking its own origin, and nobody else',
    async () => {
      // Given a page the reader has just landed on
      const session = await open(TTI_PAGE);

      try {
        // CHUNKS RATHER THAN ROWS, because the sidebar renders about sixty rows whatever it
        // holds, per SPEC 11. Opening a group of fifty adds rows to the list and not to the
        // document, so counting what is on screen would report that nothing happened.
        const before = await session.page.locator('.oref-nav-list').count();
        const closed = session.page.locator('.oref-nav-toggle[aria-expanded="false"]').first();
        expect(await closed.count()).toBe(1);

        // When the reader opens a group whose contents never travelled with the page
        await closed.click();
        // POLLED FROM OUTSIDE THE PAGE. Playwright evaluates a string condition with eval,
        // which this page's policy refuses and correctly reports, so waiting that way would
        // plant the violation this test is here to look for. Waiting for an expanded toggle to
        // appear does not work either: the group holding this page is already expanded, so the
        // selector matches before the click and the wait returns having waited for nothing.
        await expect
          .poll(() => session.page.locator('.oref-nav-list').count(), { timeout: 30_000 })
          .toBeGreaterThan(before);

        // And nothing left the origin to make it happen
        expect(external(session)).toEqual([]);
      } finally {
        await session.close();
        expect(session.violations).toEqual([]);
      }
    },
    TIMEOUT,
  );

  it(
    'should find an operation the page never carried, one keystroke deep',
    async () => {
      // Given the overview, whose slice holds group headers and no operation at all, and a
      // route read off the fixture rather than written out. The literal that used to be here,
      // `/resource-742`, stopped existing when T016 replaced the fixture, and a query that
      // matches nothing looks exactly like an index that never arrived.
      const document_ = normalizeOpenApiDocument(largeSpecification(TTI_NODE_COUNT));
      const far = [...document_.nodes.values()][742];
      const route = far !== undefined && 'path' in far ? far.path : '';
      const id = far?.id ?? '';
      expect(route).not.toBe('');

      const session = await open('/docs');

      try {
        expect(await session.page.locator('a.oref-nav-item').count()).toBe(0);

        // When the reader opens the palette and types a path
        await session.page.locator('.oref-palette-open').click();
        await session.page.locator('.oref-palette-input').fill(route);

        // Then the operation is found, which means the whole index arrived
        await session.page.waitForSelector('.oref-palette-hit', { timeout: 30_000 });
        const first = await session.page.locator('.oref-palette-link').first().getAttribute('href');
        expect(first).toContain(id);

        // And again, nothing left the origin
        expect(external(session)).toEqual([]);
      } finally {
        await session.close();
        expect(session.violations).toEqual([]);
      }
    },
    TIMEOUT,
  );

  it(
    'should fetch the search index on the first open and answer from it, in a real browser',
    async () => {
      // Given the second fetch a palette makes, which had no browser proof until this case: the
      // claim map cited a jsdom suite driving a loader the test wrote, plus this file, which
      // asserted nothing about the index at all. What runs here is the shipped bundle against the
      // shipped server, under the strict policy, with the wire watched.
      const specification = largeSpecification(TTI_NODE_COUNT);
      const document_ = normalizeOpenApiDocument(specification);
      const schemaNames = Object.keys(
        ((specification.components ?? {}) as { schemas?: Record<string, unknown> }).schemas ?? {},
      );
      const { word, ids } = indexOnlyWord(document_, schemaNames);

      // THE CONTROL IS THE FIXTURE ITSELF, per SPEC 0: the word is asserted to be outside every
      // field the fallback search can read before the browser is asked to find it, so a hit
      // cannot have come from the navigation rows whatever they hold by then.
      const rows = [...document_.nodes.values()]
        .map((node) => `${node.summary ?? ''} ${'path' in node ? node.path : ''}`.toLowerCase())
        .join('\n');
      expect(rows).not.toContain(word);
      expect(schemaNames.join(' ').toLowerCase()).not.toContain(word);
      expect(ids.length).toBeGreaterThan(0);

      const session = await open('/docs');

      try {
        // Nothing is asked for by a page nobody has touched, which is the SPEC 19.4 boundary
        expect(session.requests.some((url) => url.includes('_search-index'))).toBe(false);

        // When the reader opens the palette and types the word
        await session.page.locator('.oref-palette-open').click();
        await session.page.locator('.oref-palette-input').fill(word);

        // Then the index was fetched, from this origin, under the mount point the page was
        // served at and nowhere else
        await expect
          .poll(() => session.requests.filter((url) => url.includes('_search-index')), {
            timeout: 30_000,
          })
          .toEqual([`${fixture.url}/docs/_search-index`]);

        // And the page answers with an operation only the index could have found
        await session.page.waitForSelector('.oref-palette-hit', { timeout: 30_000 });
        const href = await session.page.locator('.oref-palette-link').first().getAttribute('href');
        expect(ids.some((id) => (href ?? '').includes(encodeURIComponent(id)))).toBe(true);

        // And nothing left the origin to make either of those happen
        expect(external(session)).toEqual([]);
      } finally {
        await session.close();
        expect(session.violations).toEqual([]);
      }
    },
    TIMEOUT,
  );

  it(
    'should ask for nothing at all while nobody touches it',
    async () => {
      // Given, which is the SPEC 19.4 boundary: a page that was opened and not touched
      const session = await open(TTI_PAGE);

      try {
        // When it settles
        await session.page.waitForTimeout(1_000);

        // Then every request it made was for the page and the files the page links
        expect(external(session)).toEqual([]);
        expect(session.requests.some((url) => url.includes('_navigation'))).toBe(false);
      } finally {
        await session.close();
        expect(session.violations).toEqual([]);
      }
    },
    TIMEOUT,
  );
});

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
import { bootFixture, launchChrome, TTI_PAGE } from '../../src/index';
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

  await page.goto(`${fixture.url}${path}`, { waitUntil: 'load', timeout: 120_000 });

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
      // Given the overview, whose slice holds group headers and no operation at all
      const session = await open('/docs');

      try {
        expect(await session.page.locator('a.oref-nav-item').count()).toBe(0);

        // When the reader opens the palette and types a path
        await session.page.locator('.oref-palette-open').click();
        await session.page.locator('.oref-palette-input').fill('/resource-742');

        // Then the operation is found, which means the whole index arrived
        await session.page.waitForSelector('.oref-palette-hit', { timeout: 30_000 });
        const first = await session.page.locator('.oref-palette-link').first().getAttribute('href');
        expect(first).toContain('resource-742');

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

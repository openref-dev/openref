import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootExampleApp, EXAMPLE_BASE_PATH, launchChrome } from '../../src/index';
import type { LaunchedChrome, SpawnedServer } from '../../src/index';
import type { Page } from 'playwright-core';

/**
 * The client behaviour TX-MARKUP added, proved where a reader meets it.
 *
 * THREE THINGS ONLY A BROWSER CAN SAY. The view segment narrows the tree and returns it,
 * which is client state over a server render; the permanent field anchor expands ancestors
 * level by level after mount and moves focus, which is a walk the server never runs; and the
 * bench's verdict chip appears after a real response from the real application. jsdom renders
 * none of these as a reader sees them, and two of the three depend on state changes after
 * hydration.
 */

const TIMEOUT = 300_000;

const SCHEMA_PAGE = `${EXAMPLE_BASE_PATH}/schema/OrderDto`;
const BENCH_PAGE = `${EXAMPLE_BASE_PATH}/bench/get-orders`;

let chrome: LaunchedChrome;
let app: SpawnedServer;

beforeAll(async () => {
  chrome = await launchChrome();
  app = await bootExampleApp();
}, TIMEOUT);

afterAll(async () => {
  await app.stop();
  await chrome.close();
}, TIMEOUT);

async function open(path: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await chrome.browser.newContext();
  const page = await context.newPage();
  await page.goto(`${app.url}${path}`, { waitUntil: 'load' });

  return {
    page,
    close: async () => {
      await context.close();
    },
  };
}

/** The raw press of the SPEC 11 rule, below every actionability policy. */
async function pressWithTheMouse(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();

  const box = await target.boundingBox();
  if (box === null) throw new Error(`${selector} has no box to press`);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
}

describe('the schema page view segment', () => {
  it(
    'should narrow to the request view and return to both, on the readOnly id field',
    async () => {
      // Given, the schema page at its default, which is the both view with nothing hidden
      const session = await open(SCHEMA_PAGE);
      const row = session.page.locator('[data-oref-path="OrderDto/id"]');
      const request = session.page.locator('.oref-seg-btn', { hasText: 'request' });

      try {
        await expect.poll(() => row.count()).toBe(1);

        // When the reader narrows to the request view, the server-assigned id leaves it
        await request.click();
        await expect.poll(() => row.count()).toBe(0);
        expect(await request.getAttribute('aria-pressed')).toBe('true');

        // And pressing the pressed button returns to both, so nothing stays hidden
        await request.click();
        await expect.poll(() => row.count()).toBe(1);
        expect(await request.getAttribute('aria-pressed')).toBe('false');
      } finally {
        await session.close();
      }
    },
    TIMEOUT,
  );
});

describe('the permanent field anchor', () => {
  it(
    'should expand the ancestors of a deep fragment and focus the row it names',
    async () => {
      // Given, a reader arriving with a link three levels deep, which the served markup does
      // not carry expanded
      const path = 'OrderDto/customer/billingAddress/city';
      const session = await open(`${SCHEMA_PAGE}#${encodeURIComponent(path)}`);
      const row = session.page.locator(`[data-oref-path="${path}"]`);

      try {
        // Then the walk expands level by level until the row exists, and focus lands on it
        await expect.poll(() => row.count(), { timeout: 30_000 }).toBe(1);
        await expect
          .poll(() =>
            session.page.evaluate(() => {
              const root = globalThis as unknown as {
                document: { activeElement: { getAttribute(name: string): string | null } | null };
              };
              return root.document.activeElement?.getAttribute('data-oref-path') ?? '';
            }),
          )
          .toBe(path);

        // And the row's own anchor carries the same address it was reached by
        expect(await row.locator('xpath=following-sibling::a[1]').getAttribute('href')).toBe(
          `#${encodeURIComponent(path)}`,
        );
      } finally {
        await session.close();
      }
    },
    TIMEOUT,
  );
});

describe('the bench verdict chip', () => {
  it(
    'should say the answer matches the declared 200 after a real send',
    async () => {
      // Given, the bench of the operation the README opens with, which needs nothing filled in
      const session = await open(BENCH_PAGE);

      try {
        // When, the raw press of the SPEC 11 proof: gate, chunk, replay, send
        await pressWithTheMouse(session.page, '.oref-send');

        // Then the response arrives from the controller and the chip compares it against the
        // declaration the document carries
        await expect
          .poll(() => session.page.locator('.oref-run-verdict').textContent(), {
            timeout: 60_000,
          })
          .toBe('matches declared 200');
      } finally {
        await session.close();
      }
    },
    TIMEOUT,
  );
});

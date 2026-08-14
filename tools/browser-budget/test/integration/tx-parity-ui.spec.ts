import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootExampleApp, EXAMPLE_BASE_PATH, launchChrome } from '../../src/index';
import type { LaunchedChrome, SpawnedServer } from '../../src/index';
import type { Page } from 'playwright-core';

/**
 * The bench behaviour TX-PARITY-UI added, proved where a reader meets it.
 *
 * FOUR THINGS ONLY A BROWSER CAN SAY. The head carries the badge and the path; the JSON body
 * arrives prefilled and Reset returns to it after typing; `Ctrl Enter` sends, which is the
 * chord the hint beside Send promises; and the parameter the scan saw the application not
 * read is disabled with the reason in its placeholder, which is the SPEC 11 boundary of the
 * F14 rule: the capability is here, the fact is about the parameter.
 */

const TIMEOUT = 300_000;

const LIST_BENCH = `${EXAMPLE_BASE_PATH}/bench/get-orders`;
const CREATE_BENCH = `${EXAMPLE_BASE_PATH}/bench/post-orders`;

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

describe('the bench head', () => {
  it(
    'should carry the kicker, the badge and the path, per the layout',
    async () => {
      // Given the bench of the operation the README opens with
      const session = await open(LIST_BENCH);

      try {
        // Then the head is the operation's identity, not a prose title
        expect(await session.page.locator('.oref-bench-kicker').textContent()).toBe('Bench');
        expect(
          await session.page.locator('.oref-bench-page .oref-title .oref-badge').textContent(),
        ).toBe('GET');
        expect(
          await session.page.locator('.oref-bench-page .oref-title .oref-path').textContent(),
        ).toBe('/orders');
      } finally {
        await session.close();
      }
    },
    TIMEOUT,
  );
});

describe('the prefilled body and Reset', () => {
  it(
    'should arrive with the example JSON and return to it after typing',
    async () => {
      // Given the bench of the create operation, whose JSON body is the text editor
      const session = await open(CREATE_BENCH);
      const body = session.page.locator('#oref-field-body-text');

      try {
        // Then the body arrives prefilled with a parseable example, per SPEC 5.5's precedence
        const prefilled = (await body.inputValue()).trim();
        expect(prefilled).not.toBe('');
        expect(() => JSON.parse(prefilled) as unknown).not.toThrow();

        // When the reader types over it and presses Reset
        await body.fill('{ "broken": tru');
        await session.page.locator('.oref-tryit-reset').click();

        // Then the form is the prefilled one again
        expect((await body.inputValue()).trim()).toBe(prefilled);
      } finally {
        await session.close();
      }
    },
    TIMEOUT,
  );
});

describe('the Ctrl Enter chord', () => {
  it(
    'should send from the keyboard, which is what the hint beside Send promises',
    async () => {
      // Given a reader whose caret is in a field of the console
      const session = await open(LIST_BENCH);

      try {
        expect(await session.page.locator('.oref-kbd', { hasText: 'Ctrl Enter' }).count()).toBe(1);

        const field = session.page.locator('#oref-field-query-currency');
        await field.click();
        await field.press('Control+Enter');

        // Then the send runs against the real application and the verdict chip answers
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

describe('the unread parameter', () => {
  it(
    'should be disabled with the reason in its placeholder, per the SPEC 11 boundary',
    async () => {
      // Given the list bench, whose scan found six declarations nothing reads
      const session = await open(LIST_BENCH);
      const dead = session.page.locator('#oref-field-query-sort');
      const alive = session.page.locator('#oref-field-query-currency');

      try {
        // Then the fact about the parameter is on the field, in the scan's own words
        expect(await dead.isDisabled()).toBe(true);
        expect(await dead.getAttribute('placeholder')).toBe('not seen read by the handler');

        // And a parameter the handler reads stays an ordinary field
        expect(await alive.isDisabled()).toBe(false);
        expect(await alive.getAttribute('placeholder')).toBeNull();
      } finally {
        await session.close();
      }
    },
    TIMEOUT,
  );
});

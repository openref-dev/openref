import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootExampleApp, EXAMPLE_BASE_PATH, launchChrome } from '../../src/index';
import type { LaunchedChrome, SpawnedServer } from '../../src/index';
import type { Page } from 'playwright-core';

/**
 * Both halves of the shapes page, proved where a reader meets them, per SPEC 11 and TX-SHAPES.
 *
 * WHAT ONLY A BROWSER CAN SAY. The reading half is server markup and reads before any script
 * runs. The filling half is the value driven form behind its gate: a raw press on a branch
 * chooser has to open the gate, ride the replay, write the leading value and draw the branch;
 * a switch has to keep the hidden branch's values and announce what rebuilt in the
 * `role="status"` line; and `document.activeElement` has to stay on the pressed chooser
 * through the rebuild, which is the claim the standing rule sends here, because whether focus
 * survives a patch is decided by the engine.
 */

const TIMEOUT = 300_000;

const SHAPES = `${EXAMPLE_BASE_PATH}/shapes/PaymentInstruction`;

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

/** A raw mouse press at the element's own coordinates, below every actionability policy. */
async function pressWithTheMouse(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();

  const box = await target.boundingBox();
  if (box === null) throw new Error(`${selector} has no box to press`);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
}

/** The chooser button that writes one leading value. */
function chooserButton(label: string): string {
  return `.oref-shape-branch-opts .oref-seg-btn:has-text("${label}")`;
}

describe('the reading half', () => {
  it(
    'should read as every branch at once before any script runs, conditions in words',
    async () => {
      // Given the served markup alone
      const session = await open(SHAPES);

      try {
        const rows = session.page.locator('.oref-shapes-read .oref-shape-row');

        // Then the three conditional fields print their conditions, and none reads required
        const postal = rows.filter({ hasText: 'postalCode' });
        await expect
          .poll(async () => postal.locator('.oref-shape-when').textContent())
          .toBe('required only when country = US');
        await expect
          .poll(async () => postal.locator('.oref-shape-req').textContent())
          .toBe('conditional');

        await expect
          .poll(async () =>
            rows.filter({ hasText: 'threeDSecure' }).locator('.oref-shape-when').textContent(),
          )
          .toBe('required only when amountMinor > 5000');
        await expect
          .poll(async () =>
            rows.filter({ hasText: 'bankName' }).locator('.oref-shape-when').textContent(),
          )
          .toBe('required only when bic is present');

        // And every branch is present at once, the third level included
        for (const branch of ['card', 'bank_transfer', 'wallet', 'invoice', 'milestone']) {
          await expect
            .poll(async () =>
              session.page
                .locator(`.oref-shapes-read .oref-shape-variant .oref-shape-name`)
                .filter({ hasText: branch })
                .count(),
            )
            .toBeGreaterThan(0);
        }

        // And the tuple names its closed tail
        expect(
          await rows.filter({ hasText: 'geo' }).locator('.oref-shape-when').textContent(),
        ).toContain('no items beyond the tuple');
      } finally {
        await session.close();
      }
    },
    TIMEOUT,
  );
});

describe('the filling half', () => {
  it(
    'should draw a branch on the raw press that also loads the engine, keep hidden values, ' +
      'announce what rebuilt, and hold focus on the pressed chooser',
    async () => {
      // Given the served page, nothing mounted
      const session = await open(SHAPES);

      try {
        const page = session.page;

        // When the first gesture on the page is a raw press on the card chooser
        await pressWithTheMouse(page, chooserButton('card'));

        // Then the gate opens, the chunk arrives, the press replays, and the branch draws
        const pan = page.locator('#oref-field-shape--pan');
        await expect.poll(async () => pan.count()).toBe(1);
        await expect
          .poll(async () => page.locator('.oref-shape-announce').textContent())
          .toContain('Form rebuilt: branch card shown.');

        // When a value is typed into the branch and the reader switches away, with the
        // actionability press this time, the regression lock of the F14 class
        await pan.fill('4111 11');
        await page.locator(chooserButton('bank_transfer')).click();

        // Then the announce says what rebuilt and how much the map kept, in the recorded wording
        await expect
          .poll(async () => page.locator('.oref-shape-announce').textContent())
          .toContain(
            'Form rebuilt: branch card hidden, branch bank_transfer shown. ' +
              'Values kept from the hidden branch: 1.',
          );

        // And focus stays on the pressed chooser through the rebuild
        const focused = await page.evaluate(() => {
          const root = globalThis as unknown as {
            document: { activeElement: { textContent: string | null } | null };
          };
          return root.document.activeElement?.textContent ?? '';
        });
        expect(focused).toBe('bank_transfer');

        // And switching back shows the kept value: hiding erased nothing
        await page.locator(chooserButton('card')).click();
        await expect
          .poll(async () => page.locator('#oref-field-shape--pan').inputValue())
          .toBe('4111 11');
      } finally {
        await session.close();
      }
    },
    TIMEOUT,
  );

  it(
    'should explain a condition by the condition and a type by the type',
    async () => {
      // Given the engine, mounted by a press on a chooser
      const session = await open(SHAPES);

      try {
        const page = session.page;
        await pressWithTheMouse(page, chooserButton('card'));
        await expect.poll(async () => page.locator('#oref-field-shape--pan').count()).toBe(1);

        // When the reader writes the value the condition names
        await page.locator('#oref-field-shape--country').fill('US');

        // Then the missing conditional field is explained by the condition, in the recorded
        // teaching sentence, and never by the type
        await expect
          .poll(async () =>
            page.locator('.oref-shape-field', { hasText: 'postalCode' }).textContent(),
          )
          .toContain(
            'Required because country = US. This is a condition, not the type: ' +
              'with another value the field is optional.',
          );

        // And a wrong value is explained by its type, in the type's words
        await page.locator('#oref-field-shape--pan').fill('4111 11');
        await expect
          .poll(async () =>
            page
              .locator('.oref-shape-field', { hasText: 'pan' })
              .locator('.oref-shape-hint-error')
              .textContent(),
          )
          .toBe('Expected string, length 13 to 19.');
      } finally {
        await session.close();
      }
    },
    TIMEOUT,
  );

  it(
    'should reach the third level and add pattern keys under the pattern',
    async () => {
      // Given
      const session = await open(SHAPES);

      try {
        const page = session.page;

        // When the reader walks invoice, then milestone, then the schedule basis
        await pressWithTheMouse(page, chooserButton('invoice'));
        await page.locator(chooserButton('milestone')).click();
        await page.locator(chooserButton('by dates')).click();

        // Then the third level's field is drawn
        await expect
          .poll(async () => page.locator('#oref-field-shape--terms-schedule-dates').count())
          .toBe(1);

        // And the pattern block adds a key pair on its own control, checked as a key condition
        await page.locator('.oref-shape-add', { hasText: 'add key' }).click();
        const key = page.locator('.oref-shape-pair input').first();
        await key.fill('bad key');
        await expect
          .poll(async () => page.locator('.oref-shape-pattern').textContent())
          .toContain("the key's condition, not the value's type");
      } finally {
        await session.close();
      }
    },
    TIMEOUT,
  );
});

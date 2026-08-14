import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootExampleApp, launchChrome } from '../../src/index';
import type { LaunchedChrome, SpawnedServer } from '../../src/index';
import type { Page } from 'playwright-core';

/**
 * The two DOM modes of the Web Component, per the SPEC 10.3 table, on a real portal page with
 * a real external stylesheet, in a real browser.
 *
 * THE LIGHT DOM CASE IS THE ONE PROVED HARDEST, per the task: it is the mode most likely to be
 * quietly broken by a later change, because nothing about it fails loudly. The assertion is
 * the mode's defining consequence, computed style and not class lists: the portal's framework
 * paints the embedded links its own green, which no jsdom run can see. The shadow case asserts
 * the opposite consequence on the same selector, so the pair cannot both pass by accident.
 */

const TIMEOUT = 300_000;

let chrome: LaunchedChrome;
let app: SpawnedServer;

/**
 * The framework's own cursor on anchors, the probe both cases read.
 *
 * `cursor` rather than `color`, and the reason is the cascade itself: the theme styles its
 * links by class, and a class beats the framework's bare element selector wherever both
 * declare the same property, so a colour probe would measure specificity and not the mode.
 * No stylesheet of the reference declares `cursor` on an anchor, so in light DOM the
 * framework's rule is the only author rule and applies, and in shadow the browser default
 * `pointer` shows the boundary held. Both readings are distinct from each other and from the
 * theme, which is what a probe needs.
 */
const FRAMEWORK_CURSOR = 'help';

beforeAll(async () => {
  chrome = await launchChrome();
  app = await bootExampleApp();
}, TIMEOUT);

afterAll(async () => {
  await app.stop();
  await chrome.close();
}, TIMEOUT);

/** Opens a portal page and waits until the element reports itself embedded. */
async function openPortal(path: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await chrome.browser.newContext();
  const page = await context.newPage();
  await page.goto(`${app.url}${path}`, { waitUntil: 'load', timeout: 120_000 });
  await page.locator('openref-reference[data-oref-embedded]').waitFor({ timeout: 30_000 });
  return { page, close: () => context.close() };
}

describe('the Web Component in light DOM mode, inside a page with an external CSS framework', () => {
  it(
    'should render the reference with the host framework reaching in, which is the mode',
    async () => {
      // Given
      const { page, close } = await openPortal('/portal/light');

      try {
        // Then the embed rendered: the reference markup is page markup
        const link = page.locator('openref-reference a.oref-nav-item').first();
        await link.waitFor({ timeout: 30_000 });

        // And the framework's own rule reached it, computed rather than assumed: this is what
        // "global CSS applies" means in the table, and what shadow mode must not show
        // A string expression, because this program type checks under Node with no DOM lib,
        // and the code executes in the page, where the globals exist.
        const cursor = await page.evaluate(
          '(() => { const l = document.querySelector("openref-reference a.oref-nav-item"); return l ? getComputedStyle(l).cursor : null; })()',
        );
        expect(cursor).toBe(FRAMEWORK_CURSOR);
      } finally {
        await close();
      }
    },
    TIMEOUT,
  );
});

describe('the Web Component in shadow mode, on the same portal', () => {
  it(
    'should keep the host framework out, which is the isolation the table promises',
    async () => {
      // Given
      const { page, close } = await openPortal('/portal/shadow');

      try {
        // Then the embed rendered inside a shadow root
        const shadowed = await page.evaluate(
          '(() => { const host = document.querySelector("openref-reference"); return host !== null && host.shadowRoot !== null; })()',
        );
        expect(shadowed).toBe(true);

        // And the probe the light case read is the browser default here: the boundary held,
        // asserted rather than assumed
        const cursor = await page.evaluate(
          '(() => { const host = document.querySelector("openref-reference"); const link = host && host.shadowRoot ? host.shadowRoot.querySelector("a.oref-nav-item") : null; return link ? getComputedStyle(link).cursor : null; })()',
        );
        expect(cursor).toBe('pointer');

        // And the theme's faces were hoisted to the document head, where the font registry is
        const hoisted = await page.locator('head link[data-oref-embed-fonts]').count();
        expect(hoisted).toBeGreaterThan(0);
      } finally {
        await close();
      }
    },
    TIMEOUT,
  );
});

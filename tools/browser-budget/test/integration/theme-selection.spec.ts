import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootExampleApp, EXAMPLE_BASE_PATH, launchChrome } from '../../src/index';
import type { LaunchedChrome, SpawnedServer } from '../../src/index';
import type { ConsoleMessage, Page } from 'playwright-core';

/**
 * The browser case the T033 theme selection section named as its own done-when: a page served
 * by this module under a theme that overrides positions, asserted after hydration and not only
 * after the first paint.
 *
 * WHAT ONE PAGE PROVES HERE IS THE WHOLE DESIGN. The server rendered with the definition, so
 * the theme's markup is in the fetched HTML. The served module is the entry built with the
 * same definition, so the browser hydrates with the same overrides and patches nothing away.
 * A mismatch between the two halves is silent by nature, which is why the case listens for
 * Vue's hydration warnings instead of trusting the markup's survival alone: markup that
 * survived AND a console that said nothing is the pair the section asked for.
 */

const TIMEOUT = 300_000;

let chrome: LaunchedChrome;
let app: SpawnedServer;

/** The collection page, which draws the layout, the navigation and a node's positions. */
const LIST_PAGE = `${EXAMPLE_BASE_PATH}/get-orders`;

beforeAll(async () => {
  chrome = await launchChrome();
  app = await bootExampleApp('express', { OPENREF_THEME: 'telltale' });
}, TIMEOUT);

afterAll(async () => {
  await app.stop();
  await chrome.close();
}, TIMEOUT);

describe('the theme a host selects reaches both halves of one page', () => {
  it(
    'should serve the theme in the server half: its markup, its entry, its stylesheets',
    async () => {
      // Given
      const response = await fetch(`${app.url}${LIST_PAGE}`);
      const html = await response.text();

      // Then the layout override drew the page, not the reference's own shell
      expect(html).toContain('tt-shell');
      expect(html).not.toContain('oref-layout');

      // And the module the page loads is the entry built with the definition
      const module = /<script type="module" src="([^"]+)"/.exec(html)?.[1] ?? '';
      expect(module).toContain('/entry.');
      expect(module).not.toContain('/openref.');

      // And the stylesheets came from the definition's own assets.css: the fonts file of this
      // theme names the face no other stylesheet in the repository names
      const link = /<link rel="stylesheet" href="([^"]+fonts[^"]+)"/.exec(html)?.[1] ?? '';
      expect(link).not.toBe('');
      const fonts = await fetch(`${app.url}${link}`);
      expect(await fonts.text()).toContain('Martian Mono');
    },
    TIMEOUT,
  );

  it(
    'should keep the override after hydration, with the console saying nothing about it',
    async () => {
      // Given a real browser over the served page, listening for the failure mode that is
      // silent to a reader: Vue patching a mismatched position back to the reference's markup
      // logs a hydration warning and nothing else
      const context = await chrome.browser.newContext();
      const page: Page = await context.newPage();
      const warnings: string[] = [];
      page.on('console', (message: ConsoleMessage) => {
        if (/hydrat/i.test(message.text())) warnings.push(message.text());
      });

      try {
        await page.goto(`${app.url}${LIST_PAGE}`, { waitUntil: 'load', timeout: 120_000 });

        // When the entry has executed: the rail toggle is the layout's own interactive element,
        // so it answering a press is hydration having happened, not only markup being present
        const toggle = page.locator('.tt-rail-toggle');
        await toggle.waitFor({ state: 'attached', timeout: 30_000 });

        // Then the override is what the reader has after hydration
        expect(await page.locator('.tt-shell').count()).toBe(1);
        expect(await page.locator('.oref-layout').count()).toBe(0);
        expect(warnings).toEqual([]);
      } finally {
        await context.close();
      }
    },
    TIMEOUT,
  );
});

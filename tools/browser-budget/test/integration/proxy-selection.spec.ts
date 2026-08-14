import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootExampleApp, EXAMPLE_BASE_PATH, launchChrome } from '../../src/index';
import type { LaunchedChrome, SpawnedServer } from '../../src/index';
import type { Page, Request } from 'playwright-core';

/**
 * The browser case the `proxy-selection` capability debt named as its own done-when: a reader
 * presses Send on a page whose host turned the proxy on, and the request goes through
 * `<mount>/_proxy` rather than straight at the target.
 *
 * WHAT IS UNDER PROOF IS THE SELECTION, NOT THE FORWARD. T029 proved the SSRF policy with its
 * own suite, and that policy is exactly why this case cannot assert a 200: the example's API is
 * this same application on a loopback address, and a loopback target is refused by the defence,
 * fail closed, deliberately. Injecting a resolver into the demo to let the forward through
 * would be a hole kept open for a test, per the plants rule. So the case asserts the three
 * facts the wiring is responsible for: the browser sent the envelope to the proxy route and
 * nothing directly at the API, the console showed the reader the proxy's answer, and that
 * answer is the policy speaking, which proves the round trip end to end.
 *
 * EVERY PIECE IS THE SHIPPED ONE, per `first-minute.spec.ts`, whose gesture mechanics this
 * mirrors: the runner factory chunk is fetched by the press, reads `proxyPath` off the state
 * the server wrote, and builds the proxy transport.
 */

const TIMEOUT = 300_000;

let chrome: LaunchedChrome;
let app: SpawnedServer;

/** The collection page, where Send needs nothing filled in. */
const LIST_PAGE = `${EXAMPLE_BASE_PATH}/get-orders`;

beforeAll(async () => {
  chrome = await launchChrome();
  app = await bootExampleApp('express', { OPENREF_PROXY: '1' });
}, TIMEOUT);

afterAll(async () => {
  await app.stop();
  await chrome.close();
}, TIMEOUT);

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

  await page.goto(`${app.url}${path}`, { waitUntil: 'load', timeout: 120_000 });

  return {
    page,
    requests,
    violations,
    close: async () => {
      violations.push(...(await page.evaluate<string[]>('globalThis.__openrefCspViolations')));
      await context.close();
    },
  };
}

/** The press as a mouse gesture, for the reason `first-minute.spec.ts` states. */
async function pressWithTheMouse(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();

  const box = await target.boundingBox();
  if (box === null) throw new Error(`${selector} has no box to press`);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
}

describe('the shipped page selects the proxy', () => {
  it(
    'should carry the proxy path in the state the server wrote',
    async () => {
      // Given the served page of a host that turned the proxy on
      const response = await fetch(`${app.url}${LIST_PAGE}`);
      const html = await response.text();

      // Then the fact the runner factory reads is in the page, and it is the route the module
      // registered rather than a URL, so it cannot name another origin
      expect(html).toContain('"proxyPath":"/docs/_proxy"');
    },
    TIMEOUT,
  );

  it(
    'should send the press through the proxy route and show the reader the policy answering',
    async () => {
      // Given the collection page, untouched
      const session = await open(LIST_PAGE);

      try {
        // When the reader presses Send once, with the mouse, as the first gesture on the page
        await pressWithTheMouse(session.page, '.oref-send');

        // Then the console arrives, sends, and an outcome is rendered
        await expect
          .poll(() => session.page.locator('.oref-run-body, .oref-run-error').count(), {
            timeout: 30_000,
          })
          .toBeGreaterThan(0);

        // And the envelope went to the proxy route, and nothing went at the API directly
        const sent = session.requests.filter((url) => url.endsWith('/docs/_proxy'));
        const direct = session.requests.filter((url) => url.endsWith('/orders'));
        expect(sent.length).toBeGreaterThan(0);
        expect(direct).toEqual([]);

        // And what the reader sees is the proxy speaking: the example's own API is a loopback
        // address, which the SSRF policy refuses, fail closed, so the policy reaching the
        // reader IS the proof the round trip went through it
        const outcome = await session.page
          .locator('.oref-section-tryit')
          .textContent({ timeout: 10_000 });
        expect(outcome ?? '').toMatch(/loopback|proxy/i);
      } finally {
        await session.close();
        expect(session.violations).toEqual([]);
      }
    },
    TIMEOUT,
  );
});

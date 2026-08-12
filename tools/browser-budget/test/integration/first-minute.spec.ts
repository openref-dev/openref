import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootExampleApp, EXAMPLE_BASE_PATH, launchChrome } from '../../src/index';
import type { LaunchedChrome, SpawnedServer } from '../../src/index';
import type { Page, Request, Route } from 'playwright-core';

/**
 * SPEC 2's first minute, end to end, with nothing simulated.
 *
 * A real NestJS application, booted in its own process from the example in `examples/`. Its own
 * served HTML, in a real browser. Its own served bundle, executed by that browser's own module
 * loader. Then a reach for the console, a field filled, a click on Send, and a request that has
 * to arrive at the controller.
 *
 * EVERY PIECE IS THE SHIPPED ONE. The console has an integration test in `@openref/render` that
 * hands it a runner by hand, and that test passed for the whole of T013 while the bundle a reader
 * downloads had no runner in it at all. This one drives the built file, so the thing under test
 * is the artifact rather than the arrangement.
 *
 * IT MOVED HERE FROM `packages/nest` ON 2026-08-10, AND THE MOVE IS PART OF WHAT IT PROVES. It
 * used to run in jsdom, with the bundle evaluated through `node:vm`, which worked for exactly as
 * long as the bundle was one inlined file. T011-R made it a module graph, and jsdom executes no
 * ES modules at all: the shipped bytes could no longer be run by the thing that was checking
 * them. A real engine is not a workaround for that, it is where a claim about a module graph
 * belongs, and it buys three things the old arrangement could not have: the dynamic imports are
 * resolved by a browser, the strict policy is enforced by a browser, and the chunk plant below is
 * possible at all.
 *
 * THE CONSOLE IS REACHED FOR BEFORE IT IS USED, and that is the deferral rather than a
 * concession. The server renders the console disabled, because a page that has not loaded a
 * runner cannot send anything; the reader's first touch of the region fetches the console's chunk
 * and the runner with it. So the marker this test waits on is the send button becoming enabled,
 * never the button existing: a query for the element passes with the chunk never fetched.
 */

const TIMEOUT = 300_000;

let chrome: LaunchedChrome;
let app: SpawnedServer;

/** The operation page the example serves, which is the one carrying a console. */
const NODE_PAGE = `${EXAMPLE_BASE_PATH}/get-orders-id`;

beforeAll(async () => {
  chrome = await launchChrome();
  app = await bootExampleApp();
}, TIMEOUT);

// THE SAME TIMEOUT AS THE SETUP, per finding F20. Teardown had vitest's default ten seconds
// while the hook that boots a browser and a Nest application had five minutes, so under load the
// suite went red on the close rather than on anything it asserts. A flake here is the worst place
// for one: this is the test that proves the product's first promise.
afterAll(async () => {
  await app.stop();
  await chrome.close();
}, TIMEOUT);

/** One navigation, with the policy violations the browser reported. */
interface Session {
  readonly page: Page;
  readonly requests: string[];
  readonly violations: string[];
  close(): Promise<void>;
}

/**
 * Opens a page of the example.
 *
 * @param path - Absolute path on the application
 * @param blockLateModules - When set, every module the page asks for after its load event is
 *   answered 404. That is the chunk plant: the initial closure arrives, and nothing that is
 *   fetched because a reader reached for it does.
 * @returns The session
 */
async function open(path: string, blockLateModules = false): Promise<Session> {
  const context = await chrome.browser.newContext();
  const page = await context.newPage();
  const requests: string[] = [];
  const violations: string[] = [];
  let loaded = false;

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

  if (blockLateModules) {
    // THE PLANT IS A ROUTE AND NOT AN OPTION OF THE APPLICATION, per the rule `plants.ts` already
    // carries: a server that could be asked to lose a chunk would be an asset catalog with a hole
    // in it, kept open for a test, and the next reader could not tell that hole from a defect.
    await page.route('**/*.js', async (route: Route) => {
      if (loaded) {
        await route.fulfill({ status: 404, body: 'planted: this chunk is not in the catalog' });
        return;
      }
      await route.continue();
    });
  }

  const response = await page.goto(`${app.url}${path}`, { waitUntil: 'load', timeout: 120_000 });
  loaded = true;

  // THE PAGE IS ASSERTED PRESENT HERE, per SPEC 0. The cases below assert that no violation was
  // reported, that nothing left the origin and that no error was rendered, and an error page
  // answers all three by loading nothing. The chunk plant is deliberately not covered by this:
  // it 404s later modules on purpose, and the navigation itself still has to succeed.
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

/**
 * Reaches for the try-it console the way a reader does, and waits for it to arrive.
 *
 * @param page - The open page
 */
async function reachForTheConsole(page: Page): Promise<void> {
  await page.locator('.oref-section-tryit').click({ position: { x: 4, y: 4 } });
}

/**
 * Presses one element with the mouse, at its own coordinates, with no actionability check.
 *
 * NOT `locator.click`, AND THAT IS THE POINT OF THE CASE BELOW. Playwright reads
 * `aria-disabled` as disabled and waits for a control carrying it to become enabled, so the
 * gesture F14 is about, a reader pressing Send while the console is still the server's markup,
 * cannot be expressed through the locator API at all: it would wait for the state the press is
 * supposed to produce. The browser has no such policy, so the press is driven through the mouse
 * where the element actually is.
 *
 * @param page - The open page
 * @param selector - What to press
 */
async function pressWithTheMouse(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();

  const box = await target.boundingBox();
  if (box === null) throw new Error(`${selector} has no box to press`);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
}

describe('the first minute', () => {
  it(
    'should serve a page that already reads as documentation before any script runs',
    async () => {
      // Given, the server rendered markup, which is what a reader without JavaScript gets
      const response = await fetch(`${app.url}${NODE_PAGE}`);
      const html = await response.text();

      // Then
      expect(html).toContain('Read one order');
      expect(html).toContain('oref-app');
    },
    TIMEOUT,
  );

  it(
    'should hydrate the served markup with the served module graph',
    async () => {
      // Given
      const session = await open(NODE_PAGE);

      try {
        // Then the console's region is in the document, server rendered and not yet hydrated
        await expect.poll(() => session.page.locator('.oref-section-tryit').count()).toBe(1);
        expect(await session.page.locator('.oref-send').isDisabled()).toBe(true);
      } finally {
        await session.close();
        // A CHUNKED MODULE GRAPH UNDER THE STRICT POLICY. `script-src 'self' 'nonce-...'` has to
        // admit the static chunk imports the entry names, and nothing had demonstrated that until
        // the bundle was split.
        expect(session.violations).toEqual([]);
      }
    },
    TIMEOUT,
  );

  it(
    'should bring the console and its runner when the reader reaches for them',
    async () => {
      // Given
      const session = await open(NODE_PAGE);

      try {
        const before = session.requests.length;

        // When
        await reachForTheConsole(session.page);

        // Then the console arrives enabled, which is the whole of T014 read through the chunk
        await expect
          .poll(() => session.page.locator('.oref-send').isDisabled(), { timeout: 30_000 })
          .toBe(false);

        // And it arrived by fetching something, from this origin, after the reach and not before
        const late = session.requests.slice(before);
        expect(late.length).toBeGreaterThan(0);
        expect(late.filter((url) => !url.startsWith(app.url))).toEqual([]);
      } finally {
        await session.close();
        // THE DYNAMIC IMPORT UNDER THE STRICT POLICY, which is the half the study cannot reach:
        // no reader touches a deferred feature during a measurement run.
        expect(session.violations).toEqual([]);
      }
    },
    TIMEOUT,
  );

  it(
    'should answer the reader who reaches for the console by pressing Send',
    async () => {
      // Given a page nobody has touched, and a reader who fills nothing in and presses the one
      // control the console is for. THIS IS F14, and this file is where it can fail: the
      // suppression of a click on a disabled control is a browser behaviour, and a dispatched
      // event in jsdom reaches the listener either way.
      const session = await open(NODE_PAGE);

      try {
        // When they press it once
        await pressWithTheMouse(session.page, '.oref-send');

        // Then the console arrived on that press, and acted on it. `id` is a required path
        // parameter and is empty, so the runner refuses, and a refusal is something only the
        // click handler can have produced. Before the fix the chunk arrived on the pointerdown,
        // the browser generated no click on the disabled button, and the reader got a console
        // that had woken up and done nothing.
        await expect
          .poll(() => session.page.locator('.oref-run-error').count(), { timeout: 30_000 })
          .toBe(1);
        expect(await session.page.locator('.oref-run-error').textContent()).toContain('required');
      } finally {
        await session.close();
        expect(session.violations).toEqual([]);
      }
    },
    TIMEOUT,
  );

  it(
    'should leave the console dead when its chunk is not in the catalog',
    async () => {
      // Given the same page with the plant: everything the first paint asked for arrived, and
      // every module fetched after that answers 404.
      const session = await open(NODE_PAGE, true);

      try {
        // When the reader reaches for the console
        await reachForTheConsole(session.page);
        await session.page.waitForTimeout(3_000);

        // Then it never becomes usable. THIS IS THE PLANT FOR THE CASE ABOVE: without it, a
        // console that was enabled by the server, or a marker that matched the disabled button,
        // would pass that case with no chunk ever fetched.
        expect(await session.page.locator('.oref-send').isDisabled()).toBe(true);
      } finally {
        await session.close();
      }
    },
    TIMEOUT,
  );

  it(
    'should reach the controller when the reader fills a field and sends',
    async () => {
      // Given a reader who has opened the console
      const session = await open(NODE_PAGE);

      try {
        await reachForTheConsole(session.page);
        await expect
          .poll(() => session.page.locator('.oref-send').isDisabled(), { timeout: 30_000 })
          .toBe(false);

        // When they fill the path parameter and send
        await session.page.locator('.oref-tryit-form input[id*="path"]').fill('ord_1024');
        await session.page.locator('.oref-send').click();

        // Then the controller answered, and the answer is on the page
        await expect
          .poll(() => session.page.locator('.oref-run-body').textContent(), { timeout: 30_000 })
          .toContain('ord_1024');
        // SCOPED TO THE RUN RESULT, because the operation's own documented 200 response carries
        // the same class. An unscoped selector here would pass on the response the page has
        // rendered since before any script ran, which is the answer to a different question.
        expect(
          await session.page.locator('.oref-run-summary .oref-status').textContent(),
        ).toContain('200');
        expect(await session.page.locator('.oref-run-error').count()).toBe(0);
      } finally {
        await session.close();
        expect(session.violations).toEqual([]);
      }
    },
    TIMEOUT,
  );
});

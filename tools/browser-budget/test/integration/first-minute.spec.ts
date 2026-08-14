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

/** The bench page carrying a console whose path parameter is required and empty. */
const NODE_PAGE = `${EXAMPLE_BASE_PATH}/bench/get-orders-id`;

/**
 * The bench a reader reaches from the page they open first, the collection.
 *
 * IT IS HERE BECAUSE THE PAGE THE PROOF USED WAS NOT THE PAGE THE READER LOOKED AT. F14 was
 * reported as unfixed on 2026-08-12 and it is fixed; the press was proved on `get-orders-id`,
 * whose one path parameter is required and empty, so what the case asserts is the runner's
 * refusal. A refusal proves the click handler ran. It does not prove that a reader who presses
 * Send gets an answer, and `get-orders` needs nothing filled in, so on its bench the same
 * gesture is a whole request. Two pages, two outcomes, one gesture. THE CONSOLE LIVES ON THE
 * BENCH ADDRESS SINCE TX-FRAME, per SPEC 13.3: the operation page carries the bench tab, and
 * the gesture this file proves is proved on the page that now holds the button.
 */
const LIST_PAGE = `${EXAMPLE_BASE_PATH}/bench/get-orders`;

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
 * @param plant - `block` answers every module asked for after the load event with a 404: the
 *   initial closure arrives, and nothing fetched because a reader reached for it does, which
 *   since SPEC 11's second half makes the region fail loudly. `delay` holds those modules for
 *   ten seconds instead: nothing fails, and the deferred state stands still long enough to be
 *   read, which is what the keyboard case needs and a 404 can no longer give it.
 * @returns The session
 */
async function open(path: string, plant?: 'block' | 'delay'): Promise<Session> {
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

  if (plant !== undefined) {
    // THE PLANT IS A ROUTE AND NOT AN OPTION OF THE APPLICATION, per the rule `plants.ts` already
    // carries: a server that could be asked to lose a chunk would be an asset catalog with a hole
    // in it, kept open for a test, and the next reader could not tell that hole from a defect.
    await page.route('**/*.js', async (route: Route) => {
      if (!loaded) {
        await route.continue();
        return;
      }
      if (plant === 'block') {
        await route.fulfill({ status: 404, body: 'planted: this chunk is not in the catalog' });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      // The context is usually gone by the time the hold ends, and that is the point: the
      // module was never refused, only never awaited.
      await route.continue().catch(() => undefined);
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
 * THE LOWER OF THE TWO PIPELINES SPEC 11 REQUIRES THE PRESS TO BE PROVED ON. This one injects
 * raw pointer input below every policy, so it proves the event path: gate, chunk, replay,
 * send. The other pipeline is `locator.click` with its actionability check left on, which
 * refuses a control declaring itself disabled; that press is the regression lock for the
 * 2026-08-14 finding, where the served button's `aria-disabled` made every state-respecting
 * pipeline discard the gesture the notice names, and it has its own case below.
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
        // Then the console's region is in the document, server rendered and not yet hydrated:
        // the load sentence stands beside an enabled Send, which is the served state since the
        // SPEC 11 rewrite, and only the console mounting removes it.
        await expect.poll(() => session.page.locator('.oref-section-tryit').count()).toBe(1);
        expect(await session.page.locator('.oref-send').isDisabled()).toBe(false);
        expect(await session.page.locator('#oref-tryit-notice').textContent()).toBe(
          'The console loads when you press Send.',
        );
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

        // Then the console arrives, marked by the load sentence vanishing, which is the whole
        // of T014 read through the chunk. The button's attributes mark nothing since the SPEC
        // 11 rewrite: served and live ready are both enabled, and only the notice separates
        // them.
        await expect
          .poll(() => session.page.locator('#oref-tryit-notice').count(), { timeout: 30_000 })
          .toBe(0);
        expect(await session.page.locator('.oref-send').isDisabled()).toBe(false);

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
    'should answer a reader who presses Send on the page they arrived at, with a response',
    async () => {
      // Given the collection page, untouched, which is the one the defect was reported against
      const session = await open(LIST_PAGE);

      try {
        // Then the notice beside Send names the action rather than promising a state the reader
        // will never see arrive: the shell is interactive within a moment of the load and this
        // sentence is removed by the console mounting, which happens only when somebody reaches
        // for it. SPEC 11.
        const notice = session.page.locator('.oref-section-tryit .oref-tryit-notice');
        expect(await notice.textContent()).toBe('The console loads when you press Send.');

        // When they press Send once, with the mouse, as the first gesture on the page
        await pressWithTheMouse(session.page, '.oref-send');

        // Then the console arrived on that press and sent the request, and the controller
        // answered. Nothing was filled in, because nothing on this operation is required.
        await expect
          .poll(() => session.page.locator('.oref-run-body').count(), { timeout: 30_000 })
          .toBe(1);
        expect(
          await session.page.locator('.oref-run-summary .oref-status').textContent(),
        ).toContain('200');
        expect(await session.page.locator('.oref-run-error').count()).toBe(0);

        // And the notice is gone rather than still standing beside a console that is now live
        expect(await notice.count()).toBe(0);
      } finally {
        await session.close();
        expect(session.violations).toEqual([]);
      }
    },
    TIMEOUT,
  );

  it(
    'should answer the same press when it comes through a pipeline that honours declared state',
    async () => {
      // Given the same untouched page. THIS IS THE 2026-08-14 FINDING'S REGRESSION LOCK. The
      // raw mouse press above injects input below every policy, so it stayed green while the
      // served button declared itself disabled through `aria-disabled`, and every pipeline
      // that respects a declared state, assistive technology announcing the control,
      // automation with its actionability check, refused the gesture the notice names. This
      // press goes through `locator.click` with that check left on: on the old markup it
      // refuses to press at all, so this case cannot pass unless the served button is the
      // honest enabled control SPEC 11 now requires.
      const session = await open(LIST_PAGE);

      try {
        // When they press Send once, through the checked pipeline
        await session.page.locator('.oref-send').click({ timeout: 15_000 });

        // Then the console arrived on that press and the controller answered
        await expect
          .poll(() => session.page.locator('.oref-run-body').count(), { timeout: 30_000 })
          .toBe(1);
        expect(
          await session.page.locator('.oref-run-summary .oref-status').textContent(),
        ).toContain('200');
      } finally {
        await session.close();
        expect(session.violations).toEqual([]);
      }
    },
    TIMEOUT,
  );

  it(
    'should give a reader who reaches Send by keyboard the sentence beside it',
    async () => {
      // Given the page a reader arrives at, with the delay plant on, and the second half of
      // F14: the served button is an ordinary enabled control since the SPEC 11 rewrite, so a
      // keyboard reader tabs onto it the way they tab onto any button, and what they must be
      // handed there is the sentence naming what a press does. This is a browser question
      // rather than a tree question: which controls tab reaches is decided by the user agent.
      //
      // THE PLANT IS WHAT MAKES THE STATE HOLD STILL, and it is the delay flavour on purpose.
      // The console's gate listens for `focusin` as well as for a press, so a reader tabbing
      // towards Send passes through ten fields and arms the loader on the first of them.
      // Without a plant this case is a race between the chunk and the remaining tab presses;
      // with the 404 plant it is a different state entirely since SPEC 11's second half, the
      // failed load disables the region's buttons and tab skips a disabled Send, which the
      // failure case below asserts on purpose. Held modules fail nothing and arrive never,
      // which is exactly a deferred console standing still.
      const session = await open(LIST_PAGE, 'delay');

      try {
        // When they tab, one press per attempt, until the focus is on Send. THE PRESS AND THE
        // READING ARE ONE ATTEMPT ON PURPOSE: hydration replaces the element the focus was on,
        // so a reach asserted in one call and read in the next is a reach that can be true and
        // gone by the time it is read.
        let described = 'the keyboard never reached Send';

        for (let press = 0; press < 60; press += 1) {
          await session.page.keyboard.press('Tab');

          // Then the focused control carries its description, and the description is the notice
          // itself rather than a second copy of the sentence written for a screen reader, which
          // would be a string free to drift from the visible one.
          const state = await session.page.evaluate(() => {
            // The DOM is described here rather than imported, the way `frame.spec.ts` does it:
            // this package compiles against Node's libraries and this callback runs in Chrome.
            interface ElementLike {
              readonly classList: { contains(name: string): boolean };
              readonly textContent: string | null;
              getAttribute(name: string): string | null;
            }
            const root = globalThis as unknown as {
              document: {
                readonly activeElement: ElementLike | null;
                getElementById(id: string): ElementLike | null;
              };
            };

            const send = root.document.activeElement;
            if (send?.classList.contains('oref-send') !== true) return null;

            const id = send.getAttribute('aria-describedby') ?? '';

            return root.document.getElementById(id)?.textContent ?? 'no description';
          });

          if (state !== null) {
            described = state;
            break;
          }
        }

        expect(described).toBe('The console loads when you press Send.');
      } finally {
        await session.close();
        expect(session.violations).toEqual([]);
      }
    },
    TIMEOUT,
  );

  it(
    'should list the console fields in the order the parameter table lists them',
    async () => {
      // Given the operation with ten parameters, nine of them query and one a header written
      // among them. The table groups by location and the form used to follow the document, so
      // the header field sat in the middle of the query fields. The two surfaces live on two
      // pages since TX-FRAME, the table on the operation and the form on its bench, which is
      // exactly why one named order matters: the reader crosses a page between reading and
      // filling.
      const session = await open(`${EXAMPLE_BASE_PATH}/get-orders`);

      try {
        // When the table is read off the operation page
        const table = await session.page.locator('.oref-param-name code').allTextContents();

        // And the form is read off the bench
        await session.page.goto(`${app.url}${LIST_PAGE}`, { waitUntil: 'load' });
        await reachForTheConsole(session.page);
        await expect
          .poll(() => session.page.locator('#oref-tryit-notice').count(), { timeout: 30_000 })
          .toBe(0);
        const form = await session.page
          .locator('.oref-tryit-form .oref-field-label')
          .allTextContents();

        // Then they are one order. `Server` is the console's own field and is not a parameter.
        expect(table.length).toBeGreaterThan(1);
        expect(form.filter((label) => label !== 'Server')).toEqual(table);
      } finally {
        await session.close();
        expect(session.violations).toEqual([]);
      }
    },
    TIMEOUT,
  );

  it(
    'should keep a schema in the order its author wrote it when a reader expands one',
    async () => {
      // Given the schema page for an address, whose fields are in the order an address reads.
      // The server draws the tree from the model in memory and the browser draws it from the
      // page's JSON, so a payload with its keys sorted makes the tree reorder itself under a
      // reader who opens a position, and the order it reorders into is alphabetical. Only a
      // browser can fail this: the server markup is right either way.
      const session = await open(`${EXAMPLE_BASE_PATH}/schema/AddressDto`);
      const authored = ['AddressDto', 'line1', 'city', 'postalCode', 'country', 'geo'];
      const names = (): Promise<string[]> =>
        session.page.locator('.oref-schema-name').allTextContents();

      try {
        // Then the served markup is the author's order
        expect(await names()).toEqual(authored);

        // When the reader opens a position, which is the first client render of the tree
        await session.page.locator('.oref-schema-row[data-oref-path="AddressDto/geo"]').click();
        await session.page.waitForTimeout(500);

        // Then the five fields are still in the order the author wrote them
        expect((await names()).slice(0, authored.length)).toEqual(authored);
      } finally {
        await session.close();
        expect(session.violations).toEqual([]);
      }
    },
    TIMEOUT,
  );

  it(
    'should say the console failed to load when its chunk is not in the catalog',
    async () => {
      // Given the same page with the plant: everything the first paint asked for arrived, and
      // every module fetched after that answers 404.
      const session = await open(NODE_PAGE, 'block');

      try {
        // When the reader reaches for the console
        await reachForTheConsole(session.page);

        // Then the failure is words in the region rather than silence, per SPEC 11's second
        // half: the served button is a real enabled control now, so a chunk that never arrives
        // would otherwise leave a pressable Send that does nothing, which is the reading F14
        // exists to forbid. THIS IS ALSO THE PLANT FOR THE CASES ABOVE: a marker that matched
        // the served markup would pass them with no chunk ever fetched, and the load sentence
        // vanishing they poll for only happens when the chunk really mounts.
        await expect
          .poll(() => session.page.locator('.oref-section-tryit .oref-embed-error').count(), {
            timeout: 30_000,
          })
          .toBe(1);
        expect(
          await session.page.locator('.oref-section-tryit .oref-embed-error').textContent(),
        ).toContain('The console failed to load');
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
          .poll(() => session.page.locator('#oref-tryit-notice').count(), { timeout: 30_000 })
          .toBe(0);

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

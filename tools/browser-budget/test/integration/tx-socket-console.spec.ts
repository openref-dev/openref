import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootFixture, CHANNEL_GREETING, FIXTURE_BASE_PATH, launchChrome } from '../../src/index';
import type { BootedFixture, LaunchedChrome } from '../../src/index';
import type { Locator, Page, Route } from 'playwright-core';

/**
 * The socket console of SPEC 14.7, proved where a reader presses it, per `TX-SOCKET-CONSOLE`.
 *
 * WHAT ONLY A BROWSER CAN SAY, AND IT IS THE ONE CLAIM THE `T065` SECTION LEFT OPEN. The console's
 * own behaviour is proved on a real mount in jsdom, in `packages/render`, with a doubled port; what
 * that suite cannot reach is whether a raw press on the served region opens the deferral gate,
 * fetches the chunk the engine travels in, replays the press into the control that has just
 * mounted, and gets a socket the browser itself opened. Every one of those four is decided by an
 * engine, so by the standing rule they are decided here.
 *
 * THE SUBJECT IS ASSERTED PRESENT BEFORE ANYTHING IS PROVED ABOUT IT. The first case reads the
 * served markup with no browser at all: the region, its three controls, its six figures at zero and
 * the address the reader is shown. A press proved on a page with no console would be a press
 * proved on nothing, and a count of zero would pass every later assertion by absence.
 *
 * THE DOCUMENT IS THE HARNESS'S OWN AND NOT `examples/events`, WHICH IS MEASURED RATHER THAN
 * PREFERRED. That example mounts its events reference through `forRoot({ documents })` beside an
 * HTTP reference mounted through `setup`, and as of this tree it serves no channel page at all: the
 * findings are written into the `T065` section this file closes. So the channel document is the
 * fixture's fourth, built and served the way the other three are, and the socket on the other end
 * of the handshake is the fixture's own so that `connect-src 'self'` admits it.
 */

const TIMEOUT = 300_000;

/**
 * The channel page, whose node id the normalizer derives from the channel's address.
 *
 * PINNED IN `test/unit/specification.spec.ts` AS WELL, for the reason `TTI_PAGE` is: a route
 * written out by hand beside a generated document are two facts that can disagree, and the cheap
 * suite should say so before a browser run does.
 */
const CHANNEL_PAGE = `${FIXTURE_BASE_PATH}/channel-orders-created`;

/** The console's own region, which is the subject of every case in this file. */
const CONSOLE = '.oref-section-socket';

let chrome: LaunchedChrome;
let app: BootedFixture;

beforeAll(async () => {
  chrome = await launchChrome();
  app = await bootFixture('channel');
}, TIMEOUT);

afterAll(async () => {
  await app.stop();
  await chrome.close();
}, TIMEOUT);

/** One navigation, with what it fetched and what the policy refused. */
interface Session {
  readonly page: Page;
  readonly requests: string[];
  readonly violations: string[];
  close(): Promise<void>;
}

/**
 * Opens the channel page.
 *
 * @param plant - `block` answers every module asked for after the load event with a 404, which is
 *   how the wiring is broken: the first paint arrives whole and nothing a reader reaches for does.
 * @returns The session
 */
async function open(plant?: 'block'): Promise<Session> {
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

  page.on('request', (request) => {
    requests.push(request.url());
  });

  if (plant !== undefined) {
    await page.route('**/*.js', async (route: Route) => {
      if (!loaded) {
        await route.continue();
        return;
      }
      await route.fulfill({ status: 404, body: 'planted: this chunk is not in the catalog' });
    });
  }

  const response = await page.goto(`${app.url}${CHANNEL_PAGE}`, {
    waitUntil: 'load',
    timeout: 120_000,
  });
  loaded = true;

  // THE PAGE IS ASSERTED PRESENT HERE, per SPEC 0, and the region with it. Everything below is
  // about one region of one page, and an error page carries neither while answering quickly.
  expect(response?.status()).toBe(200);
  expect(await page.locator('#oref-app').count()).toBe(1);
  expect(await page.locator(CONSOLE).count()).toBe(1);

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

/** A raw mouse press at the element's own coordinates, below every actionability policy. */
async function pressWithTheMouse(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();

  const box = await target.boundingBox();
  if (box === null) throw new Error('the target has no box to press');

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
}

/**
 * One of the console's three controls, by the word printed on it.
 *
 * BY ROLE AND EXACT NAME RATHER THAN BY POSITION OR BY SUBSTRING. All three carry `oref-send`,
 * `Disconnect` contains `connect`, and the order they are drawn in is not a contract; the word a
 * reader reads is.
 */
function control(page: Page, name: 'Connect' | 'Reconnect' | 'Disconnect' | 'Send'): Locator {
  return page.locator(CONSOLE).getByRole('button', { name, exact: true });
}

/**
 * The console's figures, by the label it prints beside each.
 *
 * THE DOM IS NAMED STRUCTURALLY AND NOT IMPORTED, the shape `tx-shapes.spec.ts` uses: this package
 * compiles without the DOM lib, deliberately, so a page function declares the two methods it
 * touches instead of depending on a global type.
 */
async function figures(page: Page): Promise<Record<string, string>> {
  return page.evaluate((selector: string) => {
    interface Readable {
      querySelector(query: string): { readonly textContent: string | null } | null;
    }
    interface Region {
      querySelectorAll(query: string): readonly Readable[];
    }

    const root = globalThis as unknown as {
      document: { querySelector(query: string): Region | null };
    };

    const counts: Record<string, string> = {};
    const region = root.document.querySelector(selector);
    if (region === null) return counts;

    for (const row of region.querySelectorAll('.oref-fact')) {
      const label = row.querySelector('.oref-fact-label')?.textContent ?? '';
      counts[label] = row.querySelector('.oref-fact-value')?.textContent ?? '';
    }

    return counts;
  }, CONSOLE);
}

/** Which of a page's requests named one of the chunks the console travels in. */
function chunksNaming(requests: readonly string[], name: string): string[] {
  return requests.filter((url) => url.includes(`/${name}-`) && url.endsWith('.js'));
}

describe('the console a reader is served', () => {
  it(
    'should carry its controls, its six figures and the joined address before any script runs',
    async () => {
      // Given the served markup alone, which is what a reader without JavaScript gets
      const markup = await (await fetch(`${app.url}${CHANNEL_PAGE}`)).text();

      // Then the region is there, in its idle state, with the sentence the engine's `idle` means
      expect(markup).toContain('oref-section-socket');
      expect(markup).toContain('Not connected.');

      // And the address is the server's joined with the channel's, per SPEC 8.2, which is the
      // address the fixture's own socket answers on
      expect(app.socketAddress).toBeDefined();
      expect(markup).toContain(app.socketAddress ?? 'no address was reported');

      // And all six figures are drawn at zero, rather than five or none
      const zeroes = markup.match(/<span class="oref-fact-value">0<\/span>/g) ?? [];
      expect(zeroes.length).toBeGreaterThanOrEqual(6);

      // And the window is empty, which is what there is to see before a session exists
      expect(markup).toContain('<ol class="oref-run-result oref-socket-log"></ol>');
    },
    TIMEOUT,
  );
});

describe('the press', () => {
  it(
    'should open the gate, fetch the engine, replay the press and open a socket the reader sees',
    async () => {
      // Given the served page, nothing mounted and nothing of the console fetched
      const session = await open();

      try {
        const page = session.page;
        expect(chunksNaming(session.requests, 'SocketConsole')).toEqual([]);
        expect(chunksNaming(session.requests, 'socket-factory')).toEqual([]);
        const before = session.requests.length;

        // When the first gesture on the page is a raw press on Connect
        await pressWithTheMouse(page, control(page, 'Connect'));

        // Then the session opened, which only the click handler of a mounted console can do, so
        // the gate opened, the chunk arrived and the press was replayed into it
        await expect
          .poll(async () => page.locator(`${CONSOLE} .oref-tryit-notice`).textContent(), {
            timeout: 60_000,
          })
          .toBe('Connected.');

        // And the two chunks the console and its engine travel in were fetched by that press,
        // from this origin, after the reach and not before
        const late = session.requests.slice(before);
        expect(chunksNaming(late, 'SocketConsole').length).toBe(1);
        expect(chunksNaming(late, 'socket-factory').length).toBe(1);
        expect(late.filter((url) => !url.startsWith(app.url))).toEqual([]);

        // And what the reader sees is the engine's own state: one attempt, and the message the
        // server pushed the moment the socket opened, counted as received
        await expect
          .poll(async () => (await figures(page)).received, { timeout: 30_000 })
          .toBe('1');
        expect((await figures(page)).attempts).toBe('1');
        expect(await page.locator(`${CONSOLE} .oref-socket-entry`).count()).toBe(1);
        expect(await page.locator(`${CONSOLE} .oref-socket-entry code`).textContent()).toBe(
          CHANNEL_GREETING,
        );

        // And the two controls a session makes usable are usable now
        expect(await control(page, 'Send').isDisabled()).toBe(false);
      } finally {
        await session.close();
        // THE DYNAMIC IMPORT AND THE SOCKET UNDER THE STRICT POLICY. `connect-src 'self'` has to
        // admit a socket to the origin the page came from, and nothing else here may be refused.
        expect(session.violations).toEqual([]);
      }
    },
    TIMEOUT,
  );

  it(
    'should carry the message the reader wrote onto the wire and back into the window',
    async () => {
      // Given a reader who opened the session with the same raw press
      const session = await open();

      try {
        const page = session.page;
        await pressWithTheMouse(page, control(page, 'Connect'));
        await expect
          .poll(async () => page.locator(`${CONSOLE} .oref-tryit-notice`).textContent(), {
            timeout: 60_000,
          })
          .toBe('Connected.');

        // When they write a message and press Send, this time through the actionability
        // pipeline, which refuses a control that declares itself disabled
        await page.locator(`${CONSOLE} textarea`).fill('{"id":"ord_2048"}');
        await control(page, 'Send').click();

        // Then the engine counted one sent, and the echo came back as a second received
        await expect.poll(async () => (await figures(page)).sent, { timeout: 30_000 }).toBe('1');
        await expect
          .poll(async () => (await figures(page)).received, { timeout: 30_000 })
          .toBe('2');

        // And both directions are in the window the engine publishes, marked as what they are
        const entries = page.locator(`${CONSOLE} .oref-socket-entry`);
        await expect.poll(async () => entries.count()).toBe(3);
        expect(await entries.nth(1).locator('.oref-badge').textContent()).toBe('send');
        expect(await entries.nth(1).locator('code').textContent()).toBe('{"id":"ord_2048"}');
        expect(await entries.nth(2).locator('.oref-badge').textContent()).toBe('receive');
        expect(await entries.nth(2).locator('code').textContent()).toBe('{"id":"ord_2048"}');

        // And the composer was emptied, which is the console saying the draft left the page
        expect(await page.locator(`${CONSOLE} textarea`).inputValue()).toBe('');
      } finally {
        await session.close();
        expect(session.violations).toEqual([]);
      }
    },
    TIMEOUT,
  );

  it(
    'should say the console failed to load and open nothing when its chunk is not in the catalog',
    async () => {
      // Given the same page with the wiring broken: the first paint arrived whole, and every
      // module a reader reaches for answers 404
      const session = await open('block');

      try {
        const page = session.page;

        // When the reader presses Connect exactly as they did above
        await pressWithTheMouse(page, control(page, 'Connect'));

        // Then the region says so in words, per SPEC 11's second half
        await expect
          .poll(() => page.locator(`${CONSOLE} .oref-embed-error`).count(), { timeout: 60_000 })
          .toBe(1);
        expect(await page.locator(`${CONSOLE} .oref-embed-error`).textContent()).toContain(
          'The socket console failed to load',
        );

        // And nothing was opened: the press reached no control, so the state a reader reads is
        // still the served one. THIS IS THE FALSIFICATION OF THE TWO CASES ABOVE. A marker that
        // matched the served markup would pass them with no chunk ever fetched; `Connected.`,
        // the counters and the entries only exist when the chunk really mounts and the replayed
        // press really reaches it.
        expect(await page.locator(`${CONSOLE} .oref-tryit-notice`).textContent()).toBe(
          'Not connected.',
        );
        expect((await figures(page)).received).toBe('0');
        expect((await figures(page)).attempts).toBe('0');
        expect(await page.locator(`${CONSOLE} .oref-socket-entry`).count()).toBe(0);
      } finally {
        await session.close();
      }
    },
    TIMEOUT,
  );
});

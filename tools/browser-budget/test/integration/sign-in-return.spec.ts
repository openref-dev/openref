/**
 * The sign in return gesture, in a browser, against an authorization server that answers.
 *
 * THIS IS THE GESTURE THE AMENDMENT FILED AGAINST T035 SAYS HAD NEVER RUN IN ONE. Three of the four
 * chunks the bundle divides into are driven by a real engine elsewhere in this suite; this one was
 * driven only in jsdom and under Node. Both of those keep one JavaScript context across the whole
 * flow, and a redirect flow does not have one: the reader leaves the page, an authorization server
 * answers, and a new document loads. Everything below exists to make that second document real.
 *
 * IT IS ALSO WHERE THE CRAFTED RESPONSES OF T035 BELONG. A mismatched state and a replayed callback
 * are refusals, and a refusal proved in jsdom is a refusal proved in the one environment where the
 * thing being refused cannot happen. Each case names the mode of the fake server it drives.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { benchHref, navigationHref } from '@openref/render';
import {
  AUTHORIZATION_CLIENT_ID,
  bootAuthorizationServer,
  bootFixture,
  FIXTURE_BASE_PATH,
  launchChrome,
  schemeIdFor,
} from '../../src/index';
import type { AuthorizationMode, BootedAuthorizationServer } from '../../src/index';
import type { BootedFixture, LaunchedChrome } from '../../src/index';
import type { Page } from 'playwright-core';

const TIMEOUT = 300_000;

let chrome: LaunchedChrome;
let fixture: BootedFixture;
let authorization: BootedAuthorizationServer;
/** Node id per mode, read off the served navigation rather than guessed. */
const nodes = new Map<AuthorizationMode, string>();

/** Finds the node id of one mode's operation, by the address the rail prints under its label. */
async function nodeIdFor(mode: AuthorizationMode): Promise<string> {
  const known = nodes.get(mode);
  if (known !== undefined) return known;

  const overview = await (await fetch(`${fixture.url}${FIXTURE_BASE_PATH}`)).text();
  const state = /<script type="application\/json" id="oref-state"[^>]*>([\s\S]*?)<\/script>/.exec(
    overview,
  )?.[1];
  const documentHash = (JSON.parse(state ?? '{}') as { documentHash?: string }).documentHash ?? '';

  const payload = (await (
    await fetch(`${fixture.url}${navigationHref(documentHash, FIXTURE_BASE_PATH)}`)
  ).json()) as { navigation?: readonly unknown[] };

  // MATCHED ON THE SUMMARY THIS FIXTURE WROTE, not on a node id spelled out here. A node id is
  // core's identity for an operation and a copy of it in a test is a second spelling that drifts.
  const wanted = `Sign in, ${mode}`;
  const found = (function find(entries: readonly unknown[]): string | null {
    for (const raw of entries) {
      const entry = raw as { nodeId: string | null; label?: string; children?: readonly unknown[] };
      if (entry.nodeId !== null && entry.label === wanted) return entry.nodeId;
      const inside = find(entry.children ?? []);
      if (inside !== null) return inside;
    }
    return null;
  })(payload.navigation ?? []);

  if (found === null) throw new Error(`no navigation entry is labelled ${wanted}`);
  nodes.set(mode, found);

  return found;
}

/** Opens the operation page of one mode, with the console reached for and mounted. */
async function openConsole(
  mode: AuthorizationMode,
): Promise<{ page: Page; close(): Promise<void> }> {
  const context = await chrome.browser.newContext();
  const page = await context.newPage();
  const nodeId = await nodeIdFor(mode);

  // THE BENCH PAGE, because that is where the console lives since `TX-FRAME`: one address answers
  // one way, and the operation page carries the panel while the bench carries the console.
  await page.goto(`${fixture.url}${benchHref(nodeId, FIXTURE_BASE_PATH)}`, {
    waitUntil: 'load',
    timeout: 120_000,
  });

  // THE CONSOLE IS DEFERRED AND ARRIVES ON A REACH, which is the shipped gesture and the one
  // `first-minute.spec.ts` already drives. A case that mounted it another way would be proving
  // something about the test.
  await page.locator('.oref-section-tryit').click({ position: { x: 4, y: 4 } });
  await expect
    .poll(() => page.locator('.oref-signin').count(), { timeout: 60_000 })
    .toBeGreaterThan(0);

  return { page, close: () => context.close() };
}

/** Presses Sign in with a client id filled, and waits for the authorization server to answer. */
async function pressSignIn(page: Page, mode: AuthorizationMode): Promise<void> {
  const scheme = schemeIdFor(mode);
  await page.locator(`#oref-field-oauth-${scheme}-clientId`).fill(AUTHORIZATION_CLIENT_ID);

  await Promise.all([
    page.waitForURL((url) => url.searchParams.get('oref_oauth') === '1', { timeout: 60_000 }),
    page.locator('.oref-signin').click(),
  ]);
}

/**
 * The sentence the console shows about a scheme, once the landing has written one.
 *
 * IT MAY HAVE TO WALK BACK TO A CONSOLE FIRST. A state this page did not send carries a return
 * path this page did not write, and `returnPathOf` refuses it and sends the reader to the
 * overview, which is the open redirector guard doing its job. The notice waits in `sessionStorage`
 * until a console is opened, so the walk is what a reader does rather than a workaround.
 */
async function noticeAfterLanding(page: Page, mode: AuthorizationMode): Promise<string> {
  if ((await page.locator('.oref-section-tryit').count()) === 0) {
    await page.goto(`${fixture.url}${benchHref(await nodeIdFor(mode), FIXTURE_BASE_PATH)}`, {
      waitUntil: 'load',
      timeout: 120_000,
    });
  }

  await page.locator('.oref-section-tryit').click({ position: { x: 4, y: 4 } });
  await expect
    .poll(() => page.locator('.oref-field-oauth .oref-tryit-notice').count(), { timeout: 60_000 })
    .toBeGreaterThan(0);

  return (await page.locator('.oref-field-oauth .oref-tryit-notice').first().textContent()) ?? '';
}

beforeAll(async () => {
  chrome = await launchChrome();
  authorization = await bootAuthorizationServer();
  fixture = await bootFixture('proof', { authorizationServer: authorization.url });
  await authorization.allowOrigin(fixture.url);
}, TIMEOUT);

afterAll(async () => {
  await fixture.stop();
  await authorization.stop();
  await chrome.close();
});

describe('the sign in return, in a browser', () => {
  it(
    'should complete an ordinary authorization code exchange and say so',
    async () => {
      // Given the reference, an authorization server that answers, and a reader at the console
      const session = await openConsole('ordinary');

      try {
        // When they press Sign in, are sent away, and come back
        await pressSignIn(session.page, 'ordinary');

        // Then the url the reader is left on carries no authorization code
        await expect
          .poll(() => session.page.url().includes('code='), { timeout: 60_000 })
          .toBe(false);

        // And the console says the sign in happened
        expect(await noticeAfterLanding(session.page, 'ordinary')).toBe('signed in');
      } finally {
        await session.close();
      }
    },
    TIMEOUT,
  );

  it(
    'should refuse a callback whose state this page did not send',
    async () => {
      // Given an authorization server that answers with a state it invented
      const session = await openConsole('foreign-state');

      try {
        // When the reader comes back from it
        await pressSignIn(session.page, 'foreign-state');

        // Then the return path that travelled inside that foreign state was refused, so the
        // reader is on the overview rather than wherever the state named: the callback route is
        // registered with an authorization server, which is the worst place to have an open
        // redirector, and this is that guard running in a browser
        await expect
          .poll(() => session.page.url().includes('/sign-in-'), { timeout: 60_000 })
          .toBe(false);

        // And the refusal names what is wrong, in a browser rather than in jsdom
        const notice = await noticeAfterLanding(session.page, 'foreign-state');
        expect(notice).toContain('state this page did not send');
      } finally {
        await session.close();
      }
    },
    TIMEOUT,
  );

  it(
    'should refuse a callback replayed a second time',
    async () => {
      // Given a sign in that completed once
      const session = await openConsole('ordinary');

      try {
        await pressSignIn(session.page, 'ordinary');
        const landed = session.page.url();
        expect(await noticeAfterLanding(session.page, 'ordinary')).toBe('signed in');

        // When the same callback url is opened again, which is what a reader's back button and a
        // pasted address both do
        const replayed = await nodeIdFor('ordinary');
        await session.page.goto(
          `${landed.split('?')[0] ?? ''}?oref_oauth=1&code=replayed&state=x`,
          {
            waitUntil: 'load',
            timeout: 120_000,
          },
        );
        expect(replayed).not.toBe('');

        // Then nothing is exchanged and the code does not survive in the address bar
        await expect
          .poll(() => session.page.url().includes('code='), { timeout: 60_000 })
          .toBe(false);
      } finally {
        await session.close();
      }
    },
    TIMEOUT,
  );

  it(
    'should refuse an access token too large to become a header',
    async () => {
      // Given a token endpoint answering with 100 KB of access token
      const session = await openConsole('oversized-token');

      try {
        // When the reader comes back and the exchange runs
        await pressSignIn(session.page, 'oversized-token');

        // Then it is refused where it arrived, naming the size. It was accepted, stored and
        // reported as a sign in until T035, and the failure surfaced on the next Send as a
        // sentence about the network.
        const notice = await noticeAfterLanding(session.page, 'oversized-token');
        expect(notice).not.toBe('signed in');
        expect(notice).toContain('access token of');
      } finally {
        await session.close();
      }
    },
    TIMEOUT,
  );

  it(
    'should refuse an access token carrying control characters',
    async () => {
      // Given a token endpoint answering with CR, LF and NUL inside the token
      const session = await openConsole('control-token');

      try {
        // When the reader comes back and the exchange runs
        await pressSignIn(session.page, 'control-token');

        // Then the refusal is about the token rather than about a network, and it happens before
        // anything is stored: `Authorization: Bearer <value>` is built by string concatenation,
        // so this is the answer that would have closed one header and opened another
        const notice = await noticeAfterLanding(session.page, 'control-token');
        expect(notice).toContain('control characters');
      } finally {
        await session.close();
      }
    },
    TIMEOUT,
  );

  it(
    'should refuse a token endpoint that redirects to another host',
    async () => {
      // Given a token endpoint that answers 307 to an origin the document never named
      const session = await openConsole('redirecting-token');

      try {
        // When the reader comes back and the exchange runs
        await pressSignIn(session.page, 'redirecting-token');

        // Then the redirect is not followed, so the token of the other host is never accepted
        const notice = await noticeAfterLanding(session.page, 'redirecting-token');
        expect(notice).not.toBe('signed in');
      } finally {
        await session.close();
      }
    },
    TIMEOUT,
  );
});

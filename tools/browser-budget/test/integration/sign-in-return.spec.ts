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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { benchHref, navigationHref } from '@openref/render';
import {
  AUTHORIZATION_CLIENT_ID,
  bootAuthorizationServer,
  bootFixture,
  buildContentSecurityPolicy,
  FIXTURE_BASE_PATH,
  launchChrome,
  repositoryRoot,
  schemeIdFor,
  TOKEN_PATH,
} from '../../src/index';
import type { AuthorizationMode, BootedAuthorizationServer } from '../../src/index';
import type { BootedFixture, LaunchedChrome } from '../../src/index';
import type { Page } from 'playwright-core';

const TIMEOUT = 300_000;

let chrome: LaunchedChrome;
let fixture: BootedFixture;
let authorization: BootedAuthorizationServer;
/** Node id per fixture and mode, read off the served navigation rather than guessed. */
const nodes = new Map<string, string>();

/**
 * One violation as the document reported it.
 *
 * READ OFF THE EVENT BECAUSE THERE IS NOWHERE ELSE. A `fetch` a policy refuses never reaches the
 * network, so no request, no response and no server log carries it; the browser fires
 * `securitypolicyviolation` and writes a line to the developer console, and that is the whole
 * record. This is also why the rule of SPEC 19 says the check lives in the browser suite: jsdom
 * enforces no policy at all, so there the same case would pass whatever the header said.
 */
interface ViolationRecord {
  readonly directive: string;
  readonly blockedUri: string;
}

/** Installed before every navigation, so a violation on the returning document is still seen. */
const VIOLATION_RECORDER = `
  globalThis.__openrefCspViolations = [];
  addEventListener('securitypolicyviolation', (event) => {
    globalThis.__openrefCspViolations.push({
      directive: event.effectiveDirective || event.violatedDirective,
      blockedUri: event.blockedURI,
    });
  });
`;

/** What the document has recorded so far. */
async function violationsOn(page: Page): Promise<readonly ViolationRecord[]> {
  return page.evaluate<readonly ViolationRecord[]>('globalThis.__openrefCspViolations ?? []');
}

/** The `connect-src` directive of the policy one boot actually serves. */
async function connectDirectiveOf(url: string): Promise<string> {
  const response = await fetch(`${url}${FIXTURE_BASE_PATH}`);
  await response.text();
  const header = response.headers.get('content-security-policy') ?? '';

  return (
    header
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('connect-src ')) ?? `no connect-src in "${header}"`
  );
}

/** Finds the node id of one mode's operation, by the address the rail prints under its label. */
async function nodeIdFor(mode: AuthorizationMode, at: string = fixture.url): Promise<string> {
  const known = nodes.get(`${at}|${mode}`);
  if (known !== undefined) return known;

  const overview = await (await fetch(`${at}${FIXTURE_BASE_PATH}`)).text();
  const state = /<script type="application\/json" id="oref-state"[^>]*>([\s\S]*?)<\/script>/.exec(
    overview,
  )?.[1];
  const documentHash = (JSON.parse(state ?? '{}') as { documentHash?: string }).documentHash ?? '';

  const payload = (await (
    await fetch(`${at}${navigationHref(documentHash, FIXTURE_BASE_PATH)}`)
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
  nodes.set(`${at}|${mode}`, found);

  return found;
}

/** Opens the operation page of one mode, with the console reached for and mounted. */
async function openConsole(
  mode: AuthorizationMode,
  at: string = fixture.url,
): Promise<{ page: Page; close(): Promise<void> }> {
  const context = await chrome.browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(VIOLATION_RECORDER);
  const nodeId = await nodeIdFor(mode, at);

  // THE BENCH PAGE, because that is where the console lives since `TX-FRAME`: one address answers
  // one way, and the operation page carries the panel while the bench carries the console.
  await page.goto(`${at}${benchHref(nodeId, FIXTURE_BASE_PATH)}`, {
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
async function noticeAfterLanding(
  page: Page,
  mode: AuthorizationMode,
  at: string = fixture.url,
): Promise<string> {
  if ((await page.locator('.oref-section-tryit').count()) === 0) {
    await page.goto(`${at}${benchHref(await nodeIdFor(mode, at), FIXTURE_BASE_PATH)}`, {
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
    'should serve a connect-src naming the authorization server as well as this origin',
    async () => {
      // Given the boot every case above runs against, which is a reference whose document
      // declares an authorization code flow

      // When
      const directive = await connectDirectiveOf(fixture.url);

      // Then both origins are in it, and this is the only assertion of a `connect-src` value in
      // the repository that is about a document with a redirect flow in it. Until `T065` measured
      // it, the only one anywhere was the single origin form over a static site with no flow at
      // all, so the rule SPEC 19 states had no runner on the case it is about.
      expect(directive).toBe(`connect-src 'self' ${authorization.url}`);
    },
    TIMEOUT,
  );

  it(
    'should print in the guide exactly what the builder returns for that origin',
    () => {
      // Given the block a host copies out of the security chapter. It printed the single origin
      // form until `T065`, which is worse than printing nothing: a host who followed it literally
      // got a reference that cannot sign in, and nothing in this repository disagreed with it.
      const guide = readFileSync(join(repositoryRoot(), 'docs', 'guide', '09-security.md'), 'utf8');
      const block = /```\n(default-src[\s\S]*?)\n```/.exec(guide)?.[1];

      // Then, presence first: there is a block, and it has the directive this case is about.
      expect(block, 'the security chapter prints no policy block').toBeDefined();
      expect(block).toContain('connect-src');

      // When the two placeholders are filled the way the prose next to them says to fill them
      const nonce = 'n0nceFromTheGuide';
      const origin = 'https://login.example.com';
      const filled = (block ?? '')
        .replaceAll('<per response>', nonce)
        .replace('<your authorization server origin>', origin)
        .split('\n')
        .map((line) => line.replace(/;$/, ''))
        .join('; ');

      // Then the printed policy is the built one, character for character, so the guidance and
      // the function cannot drift apart again without a red case
      expect(filled).toBe(buildContentSecurityPolicy(nonce, [origin]));
    },
    TIMEOUT,
  );

  it(
    'should not sign in at all under the single origin form, blocked on connect-src',
    async () => {
      // Given a second reference, identical but for the one directive: this is the switch the
      // fixture has carried since `T035` with its own JSDoc saying the property "is proved rather
      // than assumed", and which no case had ever set.
      const bare = await bootFixture('proof', {
        authorizationServer: authorization.url,
        allowAuthorizationConnect: false,
      });

      try {
        // Then, before the browser: it really is serving the bare form, and the boot above really
        // is serving the two origin one, so the two runs differ in this and in nothing else.
        expect(await connectDirectiveOf(bare.url)).toBe("connect-src 'self'");
        expect(await connectDirectiveOf(fixture.url)).toBe(
          `connect-src 'self' ${authorization.url}`,
        );

        const session = await openConsole('ordinary', bare.url);

        try {
          // When the reader presses Sign in, is sent away, and comes back
          await pressSignIn(session.page, 'ordinary');

          // Then the browser refused the token exchange before it reached the network, and named
          // the directive that refused it
          await expect
            .poll(async () => (await violationsOn(session.page)).length, { timeout: 60_000 })
            .toBeGreaterThan(0);

          const violations = await violationsOn(session.page);
          expect(
            violations.some((violation) => violation.directive.startsWith('connect-src')),
            `the violations were ${JSON.stringify(violations)}`,
          ).toBe(true);
          expect(
            violations.some(
              (violation) => violation.blockedUri === `${authorization.url}${TOKEN_PATH}`,
            ),
            `the violations were ${JSON.stringify(violations)}`,
          ).toBe(true);

          // And the sign in did not happen, which is the sentence a host following the old
          // guidance would have had to debug from a developer console
          expect(await noticeAfterLanding(session.page, 'ordinary', bare.url)).not.toBe(
            'signed in',
          );
        } finally {
          await session.close();
        }
      } finally {
        await bare.stop();
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

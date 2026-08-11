/**
 * The SPEC 19 claims a browser has to answer, each proved by watching its check fail first.
 *
 * SPEC 19.2, the strict policy, and SPEC 19.4, zero external requests, are the two claims that
 * cannot be settled by reading source. A scan over built output says what the shipped files
 * contain; only a browser under a real policy says what a page is allowed to do, and only an
 * interception at the network layer says what it asked for.
 *
 * EVERY ASSERTION HERE IS MADE TWICE. Zero violations is what a working policy looks like and
 * it is also what a listener attached to the wrong document looks like, what a browser that
 * reports nothing looks like, and what measuring the wrong page looks like. So each claim is
 * planted, watched to fail, and then watched to go silent with the plant removed.
 *
 * THE POLICY IS OFF FOR EXACTLY ONE OF THEM, and the reason is in `plants.ts`: under
 * `default-src 'none'` the browser blocks the planted stylesheet before it reaches the network,
 * so the request interception would see nothing and would look watchful while observing
 * nothing. It is therefore proved able to see an external request with the policy off, and the
 * policy is separately proved to stop the same plant with it on.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootFixture,
  firstNodePage,
  launchChrome,
  measurePage,
  PLANTED_ORIGIN,
  PLANTED_SCRIPT_MARKER,
  plantExternalStylesheet,
  plantInlineScript,
  plantInlineStyleAttribute,
  type BootedFixture,
  type LaunchedChrome,
  type PageMeasurement,
} from '../../src/index';

/** Long, because each case is a browser launch away from a real page. */
const TIMEOUT = 180_000;

let chrome: LaunchedChrome;
let guarded: BootedFixture;
let unguarded: BootedFixture;

/**
 * The page every case is measured on, chosen so it is a node page rather than the overview.
 *
 * READ OFF THE SERVED DOCUMENT RATHER THAN WRITTEN OUT. It used to be the literal
 * `/docs/get-resource-0`, and when T016 replaced the budget fixture with a representative one
 * the route stopped existing: every proof here went on running against a 404, which loads no
 * assets, so a page that asks for nothing reported zero external requests and zero policy
 * violations and looked like a pass. The plants are what caught it, because a plant that cannot
 * be seen fails, and that is the whole reason each claim is made twice.
 */
async function proofPage(fixture: BootedFixture): Promise<string> {
  return await firstNodePage(fixture.url);
}

async function measure(
  fixture: BootedFixture,
  transformHtml?: (html: string) => string,
): Promise<PageMeasurement> {
  return measurePage(chrome.browser, {
    url: await proofPage(fixture),
    throttleRate: 1,
    globals: [PLANTED_SCRIPT_MARKER],
    ...(transformHtml === undefined ? {} : { transformHtml }),
  });
}

beforeAll(async () => {
  chrome = await launchChrome();
  guarded = await bootFixture('proof');
  unguarded = await bootFixture('proof', { policy: false });
}, TIMEOUT);

afterAll(async () => {
  await guarded.stop();
  await unguarded.stop();
  await chrome.close();
});

describe('the harness itself', () => {
  it(
    'should refuse to measure a page that did not load, which is how M0 lost six proofs',
    async () => {
      // Given a route the fixture does not serve, which is the exact condition the six proofs
      // in this file ran under for the length of a milestone and read as a pass.
      const missing = `${guarded.url}/docs/a-route-no-document-has`;

      // When
      const measuring = measurePage(chrome.browser, {
        url: missing,
        throttleRate: 1,
        globals: [PLANTED_SCRIPT_MARKER],
      });

      // Then the measurement refuses rather than reporting an empty page as a clean one
      await expect(measuring).rejects.toThrow(/answered 404/);
    },
    TIMEOUT,
  );
});

describe('the strict CSP of SPEC 19.2, enforced by a browser', () => {
  it(
    'should report no violation and load no third party resource on the page as it ships',
    async () => {
      // Given the fixture serving the shipped bytes under the policy of SPEC 19.2
      expect(guarded.policy).toBe(true);

      // When the page is opened with nothing planted
      const measurement = await measure(guarded);

      // Then the page it measured is a page that loaded, which is asserted before the three
      // absences below rather than assumed by them. `measurePage` refuses a failed navigation
      // now; this adds the half a status code cannot carry, that the reference is on the page
      // and that it fetched the files it is supposed to fetch.
      expect(measurement.requests.length).toBeGreaterThan(1);
      expect(measurement.parsedBytes.documentBytes).toBeGreaterThan(1024);

      expect(measurement.cspViolations).toEqual([]);
      expect(measurement.requests.filter((request) => request.external)).toEqual([]);
      expect(measurement.globals[PLANTED_SCRIPT_MARKER]).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'should refuse a planted inline style attribute',
    async () => {
      // Given a document identical to the one above but for one style attribute
      // When
      const measurement = await measure(guarded, plantInlineStyleAttribute);

      // Then the browser, not a scan, is what refuses it
      const directives = measurement.cspViolations.map((violation) => violation.directive);
      expect(directives.some((directive) => directive.includes('style-src'))).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'should refuse a planted inline script and not run it',
    async () => {
      // Given a document carrying one script element with no nonce
      // When
      const measurement = await measure(guarded, plantInlineScript);

      // Then it is reported
      const directives = measurement.cspViolations.map((violation) => violation.directive);
      expect(directives.some((directive) => directive.includes('script-src'))).toBe(true);

      // And it did not run, which is what makes the report a block rather than a note
      expect(measurement.globals[PLANTED_SCRIPT_MARKER]).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'should refuse a planted third party stylesheet',
    async () => {
      // Given the CDN font link a reference is usually built with
      // When
      const measurement = await measure(guarded, plantExternalStylesheet);

      // Then
      const directives = measurement.cspViolations.map((violation) => violation.directive);
      expect(directives.some((directive) => directive.includes('style-src'))).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'should be silent again once the plants are removed',
    async () => {
      // Given the same fixture, after three planted runs
      // When nothing is planted
      const measurement = await measure(guarded);

      // Then
      expect(measurement.cspViolations).toEqual([]);
    },
    TIMEOUT,
  );
});

describe('the zero external requests of SPEC 19.4, observed at the network layer', () => {
  it(
    'should see a planted third party stylesheet when no policy stands in the way',
    async () => {
      // Given the same fixture with no policy header, so the request reaches the network
      expect(unguarded.policy).toBe(false);

      // When
      const measurement = await measure(unguarded, plantExternalStylesheet);

      // Then the interception reports it, which is what proves the check can fail at all
      const external = measurement.requests.filter((request) => request.external);
      expect(external.map((request) => request.url)).toContain(`${PLANTED_ORIGIN}/fonts/inter.css`);
    },
    TIMEOUT,
  );

  it(
    'should see nothing outside the origin with the plant removed',
    async () => {
      // Given the same unguarded fixture, where a request would not be blocked
      // When nothing is planted
      const measurement = await measure(unguarded);

      // Then every request the page made went to its own origin
      expect(measurement.requests.filter((request) => request.external)).toEqual([]);

      // And it made real ones, so the emptiness above is an observation rather than a silence
      expect(measurement.requests.length).toBeGreaterThan(1);
    },
    TIMEOUT,
  );
});

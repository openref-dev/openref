/**
 * The browser case the `static-proxy-transport` capability debt named as its own done-when: a
 * reader presses Send on a page a static build produced with a rewrite target, and the request
 * goes to the page's own origin under `<base>/_proxy/u<N>/` rather than straight at the API.
 *
 * WHY IT IS HERE AND NOT ONLY IN JSDOM. `packages/nest/test/integration/static-proxy-send.spec.ts`
 * drives the same chain over a real build and real hydration, and it drives it in jsdom, where
 * `fetch` is a function the test replaced. Every precedent this debt has went further: the
 * `proxy-selection` debt was closed by `proxy-selection.spec.ts` in this directory, in Chrome, and
 * the search half of T042 by a case in `navigation-fetch.spec.ts`, in Chrome. What jsdom cannot
 * answer is whether a real engine, parsing the real page and running the real module, forms the
 * address the rule matches; that is what runs here.
 *
 * NO SERVER, PER T039'S PRECEDENT IN `static-output.spec.ts`. The site is built onto disk by a
 * real `buildSite` run, Chrome is pointed at an origin nothing answers for, and every request is
 * fulfilled from the file the build wrote at that address, the way a static host would answer it.
 *
 * AND THE RULE IS THE BUILD'S OWN, READ OFF DISK. The `_proxy` address is not answered from a
 * table this file wrote: the generated `_redirects` is parsed, the rule whose pattern matches the
 * request is found, and the destination it names is what the response comes back as. So the case
 * proves the request goes where the rewrite would carry it, rather than proving it goes to a
 * string that looks like where the rewrite would carry it.
 *
 * THE POSITIVE CONTROL COMES FIRST, per this project's absence rule. Every assertion below is
 * about where a request went, and a recorder that saw nothing would satisfy "it did not go to the
 * API" for the wrong reason. So the first case builds the same document with no target at all and
 * watches the same gesture reach `https://api.example.com` directly. That is the recorder proving
 * it can see a cross origin send, and it is also the behaviour the debt recorded: without the
 * fact, the console on a static build sends direct.
 */

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, normalize, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeOpenApiDocument, type IRDocument } from '@openref/core';
import { benchHref, loadDefaultAssets } from '@openref/render';
import { buildSite, FsOutputStore } from '@openref/static';
import { launchChrome } from '../../src/index';
import type { LaunchedChrome } from '../../src/index';
import type { Page, Request, Route } from 'playwright-core';

const TIMEOUT = 300_000;

/** An origin nothing answers for, so a request that escaped interception fails loudly. */
const ORIGIN = 'http://openref-static-proxy.test';

/** The pinned upstream of the fixture, which is what the generated rule concatenates onto. */
const UPSTREAM = 'https://api.example.com/v1';

/** Where the site is published, so the rules live under `/docs/_proxy`. */
const BASE_PATH = '/docs';

/** What the API answers with, so a rendered body proves the round trip reached an answer. */
const API_BODY = '{"orders":[]}';

let chrome: LaunchedChrome;

/** One built site: the output directory, the bench address, and the rules the build wrote. */
interface BuiltSite {
  readonly output: string;
  readonly benchPath: string;
  /** The `_redirects` rules, parsed, or an empty list for a build with no target. */
  readonly rules: readonly ProxyRule[];
}

/** One line of the generated `_redirects`. */
interface ProxyRule {
  /** The match pattern, such as `/docs/_proxy/u0/*`. */
  readonly from: string;
  /** The destination, such as `https://api.example.com/v1/:splat`. */
  readonly to: string;
}

let withTarget: BuiltSite;
let withoutTarget: BuiltSite;

/** Every output directory a build here created, so `afterAll` can remove them all. */
const outputs: string[] = [];

/** One absolute server and one operation a reader can send without typing anything. */
function fixtureDocument(): IRDocument {
  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Orders API', version: '1.0.0' },
    servers: [{ url: UPSTREAM }],
    paths: {
      '/orders': {
        get: {
          operationId: 'listOrders',
          summary: 'List orders',
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  });
}

/**
 * Parses the `_redirects` a build wrote, so the rule that answers a request is the build's.
 *
 * @param content - The generated file, comments and all
 * @returns One entry per rewrite line, in the order the file states them
 */
function parseRedirects(content: string): readonly ProxyRule[] {
  const rules: ProxyRule[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const [from, to] = trimmed.split(/\s+/u);
    if (from === undefined || to === undefined) continue;
    rules.push({ from, to });
  }

  return rules;
}

/**
 * Where one rule would carry a request path, or null when the rule does not match it.
 *
 * The one Netlify form the generator emits is a trailing `/*` matched against a `:splat` in the
 * destination, which is the whole of what has to be understood here.
 *
 * @param rule - One parsed rule
 * @param path - The path a request asked for
 * @returns The destination url, or null
 */
function resolveRule(rule: ProxyRule, path: string): string | null {
  if (!rule.from.endsWith('/*')) return null;

  const prefix = rule.from.slice(0, -1);
  if (!path.startsWith(prefix)) return null;

  return rule.to.replace(':splat', path.slice(prefix.length));
}

/**
 * Runs a real build onto a real directory and reads back what it wrote.
 *
 * @param target - What `--target` named, or nothing for a build with no proxy at all
 * @returns The output directory, the bench address, and the parsed rules
 */
async function buildOnce(target?: 'netlify'): Promise<BuiltSite> {
  const output = await mkdtemp(join(tmpdir(), 'openref-static-proxy-'));
  outputs.push(output);
  const document_ = fixtureDocument();

  await buildSite({
    document: document_,
    store: new FsOutputStore(output),
    assets: loadDefaultAssets({ resolveFrom: import.meta.url }),
    base: BASE_PATH,
    ...(target === undefined ? {} : { proxy: { target } }),
  });

  const nodeId = [...document_.nodes.values()].find((node) => node.kind === 'operation')?.id;
  if (nodeId === undefined) throw new Error('the fixture normalized to no operation');

  let rules: readonly ProxyRule[] = [];
  if (target !== undefined) {
    rules = parseRedirects(await readFile(join(output, '_redirects'), 'utf8'));
  }

  return { output, benchPath: benchHref(nodeId, BASE_PATH), rules };
}

beforeAll(async () => {
  chrome = await launchChrome();
  withoutTarget = await buildOnce();
  withTarget = await buildOnce('netlify');
}, TIMEOUT);

afterAll(async () => {
  await chrome.close();
  // Tracked as it is created rather than read back off the two bindings, so a build that threw
  // half way still has its directory removed.
  for (const directory of outputs) await rm(directory, { recursive: true, force: true });
}, TIMEOUT);

/** Content type for a built file, so Chrome treats pages and modules as what they are. */
function contentTypeOf(file: string): string {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.xml')) return 'application/xml; charset=utf-8';
  if (file.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.woff2')) return 'font/woff2';

  // The extensionless fetch files of SPEC 16.1: the reader parses the body, not the header.
  return 'application/octet-stream';
}

/**
 * The file the static output holds for one address, exactly as a static host resolves it.
 *
 * THE BASE PATH COMES OFF FIRST, because that is what publishing under `/docs` means: the build
 * writes the publish directory, the host mounts it at the base, and every address the pages carry
 * is prefixed. A resolver that kept the prefix would answer 404 for every page of this build.
 *
 * @param output - The build's output directory
 * @param urlPath - The path a request asked for
 * @returns The relative file, or null when the output holds none
 */
async function fileBehind(output: string, urlPath: string): Promise<string | null> {
  const mounted = urlPath.startsWith(`${BASE_PATH}/`)
    ? urlPath.slice(BASE_PATH.length)
    : urlPath === BASE_PATH
      ? '/'
      : urlPath;
  const relative = decodeURIComponent(mounted).replace(/^\/+/, '');
  const candidates = relative === '' ? ['index.html'] : [relative, `${relative}/index.html`];

  for (const candidate of candidates) {
    const absolute = normalize(join(output, candidate));
    if (!absolute.startsWith(normalize(output) + sep)) continue;

    try {
      if ((await stat(absolute)).isFile()) return candidate;
    } catch {
      // Not this candidate; a page address resolves through its directory's index.html.
    }
  }

  return null;
}

/** One mounted page, with what it asked for and what answered. */
interface StaticSession {
  readonly page: Page;
  /** Every request the page made, as URLs. */
  readonly requests: string[];
  /** Request paths the output directory held no file for and no rule matched. */
  readonly misses: string[];
  /** Destinations the build's own rules carried a `_proxy` request to. */
  readonly rewritten: string[];
  /** CSP violations the page reported, collected when the session closes. */
  readonly violations: string[];
  close(): Promise<void>;
}

/**
 * Opens one built page, answering the origin from the output directory and the API from nowhere.
 *
 * EVERY REQUEST IS INTERCEPTED, THE CROSS ORIGIN ONE INCLUDED, so the positive control can watch a
 * send leave for the API without a byte leaving this machine, which SPEC 19.4 requires of the
 * whole suite.
 *
 * @param site - The build to serve
 * @returns The session, with everything it asked for
 */
async function open(site: BuiltSite): Promise<StaticSession> {
  const context = await chrome.browser.newContext();
  const requests: string[] = [];
  const misses: string[] = [];
  const rewritten: string[] = [];
  const violations: string[] = [];

  await context.route('**/*', async (route: Route) => {
    const url = new URL(route.request().url());

    if (url.origin !== ORIGIN) {
      // The API, reached directly. Answered here rather than on the network, and recorded by the
      // page listener below like every other request.
      await route.fulfill({
        status: 200,
        body: API_BODY,
        contentType: 'application/json; charset=utf-8',
      });
      return;
    }

    // THE BUILD'S OWN RULE ANSWERS THE PROXY ADDRESS. Nothing here knows the upstream: the
    // pattern and the destination both come out of the `_redirects` this build wrote.
    for (const rule of site.rules) {
      const destination = resolveRule(rule, url.pathname);
      if (destination === null) continue;

      rewritten.push(destination);
      await route.fulfill({
        status: 200,
        body: API_BODY,
        contentType: 'application/json; charset=utf-8',
      });
      return;
    }

    const file = await fileBehind(site.output, url.pathname);
    if (file === null) {
      misses.push(url.pathname);
      await route.fulfill({ status: 404, body: 'not in the static output' });
      return;
    }

    await route.fulfill({
      status: 200,
      body: Buffer.from(await readFile(join(site.output, file))),
      contentType: contentTypeOf(file),
    });
  });

  const page = await context.newPage();

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

  const response = await page.goto(`${ORIGIN}${site.benchPath}`, {
    waitUntil: 'load',
    timeout: 120_000,
  });

  // Presence before absence, per SPEC 0: a page that failed to load would also make no requests
  // and send nothing, and would look exactly like success to every case below.
  expect(response?.status()).toBe(200);
  expect(await page.locator('#oref-app').count()).toBe(1);
  expect(await page.locator('.oref-send').count()).toBe(1);

  return {
    page,
    requests,
    misses,
    rewritten,
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

/** Every request a send could be, which is anything naming the operation's path. */
function sends(session: StaticSession): string[] {
  return session.requests.filter((url) => url.includes('/orders'));
}

describe('the positive control: a static build with no target', () => {
  it(
    'should send straight at the API, which is what the debt recorded and what proves the recorder sees a send',
    async () => {
      // Given a page of a build that generated no rules, so the model carries no fact to choose by
      const file = await fileBehind(withoutTarget.output, withoutTarget.benchPath);
      expect(file).not.toBeNull();
      const page = await readFile(join(withoutTarget.output, file ?? ''), 'utf8');
      expect(page).not.toContain('staticProxy');
      expect(withoutTarget.rules).toEqual([]);

      const session = await open(withoutTarget);

      try {
        // When the reader presses Send once, with the mouse, as the first gesture on the page
        await pressWithTheMouse(session.page, '.oref-send');

        // Then the request left for the API's own host, which is both the recorded behaviour and
        // the proof that this recorder can see a cross origin send at all
        await expect
          .poll(() => sends(session), { timeout: 60_000 })
          .toEqual([`${UPSTREAM}/orders`]);
        expect(session.rewritten).toEqual([]);
      } finally {
        await session.close();
        expect(session.violations).toEqual([]);
      }
    },
    TIMEOUT,
  );
});

describe('a page a static build produced with a rewrite target, in a real browser', () => {
  it(
    'should send to its own origin under the rule the build wrote, and never at the upstream host',
    async () => {
      // Given the build's own rule, read off disk before the browser is asked anything
      expect(withTarget.rules).toEqual([
        { from: `${BASE_PATH}/_proxy/u0/*`, to: `${UPSTREAM}/:splat` },
      ]);

      const session = await open(withTarget);

      try {
        // When the reader presses Send once
        await pressWithTheMouse(session.page, '.oref-send');

        // Then the one request Chrome made for this operation is a path on the page's own origin,
        // and it is the address the generated rule matches
        await expect
          .poll(() => sends(session), { timeout: 60_000 })
          .toEqual([`${ORIGIN}${BASE_PATH}/_proxy/u0/orders`]);

        // And the rule carried it to the pinned upstream, which is the sentence the debt was
        // about: the destination below was computed from the `_redirects` this build wrote
        expect(session.rewritten).toEqual([`${UPSTREAM}/orders`]);

        // And nothing at all was addressed to the API host, which is the whole point of the rules
        expect(session.requests.filter((url) => url.includes('api.example.com'))).toEqual([]);
        expect(session.misses).toEqual([]);
      } finally {
        await session.close();
        expect(session.violations).toEqual([]);
      }
    },
    TIMEOUT,
  );

  it(
    'should show the reader the answer the rule brought back, not a proxy envelope',
    async () => {
      // Given, unlike the SPEC 14.5 proxy there is no envelope on this path: the platform forwards
      // the API's own response and the console renders it.
      const session = await open(withTarget);

      try {
        // When
        await pressWithTheMouse(session.page, '.oref-send');
        await expect
          .poll(() => session.page.locator('.oref-run-result').count(), { timeout: 60_000 })
          .toBe(1);

        // Then, and the address is asserted again here rather than assumed: without it this case
        // renders the same panel on a direct send and would pass with the whole branch removed.
        expect(sends(session)).toEqual([`${ORIGIN}${BASE_PATH}/_proxy/u0/orders`]);
        const result = session.page.locator('.oref-run-result');
        expect(await result.locator('.oref-status').textContent()).toContain('200');
        expect(await result.locator('.oref-run-body').textContent()).toContain('orders');
      } finally {
        await session.close();
        expect(session.violations).toEqual([]);
      }
    },
    TIMEOUT,
  );
});

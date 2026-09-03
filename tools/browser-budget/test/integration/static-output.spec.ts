/**
 * The acceptance test of the T039 amendment, in the browser, against the built directory.
 *
 * THE CLAUSE IS EXACT: a test opens a closed group in a page served from the static output,
 * with no server running, and the group opens. So nothing here listens on a port. The site is
 * built onto disk by a real `buildSite` run, Chrome is pointed at an origin nothing answers
 * for, and every request is fulfilled from the file the build wrote at that address, the way a
 * static host would answer it. The navigation payload the gesture needs is read from
 * `_navigation/<document hash>` in the output directory itself, not from a stub and not from a
 * route handler with an opinion.
 *
 * WHY THE ROWS CANNOT BE ALREADY THERE. A page ships the children of its own group and a
 * header with a count for every other, per `sliceNavigation`, so the link this test waits for
 * is proven absent before the click. A build that inlined the whole navigation would fail that
 * assertion before proving nothing with the rest.
 */

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, normalize, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeOpenApiDocument, type IRDocument } from '@openref/core';
import { buildNavigation, nodeHref, loadDefaultAssets, runnerOperationOf } from '@openref/render';
import { withGeneratedSamples } from '@openref/samples';
import type { NavEntryModel } from '@openref/render';
import { buildSite, FsOutputStore, navigationFileOf } from '@openref/static';
import { largeSpecification, launchChrome, PROOF_NODE_COUNT } from '../../src/index';
import type { LaunchedChrome } from '../../src/index';
import type { Page, Request, Route } from 'playwright-core';

const TIMEOUT = 300_000;

/** An origin nothing answers for, so a request that escaped interception fails loudly. */
const ORIGIN = 'http://openref-static.test';

let chrome: LaunchedChrome;
let output = '';
let document_: IRDocument;

beforeAll(async () => {
  chrome = await launchChrome();
  output = await mkdtemp(join(tmpdir(), 'openref-static-browser-'));

  // A REAL BUILD ONTO A REAL DIRECTORY, with the shipped assets: the same browser bundle and
  // stylesheets `openref build` resolves, so the module that answers the click is the one a
  // deployment serves. Twelve nodes, because the proof is about a gesture and not about size,
  // which is `PROOF_NODE_COUNT`'s stated reason to exist.
  document_ = normalizeOpenApiDocument(largeSpecification(PROOF_NODE_COUNT));
  await buildSite({
    document: document_,
    store: new FsOutputStore(output),
    assets: loadDefaultAssets({ resolveFrom: import.meta.url }),
  });
}, TIMEOUT);

afterAll(async () => {
  await chrome.close();
  if (output !== '') await rm(output, { recursive: true, force: true });
});

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
 * The file the static output holds for one address, exactly as a static host resolves it: the
 * file itself, or the `index.html` of the directory the address names. Null when the output
 * holds neither, or when the address tries to leave the directory.
 */
async function fileBehind(urlPath: string): Promise<string | null> {
  const relative = decodeURIComponent(urlPath).replace(/^\/+/, '');
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

/** One mounted page, with what it asked for and what the output directory answered. */
interface StaticSession {
  readonly page: Page;
  /** Every request the page made, as URLs. */
  readonly requests: string[];
  /** Files of the output directory that answered one, relative paths. */
  readonly served: string[];
  /** Request paths the output directory held no file for. */
  readonly misses: string[];
  close(): Promise<void>;
}

/** Opens one built page, serving every request of the origin from the output directory. */
async function open(path: string): Promise<StaticSession> {
  const context = await chrome.browser.newContext();
  const requests: string[] = [];
  const served: string[] = [];
  const misses: string[] = [];

  await context.route(`${ORIGIN}/**`, async (route: Route) => {
    const url = new URL(route.request().url());
    const file = await fileBehind(url.pathname);

    if (file === null) {
      misses.push(url.pathname);
      await route.fulfill({ status: 404, body: 'not in the static output' });
      return;
    }

    served.push(file);
    await route.fulfill({
      status: 200,
      body: Buffer.from(await readFile(join(output, file))),
      contentType: contentTypeOf(file),
    });
  });

  const page = await context.newPage();
  page.on('request', (request: Request) => {
    requests.push(request.url());
  });

  const response = await page.goto(`${ORIGIN}${path}`, { waitUntil: 'load', timeout: 120_000 });

  // Presence before absence, per SPEC 0: a page that failed to load would also make no
  // requests and open nothing, and would look exactly like success to every case below.
  expect(response?.status()).toBe(200);
  expect(await page.locator('#oref-app').count()).toBe(1);

  return { page, requests, served, misses, close: () => context.close() };
}

/** A top level group of the full navigation whose children are operations. */
function operationGroups(entries: readonly NavEntryModel[]): readonly NavEntryModel[] {
  return entries.filter((entry) => entry.children.some((child) => child.nodeId !== null));
}

describe('a page served from the static output, with no server running', () => {
  it(
    'should open a closed group with rows resolved from the navigation payload file',
    async () => {
      // Given: an operation to stand on and a group far from it, read off the document rather
      // than written out, so the fixture generator cannot silently invalidate the case.
      const navigation = buildNavigation(document_);
      const groups = operationGroups(navigation);
      const home = groups[0];
      const far = groups[groups.length - 1];
      expect(home).toBeDefined();
      expect(far).toBeDefined();
      if (home === undefined || far === undefined || home.id === far.id) {
        throw new Error('the fixture no longer yields two operation groups');
      }

      const homeNodeId = home.children.find((child) => child.nodeId !== null)?.nodeId ?? '';
      const farNodeId = far.children.find((child) => child.nodeId !== null)?.nodeId ?? '';
      expect(homeNodeId).not.toBe('');
      expect(farNodeId).not.toBe('');
      const farLink = nodeHref(farNodeId, '');

      // And the payload the gesture will need is a file of the build, holding the far row. The
      // build's document is this one plus the generated samples of SPEC 18 since
      // `TX-PAGE-SAMPLES`, so the hash the file is named by is the built one, not the handed one.
      const payloadFile = navigationFileOf(withGeneratedSamples(document_, runnerOperationOf).hash);
      const payload = await readFile(join(output, payloadFile), 'utf8');
      expect(payload).toContain(`"${farNodeId}"`);

      const session = await open(nodeHref(homeNodeId, ''));

      try {
        // And the far group is a closed header whose row never travelled with the page.
        expect(await session.page.locator(`a.oref-nav-item[href="${farLink}"]`).count()).toBe(0);
        const toggle = session.page
          .locator('button.oref-nav-toggle[aria-expanded="false"]')
          .filter({
            has: session.page.locator('span.oref-nav-label', {
              hasText: new RegExp(`^${far.label}$`),
            }),
          });
        expect(await toggle.count()).toBe(1);

        // When the reader opens it
        await toggle.click();

        // Then the group opens: the row that was not on the page is on the page.
        await expect
          .poll(() => session.page.locator(`a.oref-nav-item[href="${farLink}"]`).count(), {
            timeout: 30_000,
          })
          .toBe(1);

        // And what opened it was the payload file of the static output, nothing else: the
        // page asked its own origin for the navigation address, the answer came from the file
        // on disk, no request left the origin, and no request met an address the build did
        // not write.
        expect(session.requests).toContain(`${ORIGIN}/${payloadFile}`);
        expect(session.served).toContain(payloadFile);
        const external = session.requests.filter(
          (url) => !url.startsWith(ORIGIN) && !url.startsWith('data:'),
        );
        expect(external).toEqual([]);
        expect(session.misses).toEqual([]);
      } finally {
        await session.close();
      }
    },
    TIMEOUT,
  );
});

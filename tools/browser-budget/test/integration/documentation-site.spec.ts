import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentationSpecification } from '../../../docs-site/src/index.ts';
import { scanForCspViolations } from '../../../gates/src/lib/csp.ts';
import {
  launchChrome,
  measurePage,
  PLANTED_ORIGIN,
  plantExternalStylesheet,
  plantInlineStyleAttribute,
  repositoryRoot,
  type LaunchedChrome,
} from '../../src/index';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

/**
 * The documentation site, proved to be what it says it is.
 *
 * `T063` ASKS THAT THE SITE PASS THE CSP AND BUDGET GATES BECAUSE IT IS BUILT WITH THE PRODUCT,
 * AND THE GATE CANNOT SEE IT. The `csp` gate walks `packages/<name>/dist`, so a site written
 * anywhere else is outside its roots; that is a finding rather than a workaround, and this file
 * is the answer to it. What runs here is stronger than the gate in the one way that matters: the
 * gate is a regular expression over text and a browser is the thing that actually enforces a
 * policy. A regular expression cannot tell a rendered `style` attribute from a page whose prose
 * quotes one, and this site's own security chapter quotes one.
 *
 * EVERY CLAIM IS MADE TWICE, per `security-proof.spec.ts`. Zero violations is what a working
 * policy looks like and it is also what a listener attached to nothing looks like, so each claim
 * is planted, watched to fail, and then watched to go silent with the plant removed.
 *
 * THE POLICY IS STRICTER THAN THE SERVED ONE, and it can be. A server render carries a nonce
 * because the host may add a style element; a static build emits none, so `style-src 'self'`
 * with neither a nonce nor `unsafe-inline` is the honest policy for these files, and the site
 * has to hold under it.
 */

const execFileAsync = promisify(execFile);
const TIMEOUT = SPAWNED_PROCESS_TIMEOUT_MS;

/**
 * The policy a static host should set over this output.
 *
 * NO NONCE AND NO `unsafe-inline` ANYWHERE. The two inline `<script>` elements the page carries
 * hold `application/ld+json` and `application/json`, which are data blocks rather than scripts,
 * so `script-src 'self'` does not reach them and no exception is needed for them.
 */
const STATIC_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Content types the built site actually serves. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

let chrome: LaunchedChrome;
let output = '';
let server: Server;
let origin = '';

/** Whether the running server sets the policy. Flipped by the case that has to see a request. */
let policyOn = true;

/**
 * Serves the built directory the way a static host does.
 *
 * PATHS ARE RESOLVED AND CHECKED RATHER THAN CONCATENATED, because a test server that can be
 * walked out of is a test server that proves nothing about the files it was pointed at.
 *
 * @returns The origin it listens on
 */
async function serveOutput(): Promise<string> {
  server = createServer((request, response) => {
    void (async (): Promise<void> => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      const relative = normalize(decodeURIComponent(path)).replace(/^[/\\]+/, '');
      const candidate = join(output, relative);

      if (!candidate.startsWith(output + sep) && candidate !== output) {
        response.writeHead(403).end();
        return;
      }

      const file = await stat(candidate).then(
        (entry) => (entry.isDirectory() ? join(candidate, 'index.html') : candidate),
        () => join(output, relative, 'index.html'),
      );

      try {
        const bytes = await readFile(file);
        const headers: Record<string, string> = {
          'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
        };
        if (policyOn) headers['content-security-policy'] = STATIC_POLICY;
        response.writeHead(200, headers).end(bytes);
      } catch {
        response.writeHead(404).end();
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the server took no port');
  return `http://127.0.0.1:${String(address.port)}`;
}

beforeAll(async () => {
  chrome = await launchChrome();
  output = await mkdtemp(join(tmpdir(), 'openref-docs-site-'));

  // THE REAL BINARY, ON THE REAL DOCUMENT. Not `buildSite` through an import: the claim is that
  // this site is built by the product a reader installs, and the product a reader installs is
  // the command line, so the command line is what runs.
  const specification = join(output, 'openref.site.json');
  await writeFile(specification, `${JSON.stringify(documentationSpecification(), null, 2)}\n`);

  const site = join(output, 'site');
  await execFileAsync(process.execPath, [
    join(repositoryRoot(), 'packages', 'cli', 'dist', 'bin.js'),
    'build',
    '--spec',
    specification,
    '--out',
    site,
    '--base',
    '/',
  ]);

  output = site;
  origin = await serveOutput();
}, TIMEOUT);

afterAll(async () => {
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
  await chrome.close();
  await rm(output, { recursive: true, force: true });
}, TIMEOUT);

describe('the documentation site', () => {
  it(
    'should open with the first minute, before anything else is proved about it',
    async () => {
      // Given
      const html = await readFile(join(output, 'index.html'), 'utf8');
      const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

      // When: where the reader's eye lands, and where the architecture words appear
      const install = text.indexOf('npm i @openref/nest');

      // Then
      expect(install).toBeGreaterThanOrEqual(0);
      expect(text.slice(install, install + 700)).toContain('OpenRefModule');
      // PRESENCE BEFORE ORDERING. This loop used to skip a word it could not find, so a term
      // that never appears passed silently and the case covered fewer words than it named. Each
      // term is now one the rendered page really carries, asserted before it is placed.
      for (const word of ['Federation', 'theme level', 'normalized model', 'packages']) {
        const at = text.indexOf(word);
        expect(at, `${word} never appears on the page, so it proves no ordering`).toBeGreaterThan(
          -1,
        );
        expect(at, `${word} appears before the install command`).toBeGreaterThan(install);
      }
    },
    TIMEOUT,
  );

  it(
    'should make no request to any origin but its own',
    async () => {
      // Given
      const measurement = await measurePage(chrome.browser, { url: origin, throttleRate: 1 });

      // Then
      expect(measurement.requests.length).toBeGreaterThan(3);
      expect(measurement.requests.filter((request) => request.external)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'should be measured by a run that can see an external request',
    async () => {
      // Given: the policy off, because `default-src none` blocks the plant before the network
      policyOn = false;

      try {
        // When
        const measurement = await measurePage(chrome.browser, {
          url: origin,
          throttleRate: 1,
          transformHtml: plantExternalStylesheet,
        });

        // Then
        expect(
          measurement.requests.filter((request) => request.url.startsWith(PLANTED_ORIGIN)).length,
        ).toBeGreaterThan(0);
      } finally {
        policyOn = true;
      }
    },
    TIMEOUT,
  );

  it(
    'should report no policy violation under a strict policy with no unsafe-inline',
    async () => {
      // Given
      const measurement = await measurePage(chrome.browser, { url: origin, throttleRate: 1 });

      // Then
      expect(measurement.cspViolations).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'should be measured by a run that can see a policy violation',
    async () => {
      // Given a style attribute planted into the markup, which no nonce can ever authorize
      const measurement = await measurePage(chrome.browser, {
        url: origin,
        throttleRate: 1,
        transformHtml: plantInlineStyleAttribute,
      });

      // Then
      expect(measurement.cspViolations.length).toBeGreaterThan(0);
      // Chrome reports the attribute directive that `style-src` falls back to when no
      // `style-src-attr` is set, so the name is taken from the browser rather than assumed.
      expect(
        measurement.cspViolations.some((violation) => violation.directive.startsWith('style-src')),
      ).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "should be a page the gate's own text scan calls three violations and a browser calls none",
    async () => {
      // Given the same bytes the browser cases above loaded
      const html = await readFile(join(output, 'index.html'), 'utf8');

      // When: the scan the `csp` gate applies to built output, run on this file
      const scanned = scanForCspViolations(html);

      // Then: three, and each one is a false positive of a different kind
      expect(scanned.map((violation) => violation.rule)).toEqual([
        // The theme chapter teaches the rule by quoting the thing it forbids, and a regular
        // expression over text cannot tell a quotation from an attribute.
        'vue-style-binding',
        // Both of these are data blocks. `application/ld+json` and `application/json` are not
        // JavaScript, so `script-src` does not reach them and the browser reports nothing; the
        // rule reads the nonce, the src and the body, and never the type.
        'inline-script-element',
        'inline-script-element',
      ]);
      expect(html).toContain('<code>style="..."</code>');
      expect(html).toContain('<script type="application/ld+json">');
    },
    TIMEOUT,
  );
});

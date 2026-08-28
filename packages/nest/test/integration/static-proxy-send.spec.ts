// @vitest-environment jsdom

import { normalizeOpenApiDocument, type IRDocument } from '@openref/core';
import type { AssetSource } from '@openref/render';
import { hydrateReference, readPageState } from '@openref/render/browser';
import { buildSite, type IOutputStore } from '@openref/static';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPageRunner } from '../../src/browser/runner-factory';

/**
 * The composition case for the `static-proxy-transport` capability debt: a reader presses Send on
 * a page a static build produced with a rewrite target, and the request goes to the page's own
 * origin under `<base>/_proxy/u<N>/` rather than straight at the API.
 *
 * THIS FILE IS JSDOM AND SAYS SO, corrected in the last round of T042. It called itself "the
 * browser case" while running under `@vitest-environment jsdom`, where `fetch` is a function the
 * test replaced and no engine parses the page or schedules the module. Everything below is real
 * except the engine: a real build, real bytes, real hydration, and the positive control first. The
 * browser half of the debt is `tools/browser-budget/test/integration/static-proxy-send.spec.ts`,
 * which drives the same gesture in Chrome over the built directory with no server, answers the
 * `_proxy` address from the `_redirects` the build wrote, and is what the debt's own done-when
 * asked for, per the precedent `proxy-selection.spec.ts` set for the envelope proxy.
 *
 * WHAT THIS FILE STILL ANSWERS THAT THE BROWSER ONE DOES NOT is where the three halves meet. It
 * calls `createPageRunner` directly through `loadRunner`, so the composition under proof is the
 * source of the three packages rather than the bundle built out of them, and it reads the page
 * state block with `readPageState` in isolation. Both suites run on every `pnpm test:integration`.
 *
 * WHERE THE THREE HALVES MEET, AND WHY IT IS HERE. The build is `@openref/static`, the hydration
 * is `@openref/render/browser`, and the transport choice is `@openref/nest`, which is the one
 * package allowed to see the renderer and the runner at once. STANDARDS 3.5 gives none of the
 * three an edge to the others in `src/`; this file is a test and not source, which is where the
 * composition may be assembled, exactly as `try-it.spec.ts` says of the renderer and the runner.
 *
 * A REAL BUILD AND NOT A HAND WRITTEN MODEL. What is under proof is the whole chain: `buildSite`
 * plans the upstreams from the document's servers, writes the netlify rules, puts the prefix and
 * the pinned order into every page, and the page a reader opens is one of the files it wrote. A
 * page model assembled in the test would prove the transport and nothing about the build that
 * has to produce it.
 *
 * THE POSITIVE CONTROL COMES FIRST, per this project's absence rule. Every assertion below is
 * about where a request went, and a spy that saw nothing would satisfy "it did not go to the
 * API" for the wrong reason. So the first case builds the same document with no target at all
 * and watches the same gesture reach `https://api.example.com` directly. That is the spy proving
 * it can see a request, and it is also the behaviour the debt records: without the fact, the
 * console on a static build sends direct.
 */

/** The pinned upstream of the fixture, which is what the generated rule concatenates onto. */
const UPSTREAM = 'https://api.example.com/v1';

/** Where the site is published, so the rules live under `/docs/_proxy`. */
const BASE_PATH = '/docs';

/** The bench of an operation with nothing required, so Send needs no field filled in. */
const BENCH_FILE = 'bench/get-orders/index.html';

/** An output store in memory: the build writes files, the test reads one back. */
class MemoryStore implements IOutputStore {
  readonly files = new Map<string, string>();

  /** @inheritdoc */
  read(path: string): Promise<string | null> {
    return Promise.resolve(this.files.get(path) ?? null);
  }

  /** @inheritdoc */
  write(path: string, contents: string): Promise<void> {
    this.files.set(path, contents);
    return Promise.resolve();
  }

  /** @inheritdoc */
  writeBytes(): Promise<void> {
    return Promise.resolve();
  }

  /** @inheritdoc */
  remove(path: string): Promise<void> {
    this.files.delete(path);
    return Promise.resolve();
  }
}

/** Assets a build needs, standing in for the shipped stylesheet and bundle. */
function fixtureAssets(): {
  readonly sources: readonly AssetSource[];
  readonly stylesheetNames: readonly string[];
  readonly moduleName: string;
} {
  const encoder = new TextEncoder();

  return {
    sources: [
      { name: 'theme.css', bytes: encoder.encode('.oref-body{color:var(--oref-color-fg)}') },
      { name: 'openref.js', bytes: encoder.encode('export const hydrate = () => undefined;') },
    ],
    stylesheetNames: ['theme.css'],
    moduleName: 'openref.js',
  };
}

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
 * Runs a real build and returns the bench page it wrote.
 *
 * @param target - What `--target` named, or nothing for a build with no proxy at all
 * @returns The page's HTML, as it sits in the output directory
 */
async function buildBenchPage(target?: 'netlify'): Promise<string> {
  const store = new MemoryStore();

  await buildSite({
    document: fixtureDocument(),
    store,
    assets: fixtureAssets(),
    base: BASE_PATH,
    ...(target === undefined ? {} : { proxy: { target } }),
  });

  const page = store.files.get(BENCH_FILE);
  if (page === undefined) throw new Error(`the build wrote no ${BENCH_FILE}`);

  return page;
}

/** Every url a send was made to, in order, as the stub recorded them. */
let requested: string[] = [];

/** The `fetch` this environment had before a case replaced it. */
const realFetch = globalThis.fetch;

beforeEach(() => {
  requested = [];
  globalThis.fetch = (input: RequestInfo | URL): Promise<Response> => {
    requested.push(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );

    return Promise.resolve(
      new Response('{"orders":[]}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  document.documentElement.innerHTML = '';
});

/** Lets Vue finish the render its state change scheduled, per `try-it.spec.ts`. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Opens the built page and hydrates it the way the shipped entry does.
 *
 * `createPageRunner` IS CALLED THROUGH `loadRunner`, WHICH IS THE SHIPPED PATH. The factory reads
 * the model `hydrateReference` holds, which is the model read out of the page's own state block,
 * so the fact under test travels the whole way it travels in a browser.
 *
 * @param html - The page as the build wrote it
 */
function open(html: string): void {
  document.documentElement.innerHTML = html;

  const hydrated = hydrateReference({
    loadRunner: (model) => Promise.resolve(createPageRunner(model)),
  });
  expect(hydrated).toBe(true);
}

/**
 * Reaches for the console the way a reader does and presses Send once.
 *
 * The console is behind the gesture, so the press both fetches its chunk and sends. It gives up
 * loudly rather than timing out silently, because a console that never arrived and a console
 * that refused produce the same absence of a request.
 */
async function pressSend(): Promise<void> {
  const region = document.querySelector('.oref-section-tryit');
  if (region === null) throw new Error('the built page rendered no try-it region to reach for');

  const button = document.querySelector<HTMLButtonElement>('.oref-send');
  if (button === null) throw new Error('the built page rendered no send button');

  button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  for (let attempt = 0; attempt < 200; attempt += 1) {
    await settle();
    if (requested.length > 0) return;
    if (document.querySelector('.oref-run-error') !== null) {
      throw new Error(
        `the console refused: ${document.querySelector('.oref-run-error')?.textContent ?? ''}`,
      );
    }
  }

  throw new Error('the console never sent anything');
}

describe('the positive control: a static build with no target', () => {
  it('should send straight at the API, which is what the debt recorded and what proves the spy sees a send', async () => {
    // Given a page of a build that generated no rules, so the model carries no fact to choose by
    const html = await buildBenchPage();
    expect(html).not.toContain('staticProxy');

    // When the reader presses Send
    open(html);
    await settle();
    await pressSend();

    // Then the request left for the API's own host, which is both the recorded behaviour and the
    // proof that this stub is capable of seeing a request at all
    expect(requested).toEqual([`${UPSTREAM}/orders`]);
  });
});

describe('a page a static build produced with a rewrite target', () => {
  it('should carry the prefix and the pinned order the build wrote its rules under', async () => {
    // Given
    const html = await buildBenchPage('netlify');
    document.documentElement.innerHTML = html;

    // When the client reads the state block the build wrote
    const model = readPageState(document);

    // Then it holds the two facts a console needs to address a rule, and nothing else changed
    expect(model?.staticProxy).toEqual({ prefix: '/docs/_proxy', upstreams: [UPSTREAM] });
    expect(model?.proxyPath).toBeUndefined();
    expect(model?.directTarget).toBeUndefined();
  });

  it('should send to its own origin under the prefix, and never at the upstream host', async () => {
    // Given the built page, opened and hydrated as the shipped entry hydrates it
    open(await buildBenchPage('netlify'));
    await settle();

    // When the reader presses Send once
    await pressSend();

    // Then the one request went to the rule of `u0`, which is the address the generated
    // `_redirects` line matches, and it is a path on this page's own origin rather than a url
    // naming a host
    expect(requested).toEqual(['/docs/_proxy/u0/orders']);
    const sent = new URL(requested[0] ?? '', globalThis.location.href);
    expect(sent.origin).toBe(globalThis.location.origin);
    expect(sent.pathname).toBe('/docs/_proxy/u0/orders');

    // And nothing at all was addressed to the API, which is the whole point of the rules
    expect(requested.filter((url) => url.includes('api.example.com'))).toEqual([]);
  });

  it('should show the reader the answer the rule brought back, not a proxy envelope', async () => {
    // Given, unlike the SPEC 14.5 proxy there is no envelope on this path: the platform forwards
    // the API's own response and the console renders it.
    open(await buildBenchPage('netlify'));
    await settle();

    // When
    await pressSend();
    for (let attempt = 0; attempt < 200; attempt += 1) {
      await settle();
      if (document.querySelector('.oref-run-result') !== null) break;
    }

    // Then, and the address is asserted again here rather than assumed: without it this case
    // renders the same panel on a direct send and would pass with the whole branch removed.
    expect(requested).toEqual(['/docs/_proxy/u0/orders']);
    const result = document.querySelector('.oref-run-result');
    expect(result?.querySelector('.oref-status')?.textContent).toContain('200');
    expect(result?.querySelector('.oref-run-body')?.textContent).toContain('orders');
  });
});

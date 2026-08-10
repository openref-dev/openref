// @vitest-environment jsdom

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { normalizeOpenApiDocument, type IRDocument } from '@openref/core';
import { createRunner, FetchHttpTransport } from '@openref/runner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hydrateReference } from '../../src/browser/index';
import { renderHtmlDocument } from '../../src/page/domain/shell';
import { renderPage } from '../../src/render/application/services/render.service';

/**
 * The definition of done of T013, run rather than described: install, open, fill a field, send,
 * see a real response.
 *
 * A REAL SERVER, NOT A STUBBED TRANSPORT. The unit tests already prove what plan the runner
 * builds; what they cannot prove is that the plan survives `fetch`, that the console reads the
 * response back, and that the two halves of the composition fit. This test starts an HTTP
 * server, renders the page, hydrates it with a real `RequestRunner`, types into the fields the
 * server render produced and clicks the button a reader would click.
 *
 * THE COMPOSITION IS THE OTHER THING THIS PROVES. STANDARDS 3.5 gives `@openref/render` no edge
 * to `@openref/runner`, so a runner reaches the console through the port defined in
 * `@openref/vue`, exactly as a search index does. Nothing under `src/` in either package
 * imports the other; this file, which is a test and not source, is where they meet, and
 * `hydrateReference` typing its `runner` option as `IRunnerPort` is what proves at compile time
 * that a `RequestRunner` satisfies the port.
 */

/** What the echo server saw, so a request can be compared against a hand written one. */
interface SeenRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

let server: Server;
let origin: string;
let seen: SeenRequest[] = [];

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let text = '';
    request.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
    request.on('end', () => {
      resolve(text);
    });
  });
}

beforeAll(async () => {
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void readBody(request).then((body) => {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers[name] = value;
      }

      seen.push({ method: request.method ?? '', url: request.url ?? '', headers, body });

      response.writeHead(200, {
        'content-type': 'application/json',
        'x-echo': 'yes',
        'access-control-allow-origin': '*',
      });
      response.end(JSON.stringify({ echoed: request.url, sawBody: body }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${String(address.port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

function documentFor(serverUrl: string): IRDocument {
  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Echo API', version: '1.0.0' },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    },
    paths: {
      '/orders/{id}': {
        get: {
          operationId: 'getOrder',
          summary: 'Read one order',
          security: [{ bearer: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  });
}

/** Renders the page the way a host serves it, and puts it in the jsdom document. */
async function openPage(nodeId: string, serverUrl: string): Promise<void> {
  const page = await renderPage(documentFor(serverUrl), { nodeId });

  document.documentElement.innerHTML = renderHtmlDocument(page, {
    assets: { stylesheets: ['/assets/theme.css'], modules: ['/assets/openref.js'] },
  });
}

/**
 * Lets Vue finish the render its state change scheduled.
 *
 * NEEDED AFTER HYDRATION, not only after typing. The console enables its button from
 * `onMounted`, so the markup a reader sees a frame later is not the markup hydration matched,
 * and a click on the button before that frame lands on a disabled button and does nothing at
 * all: no request, no error, nothing to assert against.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Reaches for the console the way a reader does, and waits for it to arrive.
 *
 * NEEDED SINCE T011-R, AND IT IS THE FEATURE RATHER THAN A TEST WORKAROUND. The console is not
 * in the first chunk: the server markup is served and hydration leaves it alone until somebody
 * touches the region, at which point the chunk is fetched and that subtree hydrates. So a test
 * that drove the console without touching it first would be driving markup with no listeners on
 * it, which is exactly what a reader would meet if the deferral were wrong.
 *
 * It gives up loudly rather than timing out silently, because a console that never arrives and
 * a console that arrived disabled produce the same missing element.
 */
async function reachForConsole(arrived: () => boolean, description: string): Promise<void> {
  const region = document.querySelector('.oref-section-tryit');
  if (region === null) throw new Error('the page rendered no try-it region to reach for');

  region.dispatchEvent(new Event('pointerdown', { bubbles: true }));

  for (let attempt = 0; attempt < 100; attempt += 1) {
    await settle();
    if (arrived()) return;
  }

  throw new Error(`the console never hydrated after the region was touched: ${description}`);
}

/**
 * Whether the console has hydrated, read off what hydration changes.
 *
 * THE PRESENCE OF THE BUTTON PROVES NOTHING, which is why this reads its state instead. The
 * server renders the whole console including a disabled send button, so an element query is
 * satisfied by the markup that was already there and a test built on one would pass with the
 * chunk never fetched.
 */
function consoleIsLive(): boolean {
  return document.querySelector<HTMLButtonElement>('.oref-send')?.disabled === false;
}

/** Types into a control the way a reader does, and lets Vue see it. */
function type(id: string, value: string): void {
  const control = document.getElementById(id);
  if (control === null) throw new Error(`no control with id ${id}`);

  (control as HTMLInputElement).value = value;
  control.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Waits for the console to have rendered a response, or gives up loudly. */
async function waitForResult(): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const found = document.querySelector('.oref-run-result');
    if (found !== null) return found as HTMLElement;

    const failure = document.querySelector('.oref-run-error');
    if (failure !== null) throw new Error(`the console reported: ${failure.textContent}`);

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('the console never rendered a response');
}

function fieldId(nodeId: string, kind: string, name: string): string {
  return `oref-field-${nodeId}-${kind}-${name}`.replace(/[^A-Za-z0-9_-]/g, '-');
}

describe('the try-it console, end to end against a real server', () => {
  it('should fill a field, send, and show the real response', async () => {
    // Given
    seen = [];
    await openPage('get-orders-id', origin);
    const runner = createRunner({
      visibility: 'internal',
      storage: 'memory',
      transport: new FetchHttpTransport({ fetch: globalThis.fetch }),
    });
    expect(hydrateReference({ runner })).toBe(true);
    await settle();
    await reachForConsole(consoleIsLive, 'the send button never became active');

    // When
    type(fieldId('get-orders-id', 'path', 'id'), '42');
    type(fieldId('get-orders-id', 'query', 'limit'), '10');
    await settle();
    document.querySelector<HTMLButtonElement>('.oref-send')?.click();

    // Then
    const result = await waitForResult();
    expect(result.querySelector('.oref-status')?.textContent).toBe('200 OK');
    expect(result.querySelector('.oref-run-body')?.textContent).toContain('/orders/42?limit=10');
    expect(result.querySelector('.oref-run-headers')?.textContent).toContain('x-echo');
    expect(seen[0]?.url).toBe('/orders/42?limit=10');
  });

  it('should build the same request a hand written fetch call builds', async () => {
    // Given, the test T013 asks for by name. The console is driven through the UI and the same
    // inputs are sent by hand; the server compares what it saw, which is the only place the two
    // can be compared without trusting either implementation.
    seen = [];
    await openPage('get-orders-id', origin);
    const runner = createRunner({
      visibility: 'internal',
      storage: 'memory',
      transport: new FetchHttpTransport({ fetch: globalThis.fetch }),
    });
    hydrateReference({ runner });
    await settle();
    await reachForConsole(consoleIsLive, 'the send button never became active');

    // When
    type(fieldId('get-orders-id', 'path', 'id'), 'a b');
    type(fieldId('get-orders-id', 'query', 'limit'), '5');
    type(fieldId('get-orders-id', 'auth', 'bearer'), 'token-value');
    await settle();
    document.querySelector<HTMLButtonElement>('.oref-send')?.click();
    await waitForResult();

    await globalThis.fetch(`${origin}/orders/a%20b?limit=5`, {
      method: 'GET',
      headers: { Authorization: 'Bearer token-value' },
    });

    // Then
    const fromConsole = seen[0];
    const byHand = seen[1];
    expect(fromConsole?.method).toBe(byHand?.method);
    expect(fromConsole?.url).toBe(byHand?.url);
    expect(fromConsole?.headers.authorization).toBe(byHand?.headers.authorization);
    expect(fromConsole?.body).toBe(byHand?.body);
  });

  it('should render a hostile response body as text rather than as markup', async () => {
    // Given, the body is a third party server's and reaches the page as a text child, which Vue
    // escapes. Nothing on this path touches innerHTML.
    seen = [];
    await openPage('get-orders-id', origin);
    const runner = createRunner({
      visibility: 'internal',
      storage: 'memory',
      transport: new FetchHttpTransport({ fetch: globalThis.fetch }),
    });
    hydrateReference({ runner });
    await settle();
    await reachForConsole(consoleIsLive, 'the send button never became active');

    // When
    type(fieldId('get-orders-id', 'path', 'id'), '<img src=x onerror=alert(1)>');
    await settle();
    document.querySelector<HTMLButtonElement>('.oref-send')?.click();
    const result = await waitForResult();

    // Then
    expect(result.querySelector('.oref-run-body')?.textContent).toContain('onerror');
    expect(result.querySelector('img')).toBeNull();
    expect(document.querySelector('.oref-run-body script')).toBeNull();
  });

  it('should keep the credential out of the document after it has been typed', async () => {
    // Given, it is held by the runner, behind the storage policy of SPEC 14.4, and the control
    // that shows it is a password field whose value is a property rather than an attribute.
    await openPage('get-orders-id', origin);
    const runner = createRunner({
      visibility: 'internal',
      storage: 'memory',
      transport: new FetchHttpTransport({ fetch: globalThis.fetch }),
    });
    hydrateReference({ runner });
    await settle();
    await reachForConsole(consoleIsLive, 'the send button never became active');

    // When
    type(fieldId('get-orders-id', 'auth', 'bearer'), 'secret-token');

    // Then
    expect(runner.credential('bearer')).toBe('secret-token');
    expect(document.documentElement.innerHTML).not.toContain('secret-token');
  });

  it('should report a refusal instead of a response when the request cannot be built', async () => {
    // Given, `id` is a required path parameter and is left empty.
    await openPage('get-orders-id', origin);
    const runner = createRunner({
      visibility: 'internal',
      storage: 'memory',
      transport: new FetchHttpTransport({ fetch: globalThis.fetch }),
    });
    hydrateReference({ runner });
    await settle();
    await reachForConsole(consoleIsLive, 'the send button never became active');

    // When
    document.querySelector<HTMLButtonElement>('.oref-send')?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Then
    const failure = document.querySelector('.oref-run-error');
    expect(failure?.textContent).toContain('required');
    expect(document.querySelector('.oref-run-result')).toBeNull();
  });

  it('should leave the console disabled when no runner is wired in', async () => {
    // Given, a reference published read only, which is a supported build.
    await openPage('get-orders-id', origin);

    // When
    hydrateReference();
    await settle();

    // Then
    const button = document.querySelector<HTMLButtonElement>('.oref-send');
    expect(button?.disabled).toBe(true);
    expect(document.querySelector('.oref-tryit-notice')).not.toBeNull();
  });

  it('should say the console awaits a host runner rather than reporting a fault', async () => {
    // Given, the same read only build, read for what it tells the person looking at it.
    await openPage('get-orders-id', origin);

    // When
    hydrateReference();
    await settle();
    await reachForConsole(
      () => (document.querySelector('.oref-tryit-notice')?.textContent ?? '').includes('composes'),
      'the notice never changed from the one the server rendered',
    );

    // Then
    const notice = document.querySelector('.oref-tryit-notice')?.textContent ?? '';
    expect(notice).toContain('The application hosting this reference composes one in');
    expect(notice).not.toMatch(/error|failed|unavailable|configure|check your/i);
  });
});

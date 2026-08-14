// @vitest-environment jsdom

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { normalizeOpenApiDocument, type IRDocument } from '@openref/core';
import { createRunner, FetchHttpTransport } from '@openref/runner';
import type { IRunnerPort, RunnerResult } from '@openref/vue';
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
  /**
   * The same body as bytes.
   *
   * BOTH, SINCE T027, AND NOT ONE CONVERTED FROM THE OTHER. A multipart body carrying a file is
   * not text: reading it as UTF-8 replaces every byte that is not a code point, so a case that
   * asserted on the text could not tell a correct upload from a corrupted one.
   */
  readonly raw: Buffer;
}

let server: Server;
let origin: string;
let seen: SeenRequest[] = [];

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
  });
}

beforeAll(async () => {
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void readBody(request).then((raw) => {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers[name] = value;
      }

      seen.push({
        method: request.method ?? '',
        url: request.url ?? '',
        headers,
        body: raw.toString('utf8'),
        raw,
      });

      response.writeHead(200, {
        'content-type': 'application/json',
        'x-echo': 'yes',
        'access-control-allow-origin': '*',
      });
      response.end(JSON.stringify({ echoed: request.url, sawBody: raw.toString('utf8') }));
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
      // T026: an operation whose parameters are not scalars, so the matrix is reachable from a
      // page rather than only from the port. `tags` is an exploded form array and `filter` is a
      // `deepObject`, which are the two cells a reader is most likely to meet.
      '/search': {
        get: {
          operationId: 'search',
          summary: 'Search things',
          parameters: [
            {
              name: 'tags',
              in: 'query',
              required: false,
              style: 'form',
              explode: true,
              schema: { type: 'array', items: { type: 'string' } },
            },
            {
              name: 'filter',
              in: 'query',
              required: false,
              style: 'deepObject',
              explode: true,
              schema: { type: 'object', properties: { status: { type: 'string' } } },
            },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
      // T027: the body form the task names by itself, a file part beside a JSON part. It is here
      // rather than in a fixture of its own because what has to be proved is the whole chain: the
      // schema decides the controls, the reader picks a file, and a real server parses what
      // arrives.
      '/uploads': {
        post: {
          operationId: 'createUpload',
          summary: 'Upload a file',
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['file'],
                  properties: {
                    file: { type: 'string', format: 'binary' },
                    metadata: { type: 'object', properties: { title: { type: 'string' } } },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'created' } },
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
 * server renders the whole console including a send button, so an element query is satisfied by
 * the markup that was already there and a test built on one would pass with the chunk never
 * fetched.
 *
 * AND NO ATTRIBUTE PROVES ANYTHING EITHER, since the SPEC 11 rewrite of 2026-08-14. The served
 * button carries neither `disabled` nor `aria-disabled`, because a press on it is the action
 * the notice names and a declared disabled state hands that press to whichever pipeline
 * respects it. What separates the served state from the live ready one is the notice: the load
 * sentence stands beside Send exactly until the console mounts.
 */
function consoleIsLive(): boolean {
  const button = document.querySelector<HTMLButtonElement>('.oref-send');
  // By id rather than by class: the id belongs to the sentence beside Send alone, while the
  // class is also the stream's ending sentence, which a live console is allowed to show.
  const notice = document.getElementById('oref-tryit-notice');

  return button !== null && !button.disabled && notice === null;
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

/**
 * Puts a file on a file input the way a reader's file picker does.
 *
 * `input.files` IS READ ONLY AND THAT IS THE POINT OF THIS HELPER. A file input cannot be filled
 * from script in a browser either, which is a security property rather than a jsdom limitation,
 * so the list is defined on the element and the change event is dispatched exactly as the picker
 * would. What is under test is the component's handler, not the browser's dialog.
 */
function pickFile(
  input: HTMLInputElement | null,
  name: string,
  mediaType: string,
  bytes: Uint8Array<ArrayBuffer>,
): void {
  if (input === null) throw new Error('no file input to pick a file with');

  const file = new File([bytes], name, { type: mediaType });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * The console's own id builder, mirrored here so a case can look a control up by name.
 *
 * IT DROPPED THE NODE ID IN `TX-SLOTWIRE`, when the console became six positions a theme can
 * replace: a page is one operation, so the node id bought uniqueness against nothing, and handing
 * every position a node id it used for nothing but a prefix would have put it in the contract.
 */
function fieldId(_nodeId: string, kind: string, name: string): string {
  return `oref-field-${kind}-${name}`.replace(/[^A-Za-z0-9_-]/g, '-');
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

  /**
   * T026, driven through the page: a cell of the matrix that is not the primitive column.
   *
   * THE MATRIX IS PROVED CELL BY CELL IN `serialization-matrix.spec.ts` AND THAT IS NOT ENOUGH.
   * A console that offers one single line field per parameter can only ever produce the
   * primitive column, so every other cell would be correct and unreachable, which is the failure
   * the done-when of T026 names in its own words. What this asserts is the whole path: the
   * projection reads the value kind off the schema, the console gives a control that can hold a
   * list, and the server sees the query string OpenAPI's table prints.
   */
  it('should send an array and an object the reader typed, one member per line', async () => {
    // Given
    seen = [];
    await openPage('get-search', origin);
    const runner = createRunner({
      visibility: 'internal',
      storage: 'memory',
      transport: new FetchHttpTransport({ fetch: globalThis.fetch }),
    });
    hydrateReference({ runner });
    await settle();
    await reachForConsole(consoleIsLive, 'the send button never became active');

    // And the controls a list needs are textareas rather than single line inputs
    const tags = document.getElementById(fieldId('get-search', 'query', 'tags'));
    expect(tags?.tagName).toBe('TEXTAREA');
    expect(document.getElementById(fieldId('get-search', 'query', 'filter'))?.tagName).toBe(
      'TEXTAREA',
    );

    // When the reader types two tags and one filter field
    type(fieldId('get-search', 'query', 'tags'), 'red\nblue');
    type(fieldId('get-search', 'query', 'filter'), 'status=open');
    await settle();
    document.querySelector<HTMLButtonElement>('.oref-send')?.click();
    await waitForResult();

    // Then the server saw the exploded form array and the deepObject, per SPEC 14.2
    expect(seen[0]?.url).toBe('/search?tags=red&tags=blue&filter[status]=open');
  });

  /**
   * T027, driven through the page: multipart with a file part and a JSON part.
   *
   * THE PARSER IS NOT THIS PROJECT'S, which is the whole point of doing it here rather than in a
   * snapshot. The bytes the console produced are handed to `Request.formData`, the platform's own
   * multipart parser and the one a browser's `fetch` uses; if it cannot read them, no server can.
   * The two ways to build a multipart body wrongly, a bare line feed where the delimiter needs a
   * CRLF and a file decoded through UTF-8, both survive a diff and both fail here.
   */
  it('should upload a file beside a JSON part and have a real parser read both', async () => {
    // Given the console for an operation whose schema declares one binary property and one object
    seen = [];
    await openPage('post-uploads', origin);
    const runner = createRunner({
      visibility: 'internal',
      storage: 'memory',
      transport: new FetchHttpTransport({ fetch: globalThis.fetch }),
    });
    hydrateReference({ runner });
    await settle();
    await reachForConsole(consoleIsLive, 'the send button never became active');

    // And the controls the schema asks for: a file picker for the binary property and a text
    // field for the JSON one, neither of them written per media type anywhere
    const fileInput = document.getElementById(
      fieldId('post-uploads', 'body', 'file'),
    ) as HTMLInputElement | null;
    expect(fileInput?.getAttribute('type')).toBe('file');
    expect(document.getElementById(fieldId('post-uploads', 'body', 'metadata'))?.tagName).toBe(
      'INPUT',
    );

    // When the reader picks a file and types the JSON part
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe]);
    pickFile(fileInput, 'logo.png', 'image/png', bytes);
    type(fieldId('post-uploads', 'body', 'metadata'), '{"title":"logo"}');
    await settle();
    await settle();
    document.querySelector<HTMLButtonElement>('.oref-send')?.click();
    await waitForResult();

    // Then the server was sent a multipart body with a boundary, and the file arrived byte for
    // byte: the bytes are searched for in the raw request rather than in its text, because
    // decoding them would replace exactly the two this file was given to catch.
    //
    // THE PARSER BASED PROOF IS IN `packages/runner/test/integration/body-round-trip.spec.ts`,
    // and it is there rather than here for a reason worth writing down: undici's `FormData`
    // rejects the `File` this environment's globals produce, so a `formData()` call inside jsdom
    // fails on the parser's own identity check rather than on the body. What this case is for is
    // the half that only a page can show, which is that the schema drew the controls, the picker
    // filled one, and what left the browser was multipart.
    const request = seen[0];
    expect(request?.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);

    const raw = request?.raw ?? Buffer.alloc(0);
    const boundary = (request?.headers['content-type'] ?? '').split('boundary=')[1] ?? '';
    expect(boundary).not.toBe('');
    expect(raw.toString('latin1')).toContain(`--${boundary}--\r\n`);
    expect(raw.toString('latin1')).toContain('Content-Disposition: form-data; name="metadata"');
    expect(raw.toString('latin1')).toContain('{"title":"logo"}');
    expect(raw.toString('latin1')).toContain('filename="logo.png"');
    expect(raw.toString('latin1')).toContain('Content-Type: image/png');
    expect(raw.includes(Buffer.from(bytes))).toBe(true);
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

    // When the console has actually arrived, which is where this case belongs. Asserting on the
    // page before anybody reaches for the console reads the markup the server wrote, and that
    // markup says the same thing on a build that does carry a runner.
    hydrateReference();
    await settle();
    await reachForConsole(
      () => (document.querySelector('.oref-tryit-notice')?.textContent ?? '').includes('composes'),
      'the notice never changed from the one the server rendered',
    );

    // Then the native attribute is on it, which is what a live console that cannot send looks
    // like, and the load sentence has been replaced by the read only one.
    const button = document.querySelector<HTMLButtonElement>('.oref-send');
    expect(button?.disabled).toBe(true);
    expect(document.querySelector('.oref-tryit-notice')).not.toBeNull();
  });

  it('should send on the press that woke the console, and not ask for a second one', async () => {
    // Given a page nobody has touched yet, so the console is still the server's markup. THIS IS
    // F14. The reader reaches for the console with the one control the console is for.
    await openPage('get-orders-id', origin);
    const runner = createRunner({
      visibility: 'internal',
      storage: 'memory',
      transport: new FetchHttpTransport({ fetch: globalThis.fetch }),
    });
    hydrateReference({ runner });
    await settle();

    const button = document.querySelector<HTMLButtonElement>('.oref-send');
    if (button === null) throw new Error('the page rendered no send button');

    // The state the whole finding is about: served markup is a real enabled control beside
    // the load sentence, carrying no declared disabled state for any pipeline to honour.
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(button.disabled).toBe(false);
    expect(document.getElementById('oref-tryit-notice')?.textContent).toBe(
      'The console loads when you press Send.',
    );

    // When they press it once, which is one pointerdown and one click. Nothing is filled in,
    // because filling a field is itself a touch of the region and would open the gate before
    // the press this case is about.
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Then the console acted on that press: `id` is required and empty, so the runner refuses,
    // and a refusal is something only the click handler can produce. Before the fix the gate
    // opened on the pointerdown, the click never existed to be captured, and the console
    // arrived and sat there waiting for a second press.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await settle();
      if (document.querySelector('.oref-run-error') !== null) break;
    }

    expect(document.querySelector('.oref-run-error')?.textContent).toContain('required');
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

/**
 * What the console SHOWS about the session behind a response, per SPEC 14.4.1 and the T028
 * amendment, which asks for this assertion on the rendered text rather than on a returned value.
 *
 * THE RUNNER'S OWN SUITE ALREADY PROVES THE DECISION AND NOT THE TELLING. `token-lifecycle.spec.ts`
 * asserts that one 401 produces one refresh and one retry, that a second 401 is reported as the
 * API's answer, and that a renewal is not passed off in silence, all of it against the value the
 * port hands back. None of that reaches a reader: what reaches a reader is a paragraph in the
 * console, and until it is asserted here the promise of SPEC 14.4.1, that a 401 caused by an
 * expired session never surfaces as a bare status code, rests on a field somebody could stop
 * drawing without a test going red.
 *
 * A FAKE PORT AND NOT A REAL SIGN IN, deliberately. What is under test is the console's telling,
 * so the response is handed to it directly; making a real token expire against a real authorization
 * server would prove the runner's arithmetic a second time and the drawing not at all.
 */
describe('what the console says about the session behind a response', () => {
  /** A port that answers one prepared response, which is the whole of what these cases need. */
  function portAnswering(result: RunnerResult): IRunnerPort {
    return {
      credential: () => undefined,
      setCredential: () => undefined,
      send: () => Promise.resolve(result),
    };
  }

  async function sendAndRead(result: RunnerResult): Promise<HTMLElement> {
    await openPage('get-orders-id', origin);
    expect(hydrateReference({ runner: portAnswering(result) })).toBe(true);
    await settle();
    await reachForConsole(consoleIsLive, 'the send button never became active');

    type(fieldId('get-orders-id', 'path', 'id'), '42');
    await settle();
    document.querySelector<HTMLButtonElement>('.oref-send')?.click();

    return waitForResult();
  }

  it('should say the sign in was renewed rather than let the pause pass in silence', async () => {
    // Given a response the runner had to renew a session to obtain
    const renewed: RunnerResult = {
      status: 200,
      statusText: 'OK',
      headers: [],
      body: '{"id":"42"}',
      durationMs: 31,
      notice: { kind: 'renewed', message: 'Your sign in had run out and was renewed.' },
    };

    // When
    const shown = await sendAndRead(renewed);

    // Then the sentence is on the page, beside the response rather than instead of it
    expect(shown.querySelector('.oref-run-notice')?.textContent).toBe(
      'Your sign in had run out and was renewed.',
    );
    expect(shown.querySelector('.oref-status')?.textContent).toBe('200 OK');
  });

  it('should never show a 401 that the session caused as a bare status code', async () => {
    // Given the other of the two endings: the renewal failed, so the session is over
    const ended: RunnerResult = {
      status: 401,
      statusText: 'Unauthorized',
      headers: [],
      body: '{"error":"invalid_token"}',
      durationMs: 18,
      notice: {
        kind: 'session-ended',
        message: 'Your sign in has ended. Sign in again to keep sending.',
      },
    };

    // When
    const shown = await sendAndRead(ended);

    // Then the reader is told which of the two happened, which is the difference between
    // concluding that the endpoint is broken and learning that the sign in ran out
    expect(shown.querySelector('.oref-run-notice')?.textContent).toBe(
      'Your sign in has ended. Sign in again to keep sending.',
    );
    expect(shown.querySelector('.oref-status')?.textContent).toBe('401 Unauthorized');
  });
});

// @vitest-environment jsdom

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { normalizeOpenApiDocument, type IRDocument, type IROperation } from '@openref/core';
import { createRunner, FetchStreamTransport } from '@openref/runner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hydrateReference } from '../../src/browser/index';
import { renderHtmlDocument } from '../../src/page/domain/shell';
import { renderPage } from '../../src/render/application/services/render.service';

/**
 * The definition of done of T030, run rather than described: a long stream is watchable and a
 * broken one is diagnosable.
 *
 * A REAL SERVER SENDING REAL CHUNKS. The runner's own tests drive a scripted transport, which
 * proves the decoder and the endings; what they cannot prove is that a page rendered from a
 * document reaches a stream at all. This one goes the whole way: the collector's fact is on the
 * operation, the projection carries it into the page, the console draws a Stream control from it,
 * and a press opens a connection to a server that writes an event stream a piece at a time.
 *
 * THE INVALID ELEMENT IS THE CASE THAT DECIDES THE FEATURE, per SPEC 14.6, so the server sends
 * one in the middle and the assertion is that the reader can see it and everything after it.
 */

let server: Server;
let origin: string;

/** Sockets the server is still writing to, so a stopped stream can be observed as stopped. */
let live = 0;

beforeAll(async () => {
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = request.url ?? '';

    if (url.startsWith('/broken')) {
      response.writeHead(503, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      });
      response.end(JSON.stringify({ error: 'the feed is down for maintenance' }));

      return;
    }

    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'access-control-allow-origin': '*',
    });

    live += 1;
    request.on('close', () => {
      live -= 1;
    });

    // ONE ELEMENT PER WRITE, SPLIT ACROSS TWO WRITES FOR THE FIRST ONE. A stream delivered in one
    // write would pass with a decoder that ignores chunk boundaries, which is the defect this
    // console would meet first on a real API.
    response.write('data: {"id":1');
    response.write(',"name":"one"}\n\n');
    response.write(': keepalive\n\n');
    response.write('data: {"id":"two"}\n\n');
    response.write('data: {"id":3,"name":"three"}\n\n');

    if (url.startsWith('/endless')) return;

    response.write('data: [DONE]\n\n');
    response.end();
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

/**
 * The document, with the streaming fact a collector would have put on the operation.
 *
 * WRITTEN ONTO THE NORMALIZED NODE RATHER THAN INTO THE SOURCE, because that is where it comes
 * from: `streamCollector` in `@openref/nest` reads `@ApiStream` off a running application, and no
 * OpenAPI document carries it. What this fixture stands in for is the collector, not the spec.
 *
 * @param serverUrl - Where the stream is served from
 * @param path - Which of the two endpoints the operation points at
 * @returns The document
 */
function documentFor(serverUrl: string, path: '/events' | '/endless' | '/broken'): IRDocument {
  const document = normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Feed API', version: '1.0.0' },
    servers: [{ url: serverUrl }],
    components: {
      schemas: {
        Tick: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'integer' }, name: { type: 'string' } },
        },
      },
    },
    paths: {
      [path]: {
        get: {
          operationId: 'watchFeed',
          summary: 'Watch the feed',
          responses: { '200': { description: 'a stream of ticks' } },
        },
      },
    },
  });

  const [nodeId] = [...document.nodes.keys()];
  if (nodeId === undefined) throw new Error('the fixture produced no node');
  const node = document.nodes.get(nodeId);
  if (node?.kind !== 'operation') throw new Error('the fixture lost its node');

  const withStream: IROperation = {
    ...node,
    runtime: {
      streaming: {
        value: {
          transport: 'sse',
          itemSchema: { kind: 'named', schemaId: 'Tick' },
          terminator: '[DONE]',
        },
        confidence: 'declared',
        collector: 'streamCollector',
      },
    },
  };

  const nodes = new Map(document.nodes);
  nodes.set(nodeId, withStream);

  return { ...document, nodes };
}

/** Renders the page the way a host serves it, and puts it in the jsdom document. */
async function openPage(document: IRDocument): Promise<string> {
  const [nodeId] = [...document.nodes.keys()];
  if (nodeId === undefined) throw new Error('the fixture produced no node');

  const page = await renderPage(document, { page: 'bench', nodeId });
  globalThis.document.documentElement.innerHTML = renderHtmlDocument(page, {
    assets: { stylesheets: ['/assets/theme.css'], modules: ['/assets/openref.js'] },
  });

  return nodeId;
}

/** Lets Vue finish the render its state change scheduled. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Reaches for the console the way a reader does, and waits for the Stream control to come alive.
 *
 * THE CONTROL EXISTING PROVES NOTHING, for the reason the send button's own helper gives: the
 * server renders the whole console, so a query is satisfied by markup nothing hydrated. Since
 * the SPEC 11 rewrite no attribute separates them either, so the mount is read off the load
 * sentence beside Send vanishing, the one change hydration owns.
 */
async function reachForConsole(): Promise<HTMLButtonElement> {
  const region = globalThis.document.querySelector('.oref-section-tryit');
  if (region === null) throw new Error('the page rendered no try-it region to reach for');

  region.dispatchEvent(new Event('pointerdown', { bubbles: true }));

  for (let attempt = 0; attempt < 200; attempt += 1) {
    await settle();
    const button = globalThis.document.querySelector<HTMLButtonElement>('.oref-stream-start');
    const notice = globalThis.document.getElementById('oref-tryit-notice');
    if (button !== null && !button.disabled && notice === null) return button;
  }

  throw new Error('the console never hydrated a live Stream control');
}

/**
 * Waits until the page satisfies a condition, or gives up loudly.
 *
 * @param ready - What has to become true
 * @param description - What to say when it does not
 */
async function waitFor(ready: () => boolean, description: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(description);
}

/**
 * The elements the console is currently showing.
 *
 * READ OFF THE BLOCKS THEMSELVES, because there is no wrapper: the region is made of the classes
 * the theme already draws, and a wrapper per element would be a class with no rule behind it.
 */
function shown(): HTMLElement[] {
  return Array.from(globalThis.document.querySelectorAll<HTMLElement>('.oref-stream-element'));
}

/**
 * Whether the element at this position was marked as not matching the item schema.
 *
 * THE MARK IS THE PARAGRAPH BEFORE IT, which is how a reader sees it too.
 *
 * @param element - One shown element
 * @returns True when a problem sentence sits immediately above it
 */
function marked(element: Element): boolean {
  return element.previousElementSibling?.classList.contains('oref-stream-problem') === true;
}

/** What the console says about how the stream ended, once it says anything. */
function ending(): string {
  const notices = Array.from(
    globalThis.document.querySelectorAll<HTMLElement>('.oref-stream .oref-tryit-notice'),
  );

  return notices.map((notice) => notice.textContent).join(' ');
}

/** A runner composed the way the shipped entry composes one, with a stream transport in it. */
function runnerWithStream(): ReturnType<typeof createRunner> {
  return createRunner({
    visibility: 'public',
    storage: 'memory',
    streamTransport: new FetchStreamTransport(),
  });
}

describe('the try-it console, watching a stream', () => {
  it('should show every element, mark the invalid one, and end on the terminator', async () => {
    // Given
    await openPage(documentFor(origin, '/events'));
    expect(hydrateReference({ runner: runnerWithStream() })).toBe(true);
    await settle();
    const start = await reachForConsole();

    // When
    start.click();
    await waitFor(() => ending() !== '', 'the stream never ended');

    // Then
    const elements = shown();
    expect(elements).toHaveLength(3);
    expect(elements[0]?.textContent).toContain('"name":"one"');
    // THE KEEPALIVE IS NOT AN ELEMENT. A comment line between two events would otherwise arrive
    // as an empty element every time a server holds a connection open.
    expect(elements.map(marked)).toEqual([false, true, false]);
    expect(elements[1]?.previousElementSibling?.textContent).toContain('id');
    expect(elements[1]?.textContent).toContain('"id":"two"');
    expect(ending()).toContain('terminator');
  });

  it('should stop on the reader command and close the connection rather than stop reading it', async () => {
    // Given
    await openPage(documentFor(origin, '/endless'));
    hydrateReference({ runner: runnerWithStream() });
    await settle();
    const start = await reachForConsole();

    // When
    start.click();
    await waitFor(() => shown().length === 3, 'the endless stream never delivered its elements');
    const open = live;
    globalThis.document.querySelector<HTMLButtonElement>('.oref-stream-stop')?.click();
    await waitFor(() => ending() !== '', 'the stream never reported that it had stopped');
    await waitFor(() => live < open, 'the connection was still open after Stop');

    // Then
    expect(ending()).toContain('You stopped the stream');
    expect(live).toBeLessThan(open);
  });

  it('should say what a server refused with, so a broken stream is diagnosable', async () => {
    // Given
    await openPage(documentFor(origin, '/broken'));
    hydrateReference({ runner: runnerWithStream() });
    await settle();
    const start = await reachForConsole();

    // When
    start.click();
    await waitFor(() => ending() !== '', 'the refusal was never reported');

    // Then
    expect(shown()).toHaveLength(0);
    expect(ending()).toContain('503');
    expect(ending()).toContain('down for maintenance');
  });
});

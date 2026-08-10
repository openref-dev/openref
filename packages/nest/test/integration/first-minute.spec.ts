// @vitest-environment jsdom

import { runInThisContext } from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, freePort, FIXTURE_APPS, type BootedApp } from '../mocks/app-process';

/**
 * SPEC 2's first minute, end to end, with nothing simulated.
 *
 * A real NestJS application, booted in its own process from the example in `examples/`. Its
 * own served HTML, put into a document. Its own served browser bundle, executed. Then a click
 * on the send button, and a request that has to arrive at the controller.
 *
 * EVERY PIECE IS THE SHIPPED ONE. The console has an integration test in `@openref/render` that
 * hands it a runner by hand, and that test passed for the whole of T013 while the bundle a
 * reader downloads had no runner in it at all. This one runs the built file, so the thing
 * under test is the artifact rather than the arrangement.
 *
 * The bundle is executed with `node:vm` rather than imported. Two reasons, and both are about
 * running the shipped bytes rather than something like them: the test runner would otherwise
 * transform the file on its way in, and a module is evaluated once per process, while every
 * one of these tests needs it to run again over a fresh document. It carries no import of any
 * own, which `module-formats.spec.ts` asserts separately, so there is nothing to resolve.
 */

const app = FIXTURE_APPS[0];

let booted: BootedApp;
let bundleCode: string;

/**
 * Fetches text from the booted application.
 *
 * @param path - Absolute path
 * @returns The body
 */
async function get(path: string): Promise<string> {
  const response = await fetch(`${booted.url}${path}`);
  return response.text();
}

/**
 * Puts a served page into the document and runs the served bundle over it.
 *
 * @param path - Page to open
 */
async function open(path: string): Promise<void> {
  const html = await get(path);
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';

  document.body.innerHTML = body;

  runInThisContext(bundleCode, { filename: 'openref.js' });
  await new Promise((resolve) => setTimeout(resolve, 20));
}

beforeAll(async () => {
  if (app === undefined) throw new Error('no fixture application is configured');

  // THE APPLICATION HAS TO KNOW ITS OWN ORIGIN BEFORE IT STARTS, which is why the port is
  // chosen here rather than by the operating system. The example declares its server as `/`
  // by default, meaning "wherever this document is served from", and a document is served
  // from wherever the reader's browser fetched it. This document is fetched over HTTP and
  // then parsed into a jsdom whose own address is not that origin, so a relative server url
  // would resolve against jsdom instead of against the application. Giving the example its
  // real public url removes the ambiguity rather than papering over it.
  const port = await freePort();
  booted = await bootApp(app, 'express', {
    port,
    env: { PUBLIC_URL: `http://127.0.0.1:${String(port)}` },
  });

  const html = await get('/docs');
  const href = /src="([^"]+openref\.[^"]+\.js)"/.exec(html)?.[1] ?? '';
  bundleCode = await get(href);
}, 60_000);

afterAll(async () => {
  await booted.stop();
});

describe('the first minute', () => {
  it('should serve a page that already reads as documentation before any script runs', async () => {
    // Given, the server rendered markup, which is what a reader without JavaScript gets.
    const html = await get('/docs/get-orders-id');

    // Then
    expect(html).toContain('Read one order');
    expect(html).toContain('oref-app');
  });

  it('should hydrate the served markup with the served bundle', async () => {
    // Given
    await open('/docs/get-orders-id');

    // When
    const console_ = document.querySelector('.oref-section-tryit');

    // Then
    expect(console_).not.toBeNull();
  });

  it('should enable the console, because this bundle has a runner bound into it', async () => {
    // Given
    await open('/docs/get-orders-id');

    // When
    const button = document.querySelector<HTMLButtonElement>('.oref-send');

    // Then
    // The whole of T014 in one assertion. Before the composition existed this button was
    // disabled in the shipped bundle and nothing was red.
    expect(button?.disabled).toBe(false);
  });

  it('should reach the controller when the reader fills a field and sends', async () => {
    // Given
    await open('/docs/get-orders-id');

    const field = document.querySelector<HTMLInputElement>('.oref-tryit-form input[id*="path"]');
    if (field === null) throw new Error('the path parameter field was not rendered');

    field.value = 'ord_1024';
    field.dispatchEvent(new Event('input', { bubbles: true }));

    // When
    document.querySelector<HTMLButtonElement>('.oref-send')?.click();
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Then
    const status = document.querySelector('.oref-status')?.textContent ?? '';
    const body = document.querySelector('.oref-run-body')?.textContent ?? '';
    expect(document.querySelector('.oref-run-error')?.textContent ?? '').toBe('');
    expect(status).toContain('200');
    expect(body).toContain('ord_1024');
  }, 30_000);
});

// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from 'vue';
import { normalizeOpenApiDocument } from '@openref/core';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { buildPageModel } from '../../src/page/domain/page-model';
import { ReferenceApp } from '../../src/components/ReferenceApp';
import { DEFERRABLE_KEY } from '../../src/components/deferrable';
import { EAGER_COMPONENTS } from '../../src/components/eager';

/**
 * The copy control of the call samples block.
 *
 * WHY IT READS THE DOCUMENT AND NOT THE MODEL. `CodeSampleModel` keeps `lang`, `label` and
 * `sourceHtml` and drops the raw source, and `SlotProps['CodeSample']` is frozen at three
 * members, so a fourth prop carrying the text would be a major version of the theme contract.
 * The rendered `.oref-code code` holds the same text in both shipped themes, because the
 * highlighted block is the server's own markup and a theme only decides what surrounds it.
 *
 * WHY IT IS DRAWN BY `NodePanel` AND NOT INSIDE THE SLOT. One control for both themes, no prop
 * added to a frozen map, and one copy of the fallback rather than one per theme.
 *
 * THE THIRD CASE IS THE ONE WORTH HAVING. A page served over plain HTTP has no clipboard at
 * all, because `navigator.clipboard` is undefined outside a secure context, and an internal
 * host without TLS is a real deployment of this product. A control that silently did nothing
 * there is the dead control SPEC 11 forbids.
 */

const markdown = await createMarkdownRenderer();

let mounted: { unmount(): void } | null = null;

/** An operation carrying the call samples of SPEC 18, level 3. */
function sampleDocument(): ReturnType<typeof normalizeOpenApiDocument> {
  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Orders API', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    paths: {
      '/orders': {
        get: {
          operationId: 'listOrders',
          summary: 'List orders',
          responses: { '200': { description: 'ok' } },
          'x-codeSamples': [
            { lang: 'bash', label: 'cURL', source: 'curl https://api.example.com/orders' },
          ],
        },
      },
    },
  });
}

/** Mounts the operation page and returns its host. */
function mount(): HTMLElement {
  const document_ = sampleDocument();
  const nodeId = [...document_.nodes.keys()][0] ?? '';
  const host = document.createElement('div');
  document.body.append(host);

  const app = createApp(ReferenceApp, { page: buildPageModel(document_, { nodeId, markdown }) });
  app.provide(DEFERRABLE_KEY, EAGER_COMPONENTS);
  app.mount(host);
  mounted = app;

  return host;
}

/** Puts a clipboard on the window, or takes it away, and reports what it was written. */
function withClipboard(writer: null | (() => Promise<void>)): string[] {
  const written: string[] = [];

  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value:
      writer === null
        ? undefined
        : {
            writeText: (text: string): Promise<void> => {
              written.push(text);
              return writer();
            },
          },
  });

  return written;
}

function control(host: HTMLElement): HTMLElement | null {
  return host.querySelector('[data-oref-copy]');
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: undefined,
  });
});

describe('the copy control in the call samples block', () => {
  it('should offer a named control beside a sample and copy that sample text', async () => {
    // Given a page whose samples block holds one highlighted sample
    const written = withClipboard(() => Promise.resolve());
    const host = mount();
    const sample = host.querySelector('.oref-section-samples .oref-code code')?.textContent;
    expect(sample).toBe('curl https://api.example.com/orders');

    // And the control is there, named, and a button rather than something pretending to be one
    const button = control(host);
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.textContent).toBe('Copy the sample');
    expect(button?.getAttribute('type')).toBe('button');

    // When
    button?.click();
    await Promise.resolve();
    await Promise.resolve();

    // Then the text the reader can see is what was written, and the control says it happened
    expect(written).toEqual(['curl https://api.example.com/orders']);
    expect(control(host)?.textContent).toBe('Copied');
  });

  it('should say the clipboard is unavailable rather than doing nothing', async () => {
    // Given a page with no clipboard behind it, which is every page served over plain HTTP
    withClipboard(null);
    const host = mount();
    const button = control(host);

    // Then the subject is present before anything is said about the absence
    expect(button?.textContent).toBe('Copy the sample');

    // When
    button?.click();
    await Promise.resolve();

    // Then the reader is told, and is told what to do instead
    expect(control(host)?.textContent).toBe('Copy unavailable, select the sample');
  });

  it('should say the same when the clipboard is there and refuses', async () => {
    // Given a clipboard that rejects, which is what a browser does when the document is not
    // focused or the permission was denied
    withClipboard(() => Promise.reject(new Error('denied')));
    const host = mount();

    // When
    control(host)?.click();
    await Promise.resolve();
    await Promise.resolve();

    // Then the failure reaches the reader rather than the console
    expect(control(host)?.textContent).toBe('Copy unavailable, select the sample');
  });

  it('should announce its own state, since the label is what changed', () => {
    // Given, a reader who cannot see the label change is told the same thing by the live region
    const host = mount();

    // When, Then
    expect(control(host)?.getAttribute('aria-live')).toBe('polite');
  });

  it('should offer no control where there is no sample to copy', () => {
    // Given an operation with no samples at all, which is every operation of a document that
    // declares none: a button offering to copy a block that is not there is a dead control.
    const document_ = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'Orders API', version: '1.0.0' },
      paths: { '/orders': { get: { responses: { '200': { description: 'ok' } } } } },
    });
    const nodeId = [...document_.nodes.keys()][0] ?? '';
    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp(ReferenceApp, { page: buildPageModel(document_, { nodeId, markdown }) });
    app.provide(DEFERRABLE_KEY, EAGER_COMPONENTS);
    app.mount(host);
    mounted = app;

    // When, Then
    expect(host.querySelector('[data-oref-copy]')).toBeNull();
  });
});

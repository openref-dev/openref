// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineReferenceElement } from '../../src/browser/element';
import { renderHtmlDocument } from '../../src/page/domain/shell';
import { renderPage } from '../../src/render/application/services/render.service';
import { smallDocument } from '../mocks/documents';

/**
 * The Web Component over a served page, in both DOM modes, per SPEC 10.3.
 *
 * THE PAGE IT EMBEDS IS THE REAL ONE: rendered by `renderPage` and assembled by
 * `renderHtmlDocument`, then served by a stubbed `fetch`, so what the element adopts is what
 * the module serves and not a fixture that could drift from it. What jsdom can prove is the
 * mechanism, adoption, hydration, refusal; what only a browser can prove, the isolation
 * consequences of each mode against a real stylesheet, lives in the browser suite.
 */

/** One rendered page of the fixture document, as the server would serve it. */
async function servedPage(): Promise<string> {
  const rendered = await renderPage(smallDocument(), { basePath: '/docs' });
  return renderHtmlDocument(rendered, {
    assets: { stylesheets: ['/docs/_assets/theme.css', '/docs/_assets/fonts.css'] },
  });
}

/** Registers a fresh element class under a unique tag, since a registry entry cannot leave. */
let counter = 0;
function register(): string {
  counter += 1;
  const tag = `openref-reference-t${String(counter)}`;
  customElements.define(tag, defineReferenceElement());
  return tag;
}

/** Waits until the element settled: hydrated markup or a failure notice. */
async function settled(host: HTMLElement): Promise<void> {
  await vi.waitFor(() => {
    if (
      !host.hasAttribute('data-oref-embedded') &&
      host.querySelector('.oref-embed-error') === null
    ) {
      throw new Error('the element has not settled yet');
    }
  });
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const href = String(input);
      if (href.endsWith('/docs/get-orders-id')) {
        return new Response(await servedPage(), {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      return new Response('not here', { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.head.replaceChildren();
});

describe('the reference element, shadow mode', () => {
  it('should adopt the served page into its shadow root and hydrate it there', async () => {
    // Given
    const tag = register();
    const host = document.createElement(tag);
    host.setAttribute('href', '/docs/get-orders-id');
    document.body.append(host);

    // When
    await settled(host);

    // Then the markup, the state and the stylesheets are inside the boundary, hydrated
    const root = host.shadowRoot;
    expect(root).not.toBeNull();
    expect(host.hasAttribute('data-oref-embedded')).toBe(true);
    expect(root?.querySelector('.oref-root')).not.toBeNull();
    expect(root?.getElementById('oref-state')).not.toBeNull();
    expect(root?.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(2);

    // And the stylesheet links are hoisted to the head for the font registry, once each
    const hoisted = document.head.querySelectorAll('link[data-oref-embed-fonts]');
    expect(hoisted).toHaveLength(2);
  });
});

describe('the reference element, light DOM mode', () => {
  it('should adopt the served page into its own subtree, where host CSS applies', async () => {
    // Given
    const tag = register();
    const host = document.createElement(tag);
    host.setAttribute('href', '/docs/get-orders-id');
    host.setAttribute('shadow', 'false');
    document.body.append(host);

    // When
    await settled(host);

    // Then there is no boundary: the markup is page markup, which is the mode's whole point
    expect(host.shadowRoot).toBeNull();
    expect(host.hasAttribute('data-oref-embedded')).toBe(true);
    expect(host.querySelector('.oref-root')).not.toBeNull();
    expect(host.querySelector('#oref-state')).not.toBeNull();

    // And nothing was hoisted, because the links already live in the document
    expect(document.head.querySelectorAll('link[data-oref-embed-fonts]')).toHaveLength(0);
  });
});

describe('what the element refuses, in words', () => {
  it('should refuse an href that names another origin, before any fetch', async () => {
    // Given
    const tag = register();
    const host = document.createElement(tag);
    host.setAttribute('href', 'https://evil.example/docs');
    document.body.append(host);

    // When
    await settled(host);

    // Then
    expect(host.querySelector('.oref-embed-error')?.textContent).toContain('path on this origin');
    expect(vi.mocked(fetch).mock.calls).toHaveLength(0);
  });

  it('should say when the page it fetched is not a served reference', async () => {
    // Given
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('<html><body>a portal</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const tag = register();
    const host = document.createElement(tag);
    host.setAttribute('href', '/portal');
    document.body.append(host);

    // When
    await settled(host);

    // Then
    expect(host.querySelector('.oref-embed-error')?.textContent).toContain(
      'not a served reference page',
    );
  });
});

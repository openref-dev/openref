// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { hydrateReference, readPageState } from '../../src/browser/index';
import { renderHtmlDocument } from '../../src/page/domain/shell';
import { renderPage } from '../../src/render/application/services/render.service';
import { smallDocument } from '../mocks/documents';

/**
 * Server markup and client markup have to agree.
 *
 * A hydration mismatch is silent: Vue patches the difference and the page looks right,
 * while every assumption about the server render having produced the final bytes is now
 * false. Vue reports the mismatch as a warning, so the warning is what is asserted.
 */
async function serveDocument(nodeId?: string): Promise<string> {
  const document_ = smallDocument();
  const page = await renderPage(document_, nodeId === undefined ? {} : { nodeId });

  return renderHtmlDocument(page, {
    nonce: 'r4nd0mNONCEvalue',
    assets: { stylesheets: ['/assets/theme.css'], modules: ['/assets/openref.js'] },
  });
}

afterEach(() => {
  document.documentElement.innerHTML = '';
});

describe('hydrateReference', () => {
  it('should hydrate the server rendered page without a mismatch', async () => {
    // Given
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    document.documentElement.innerHTML = await serveDocument();

    // When
    const hydrated = hydrateReference();

    // Then
    expect(hydrated).toBe(true);
    const messages = [...warn.mock.calls, ...error.mock.calls].map((call) => String(call[0]));
    expect(messages.filter((message) => message.includes('Hydration'))).toEqual([]);
  });

  it('should hydrate a node page without a mismatch', async () => {
    // Given
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ids = [...smallDocument().nodes.keys()];
    document.documentElement.innerHTML = await serveDocument(ids[0]);

    // When
    const hydrated = hydrateReference();

    // Then
    expect(hydrated).toBe(true);
    const messages = [...warn.mock.calls, ...error.mock.calls].map((call) => String(call[0]));
    expect(messages.filter((message) => message.includes('Hydration'))).toEqual([]);
  });

  it('should execute nothing that a hostile description smuggled into the state', async () => {
    // Given
    document.documentElement.innerHTML = await serveDocument();

    // When
    hydrateReference();

    // Then
    expect(document.querySelectorAll('script[type="application/json"]')).toHaveLength(1);
    expect(Reflect.get(globalThis, 'pwned')).toBeUndefined();
  });

  it('should do nothing when there is no mount point', () => {
    // Given
    document.documentElement.innerHTML = '<body><p>not a reference</p></body>';

    // When
    const hydrated = hydrateReference();

    // Then
    expect(hydrated).toBe(false);
  });

  it('should leave the server markup alone when the state block was stripped', async () => {
    // Given
    const html = await serveDocument();
    document.documentElement.innerHTML = html.replace(
      /<script type="application\/json"[\s\S]*?<\/script>/,
      '',
    );

    // When
    const hydrated = hydrateReference();

    // Then
    expect(hydrated).toBe(false);
    expect(document.querySelector('.oref-root')).not.toBeNull();
  });
});

describe('readPageState', () => {
  it('should return null for a state block that is not json', () => {
    // Given
    document.documentElement.innerHTML =
      '<body><script type="application/json" id="oref-state">not json</script></body>';

    // When
    const state = readPageState(document);

    // Then
    expect(state).toBeNull();
  });

  it('should read the model back exactly as it was serialized', async () => {
    // Given
    document.documentElement.innerHTML = await serveDocument();

    // When
    const state = readPageState(document);

    // Then
    expect(state?.title).toBe('Orders API');
    // The literal is deliberate rather than the exported constant: the version is part of the
    // render cache key, and a page model that grew a field without the version moving would be
    // served from a cache written by code that did not produce it. T013 added `run` and took it
    // to 2; T012-R2 made the navigation a slice and took it to 3, and that one had to move,
    // because a cached page written before it carries an index of the whole document.
    expect(state?.pageModelVersion).toBe(3);
  });
});

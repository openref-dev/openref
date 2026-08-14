// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { hydrateReference, readPageState } from '../../src/browser/index';
import { renderHtmlDocument } from '../../src/page/domain/shell';
import { renderPage } from '../../src/render/application/services/render.service';
import { runtimeDocument, smallDocument } from '../mocks/documents';

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

  /**
   * The Health panel, whose findings the state block no longer carries.
   *
   * THIS IS THE CASE THAT MAKES F43's FIX SAFE RATHER THAN CHEAP. Taking the report out of the
   * state block means the client renders the panel position from a boolean and has nothing to
   * draw the contents from, so the question is what hydration does to markup the client vdom has
   * no children for. It adopts it: a vnode with no children takes neither of the two branches
   * Vue hydrates children with. If it had instead taken the array branch, every finding would
   * have been removed from the page by the very hydration that was supposed to leave it alone,
   * and the page would look right until a reader opened a group.
   */
  it('should keep every finding in the panel after hydrating it from a boolean', async () => {
    // Given an overview page with a Health panel on it
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const built = runtimeDocument();
    const page = await renderPage(built);
    document.documentElement.innerHTML = renderHtmlDocument(page, {
      nonce: 'r4nd0mNONCEvalue',
      assets: { stylesheets: ['/assets/theme.css'], modules: ['/assets/openref.js'] },
    });

    const panel = document.querySelector('.oref-section-health');
    const before = panel?.querySelectorAll('.oref-drift').length ?? 0;
    expect(before).toBeGreaterThan(0);

    // And the state block it hydrates from says only that the panel is there
    expect(page.stateJson).toContain('"healthRendered":true');
    expect(page.stateJson).not.toContain(built.health?.drift[0]?.message ?? 'nothing');

    // When
    const hydrated = hydrateReference();

    // Then the markup the server wrote is still the markup on the page, and untorn
    expect(hydrated).toBe(true);
    const after = document.querySelector('.oref-section-health');
    expect(after?.querySelectorAll('.oref-drift')).toHaveLength(before);
    expect(after?.querySelectorAll('details').length).toBeGreaterThan(0);
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
    // because a cached page written before it carries an index of the whole document. T023 added
    // `runtime` and `health` and took it to 4, and that one had to move for the same reason
    // reversed: a page cached before the runtime pass ran carries neither, and would be served
    // to a reader as an application that says nothing about itself. F43 took the report back out
    // of the state block and put `healthRendered` in its place, which is 5: a page cached before
    // it carries a report the client would try to draw with a component that no longer draws.
    // T027 replaced `run.bodyMediaTypes`, a list of strings, with `run.body`, a list carrying the
    // editor each media type asks for, and that is 6: a page cached before it hydrates a console
    // that cannot decide which of the three body editors to draw. T028 put the OAuth2 flows on
    // every security scheme and the cause on the two a browser cannot send, and that is 7: a page
    // cached before it draws no sign in for an `oauth2` scheme and nothing at all where
    // `mutualTLS` should say what it needs, which is the absence the field exists to prevent.
    // T033 added `proxyPath`, the fact the runner factory reads to choose the proxy transport,
    // and that is 9 (8 was TX-SLOTWIRE): a page cached before it sends directly on a host whose
    // proxy is up, which is the defence existing and not being offered.
    expect(state?.pageModelVersion).toBe(9);
  });
});

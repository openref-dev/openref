// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from 'vue';
import { ReferenceApp } from '../../src/components/ReferenceApp';
import { DEFERRABLE_KEY } from '../../src/components/deferrable';
import { EAGER_COMPONENTS } from '../../src/components/eager';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { buildNavigation, buildPageModel } from '../../src/page/domain/page-model';
import { renderPage } from '../../src/render/application/services/render.service';
import { hydrateReference } from '../../src/browser/index';
import { largeDocument } from '../mocks/documents';
import type { PageModel } from '../../src/page/domain/page-model';

/**
 * The half of the navigation that is not on the page, and how it gets there.
 *
 * T012-R2 took the whole index out of the state block and left the page carrying what it can
 * draw. What has to be true after that is what this file asserts: a reader who opens a closed
 * group sees what is in it, a reader who opens the palette can search the whole document, both
 * cost one request between them, and a page whose request fails is still a page.
 *
 * THE MARKUP HAS TO SURVIVE HYDRATION UNCHANGED, and that is the assertion with the sharpest
 * teeth here. The server renders the slice and the client renders it again before anything is
 * fetched; if the two disagreed, every page of every document would hydrate with a mismatch,
 * and Vue's recovery from one is to throw the server's markup away and re-render.
 */

const markdown = await createMarkdownRenderer();
const NODE_COUNT = 200;

let mounted: { unmount(): void } | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
});

function mountPage(page: PageModel, loadNavigation?: () => Promise<unknown>): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);

  const app = createApp(ReferenceApp, {
    page,
    basePath: '',
    ...(loadNavigation === undefined ? {} : { loadNavigation }),
  });
  // THE EAGER REGISTRY, BECAUSE THESE ARE TESTS OF THE COMPONENTS AND NOT OF THE DEFERRAL.
  // The server render provides the same one for the same reason: what is asserted below is what
  // the schema viewer, the palette and the navigation do, and a gate in front of them would
  // assert that Vue can wait. `deferred.spec.ts` owns the gate itself.
  app.provide(DEFERRABLE_KEY, EAGER_COMPONENTS);
  app.mount(host);
  mounted = app;

  return host;
}

/** Lets every microtask the fetch and the re-render need actually run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
}

describe('a closed group in the sidebar', () => {
  it('should render as a button carrying what it holds rather than as an empty group', () => {
    // Given a page about nothing, so every group is closed
    const document_ = largeDocument(NODE_COUNT);

    // When
    const host = mountPage(buildPageModel(document_, { markdown }));

    // Then
    const toggles = host.querySelectorAll('.oref-nav-toggle');
    expect(toggles.length).toBeGreaterThan(0);
    expect(toggles[0]?.getAttribute('aria-expanded')).toBe('false');
    expect(toggles[0]?.querySelector('.oref-nav-count')?.textContent).not.toBe('');
  });

  it('should fetch the rest once and show what the group holds', async () => {
    // Given
    const document_ = largeDocument(NODE_COUNT);
    let calls = 0;
    const host = mountPage(buildPageModel(document_, { markdown }), () => {
      calls += 1;
      return Promise.resolve(buildNavigation(document_));
    });

    const before = host.querySelectorAll('.oref-nav-item').length;
    const toggle = host.querySelector<HTMLElement>('.oref-nav-toggle');

    // When
    toggle?.click();
    await settle();

    // Then
    expect(calls).toBe(1);
    expect(host.querySelectorAll('.oref-nav-item').length).toBeGreaterThan(before);
    expect(host.querySelector('.oref-nav-toggle')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('should close again without asking for anything a second time', async () => {
    // Given
    const document_ = largeDocument(NODE_COUNT);
    let calls = 0;
    const host = mountPage(buildPageModel(document_, { markdown }), () => {
      calls += 1;
      return Promise.resolve(buildNavigation(document_));
    });

    const toggle = host.querySelector<HTMLElement>('.oref-nav-toggle');
    toggle?.click();
    await settle();
    const opened = host.querySelectorAll('.oref-nav-item').length;

    // When
    host.querySelector<HTMLElement>('.oref-nav-toggle')?.click();
    await settle();

    // Then
    expect(host.querySelectorAll('.oref-nav-item').length).toBeLessThan(opened);
    expect(calls).toBe(1);
  });

  it('should say that the rest could not be loaded rather than appearing to be empty', async () => {
    // Given a network that is not there
    const document_ = largeDocument(NODE_COUNT);
    const host = mountPage(buildPageModel(document_, { markdown }), () =>
      Promise.reject(new Error('offline')),
    );

    // When
    host.querySelector<HTMLElement>('.oref-nav-toggle')?.click();
    await settle();

    // Then the group stays closed, the page stays usable, and the reader is told
    expect(host.querySelector('.oref-nav-toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('.oref-nav-error')?.textContent).toContain('could not be loaded');
    expect(host.querySelectorAll('.oref-nav-item').length).toBeGreaterThan(0);
  });
});

describe('the palette on a page that carries a slice', () => {
  it('should search the whole document once it has opened', async () => {
    // Given a page whose slice holds no operation at all, which is the overview
    const document_ = largeDocument(NODE_COUNT);
    const host = mountPage(buildPageModel(document_, { markdown }), () =>
      Promise.resolve(buildNavigation(document_)),
    );

    // When the reader opens it and types the path of an operation the page never carried
    host.querySelector<HTMLElement>('.oref-palette-open')?.click();
    await settle();

    const input = host.querySelector<HTMLInputElement>('.oref-palette-input');
    if (input === null) throw new Error('the palette did not open');
    // Read off the document rather than written out, so the assertion is about the palette
    // reaching past the slice and not about what the fixture happens to name its routes.
    const far = [...document_.nodes.values()][150];
    input.value = far !== undefined && 'path' in far ? far.path : '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    // Then
    expect(host.querySelectorAll('.oref-palette-hit').length).toBeGreaterThan(0);
  });

  it('should share the sidebar fetch rather than making one of its own', async () => {
    // Given
    const document_ = largeDocument(NODE_COUNT);
    let calls = 0;
    const host = mountPage(buildPageModel(document_, { markdown }), () => {
      calls += 1;
      return Promise.resolve(buildNavigation(document_));
    });

    // When the reader opens a group and then the palette
    host.querySelector<HTMLElement>('.oref-nav-toggle')?.click();
    await settle();
    host.querySelector<HTMLElement>('.oref-palette-open')?.click();
    await settle();

    // Then
    expect(calls).toBe(1);
  });
});

describe('the first client render of a sliced navigation', () => {
  it('should reproduce the server sidebar exactly, before anything is fetched', async () => {
    // Given the page as the server wrote it, state block and all
    const document_ = largeDocument(NODE_COUNT);
    const nodeId = [...document_.nodes.keys()][100] ?? '';
    const rendered = await renderPage(document_, { nodeId, markdown });

    document.body.innerHTML =
      `<div id="oref-app">${rendered.appHtml}</div>` +
      `<script type="application/json" id="oref-state">${rendered.stateJson}</script>`;

    // THE SIDEBAR RATHER THAN THE WHOLE PAGE, and the exception is named rather than papered
    // over: T013 has the try-it notice change on mount, deliberately, because before mount the
    // page is not interactive and after it the console reports whether a runner was composed
    // in. Comparing the whole document would fail on that and say nothing about this.
    const server = document.querySelector('.oref-sidebar')?.innerHTML ?? '';
    expect(server).not.toBe('');

    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]): void => {
      warnings.push(args.map((arg) => String(arg)).join(' '));
    };

    // When the client hydrates with a loader it has no reason to call yet
    let hydrated: boolean;
    try {
      hydrated = hydrateReference({
        document,
        loadNavigation: () => Promise.resolve(buildNavigation(document_)),
      });
      await settle();
    } finally {
      console.warn = original;
    }

    // Then
    expect(hydrated).toBe(true);
    expect(document.querySelector('.oref-sidebar')?.innerHTML).toBe(server);

    // And Vue itself agrees, which catches a mismatch the string comparison would not see
    // because Vue repairs some of them in place.
    expect(warnings.filter((line) => /hydration/i.test(line))).toEqual([]);
  });
});

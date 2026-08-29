// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineReferenceElement } from '../../src/browser/element';
import { renderHtmlDocument } from '../../src/page/domain/shell';
import { renderPage } from '../../src/render/application/services/render.service';
import { eventsDocument, smallDocument } from '../mocks/documents';

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

/** The small document as a one service federation, the service card suite's fixture rule. */
function federatedDocument(): ReturnType<typeof smallDocument> {
  const base = smallDocument();

  return {
    ...base,
    navigation: [
      {
        id: 'group-service-billing',
        label: 'Billing',
        kind: 'group' as const,
        serviceId: 'billing',
        children: base.navigation,
      },
    ],
    services: [
      {
        id: 'billing',
        documentId: base.id,
        documentHash: 'c'.repeat(64),
        kind: 'http' as const,
        info: { title: 'Billing', version: '1.0.0' },
        servers: [],
      },
    ],
  };
}

/** The served service page of SPEC 15.3, rendered the way `servedPage` renders the node one. */
async function servedServicePage(): Promise<string> {
  const rendered = await renderPage(federatedDocument(), {
    basePath: '/docs',
    page: 'service',
    serviceId: 'billing',
  });
  return renderHtmlDocument(rendered, {
    assets: { stylesheets: ['/docs/_assets/theme.css', '/docs/_assets/fonts.css'] },
  });
}

/**
 * The served overview of `T052`, whose document declares a topology graph.
 *
 * THE EDGES ARE PLANTED ON THE FIXTURE RATHER THAN NORMALIZED OUT OF IT, and the two states the
 * section draws differently are both here on purpose: an event nothing consumes, and an `inferred`
 * edge, which no normalizer produces because SPEC 9.4 gives that level no producer in M5.
 */
function graphDocument(): ReturnType<typeof smallDocument> {
  const base = smallDocument();

  return {
    ...base,
    relationships: [
      {
        from: 'get-orders',
        fromKind: 'node' as const,
        to: 'orders.placed',
        toKind: 'event' as const,
        type: 'publishes' as const,
        confidence: 'declared' as const,
      },
      {
        from: 'get-orders',
        fromKind: 'node' as const,
        to: 'orders.guessed',
        toKind: 'event' as const,
        type: 'publishes' as const,
        confidence: 'inferred' as const,
      },
    ],
  };
}

/** The served overview page, rendered the way `servedPage` renders the node one. */
async function servedOverviewPage(): Promise<string> {
  const rendered = await renderPage(graphDocument(), { basePath: '/docs' });
  return renderHtmlDocument(rendered, {
    assets: { stylesheets: ['/docs/_assets/theme.css', '/docs/_assets/fonts.css'] },
  });
}

/** The served channel page of `T050`, rendered the way `servedPage` renders the node one. */
async function servedChannelPage(): Promise<string> {
  const rendered = await renderPage(eventsDocument(), {
    basePath: '/docs',
    nodeId: 'channel-orders-tenant-requests',
  });
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
      if (href.endsWith('/docs/channel-orders-tenant-requests')) {
        return new Response(await servedChannelPage(), {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      if (href.endsWith('/docs/overview')) {
        return new Response(await servedOverviewPage(), {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      if (href.endsWith('/docs/service/billing')) {
        return new Response(await servedServicePage(), {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      // The snapshot the hydrated federated page fetches on load, per SPEC 15.3.
      if (href.endsWith('/docs/_federation')) {
        return new Response(
          JSON.stringify({
            availability: 'ready',
            httpStatus: 200,
            degraded: true,
            remotes: [{ id: 'billing', status: 'degraded' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
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

describe('the federated service page inside the element, both modes, per SPEC 15.3', () => {
  /**
   * Waits until the snapshot fetch marked the service, then hands back what it marked.
   *
   * The marks are asserted present before any status is read, so a run where the page never
   * rendered them cannot pass as "nothing was mismarked": a proof about the marks begins with
   * the marks existing.
   */
  async function marked(root: ParentNode): Promise<void> {
    expect(root.querySelector('.oref-service-status[data-oref-service="billing"]')).not.toBeNull();
    expect(root.querySelector('.oref-nav-service[data-oref-service="billing"]')).not.toBeNull();

    await vi.waitFor(() => {
      const marks = root.querySelectorAll('[data-oref-service="billing"]');
      expect(marks.length).toBeGreaterThan(1);
      marks.forEach((element) => {
        expect(element.getAttribute('data-oref-remote-status')).toBe('degraded');
      });
    });
  }

  it('should render the card and land the live status inside the shadow root', async () => {
    // Given: no remembered navigation, so the page's own requests are the only ones
    sessionStorage.clear();
    const tag = register();
    const host = document.createElement(tag);
    host.setAttribute('href', '/docs/service/billing');
    document.body.append(host);

    // When
    await settled(host);

    // Then the service page stands inside the boundary and nowhere else
    const root = host.shadowRoot;
    expect(root).not.toBeNull();
    expect(host.hasAttribute('data-oref-embedded')).toBe(true);
    expect(root?.querySelector('.oref-service-page')).not.toBeNull();
    expect(host.querySelector('.oref-service-page')).toBeNull();

    // And the snapshot fetch reached the marks through the shadow root
    if (root === null) throw new Error('asserted non null above');
    await marked(root);
  });

  it('should render the card and land the live status in the element subtree', async () => {
    // Given
    sessionStorage.clear();
    const tag = register();
    const host = document.createElement(tag);
    host.setAttribute('href', '/docs/service/billing');
    host.setAttribute('shadow', 'false');
    document.body.append(host);

    // When
    await settled(host);

    // Then there is no boundary and the service page is page markup inside the element
    expect(host.shadowRoot).toBeNull();
    expect(host.hasAttribute('data-oref-embedded')).toBe(true);
    expect(host.querySelector('.oref-service-page')).not.toBeNull();

    // And the snapshot fetch reached the marks through the light root's querySelectorAll
    await marked(host);
  });
});

describe('the channel page inside the element, both modes, per SPEC 11', () => {
  /**
   * The three sections of `T050`, asserted present before anything about them is read.
   *
   * A PROOF ABOUT ADOPTED MARKUP BEGINS WITH THE MARKUP EXISTING. Every one of these positions is
   * filled in the browser by a childless element, so a run where hydration replaced them instead
   * of adopting them would leave three empty sections; asserting the sections and then their
   * contents is what tells the two apart.
   */
  function sections(root: ParentNode): void {
    for (const name of ['channel', 'channel-operations', 'messages']) {
      expect(root.querySelector(`.oref-section-${name}`), name).not.toBeNull();
    }

    // The address variables, the reply and both payload readings survived hydration rather than
    // being thrown away with the server's markup
    expect(root.querySelector('.oref-section-channel')?.textContent).toContain('{tenant}');
    expect(root.querySelector('.oref-channel-reply')?.textContent).toContain('orders.replies');
    expect(root.querySelector('.oref-section-messages .oref-shape-rows')).not.toBeNull();

    // The security rows of both levels survived it too, which is the whole reason they are drawn
    // inside these positions rather than in a section of their own: what connecting to the broker
    // costs is a row of the facts section, what performing the operation costs is a row of the
    // operations section, and each names its scheme's own type
    const facts = root.querySelector('.oref-section-channel')?.textContent ?? '';
    const operations = root.querySelector('.oref-section-channel-operations')?.textContent ?? '';
    expect(facts).toContain('scramSha256');
    expect(operations).toContain('httpApiKey');
    expect(operations).toContain('header X-Topic-Key');

    // And the sections carry no control, which is what makes adopting them correct: a button
    // here would be pressable and attached to nothing, the F14 class
    expect(root.querySelector('.oref-section-messages button')).toBeNull();
    expect(root.querySelector('.oref-section-channel button')).toBeNull();
  }

  it('should adopt the channel sections inside the shadow root', async () => {
    // Given
    sessionStorage.clear();
    const tag = register();
    const host = document.createElement(tag);
    host.setAttribute('href', '/docs/channel-orders-tenant-requests');
    document.body.append(host);

    // When
    await settled(host);

    // Then the page stands inside the boundary and nowhere else
    const root = host.shadowRoot;
    expect(root).not.toBeNull();
    expect(host.hasAttribute('data-oref-embedded')).toBe(true);
    expect(host.querySelector('.oref-section-messages')).toBeNull();
    if (root === null) throw new Error('asserted non null above');
    sections(root);
  });

  it('should adopt the channel sections in the element subtree in light DOM mode', async () => {
    // Given
    sessionStorage.clear();
    const tag = register();
    const host = document.createElement(tag);
    host.setAttribute('href', '/docs/channel-orders-tenant-requests');
    host.setAttribute('shadow', 'false');
    document.body.append(host);

    // When
    await settled(host);

    // Then there is no boundary and the sections are page markup inside the element
    expect(host.shadowRoot).toBeNull();
    expect(host.hasAttribute('data-oref-embedded')).toBe(true);
    sections(host);
  });
});

describe('the topology section inside the element, both modes, per SPEC 9.5', () => {
  /**
   * The graph, asserted present before anything about it is read.
   *
   * A PROOF ABOUT ADOPTED MARKUP BEGINS WITH THE MARKUP EXISTING. The overview is a server
   * resolved position filled in the browser by a childless element, so a run where hydration
   * replaced it instead of adopting it would leave an empty article, and every assertion about
   * what the graph does not say would pass over nothing at all.
   */
  function graph(root: ParentNode): void {
    expect(root.querySelector('.oref-section-topology')).not.toBeNull();

    // Both rows survived hydration rather than being thrown away with the server's markup, and
    // the two provenance levels are still told apart
    expect(root.querySelectorAll('.oref-topology-edge')).toHaveLength(2);
    expect(root.querySelector('.oref-prov-declared')).not.toBeNull();
    expect(root.querySelector('.oref-prov-inferred')).not.toBeNull();

    // The dead end is words in the markup and not generated content, so it survives a stylesheet
    // that never arrives
    expect(root.querySelector('.oref-topology-dead')?.textContent).toBe('dead end');

    // And the section carries no control, which is what makes adopting it correct: a button here
    // would be pressable and attached to nothing, the F14 class
    expect(root.querySelector('.oref-section-topology button')).toBeNull();
  }

  it('should adopt the topology section inside the shadow root', async () => {
    // Given
    sessionStorage.clear();
    const tag = register();
    const host = document.createElement(tag);
    host.setAttribute('href', '/docs/overview');
    document.body.append(host);

    // When
    await settled(host);

    // Then the page stands inside the boundary and nowhere else
    const root = host.shadowRoot;
    expect(root).not.toBeNull();
    expect(host.hasAttribute('data-oref-embedded')).toBe(true);
    expect(host.querySelector('.oref-section-topology')).toBeNull();
    if (root === null) throw new Error('asserted non null above');
    graph(root);
  });

  it('should adopt the topology section in the element subtree in light DOM mode', async () => {
    // Given
    sessionStorage.clear();
    const tag = register();
    const host = document.createElement(tag);
    host.setAttribute('href', '/docs/overview');
    host.setAttribute('shadow', 'false');
    document.body.append(host);

    // When
    await settled(host);

    // Then there is no boundary and the section is page markup inside the element
    expect(host.shadowRoot).toBeNull();
    expect(host.hasAttribute('data-oref-embedded')).toBe(true);
    graph(host);
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

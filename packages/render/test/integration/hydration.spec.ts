// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { hydrateReference, readPageState } from '../../src/browser/index';
import { renderHtmlDocument } from '../../src/page/domain/shell';
import { renderPage } from '../../src/render/application/services/render.service';
import { runtimeDocument, runtimeNodeId, smallDocument } from '../mocks/documents';

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
    // Given the health page with the panel on it, where the panel lives since TX-FRAME
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const built = runtimeDocument();
    const page = await renderPage(built, { page: 'health' });
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

  /**
   * The adopted node page of `TX-ADOPT`: the same mechanism as the panel, applied to the rest.
   *
   * The state block for a node page carries `drawn` and not the models the server drew from,
   * so the client fills each static position with a childless element. The case counts the
   * parity rows and the parameter rows before and after, because the failure mode is the same
   * one the panel case names: an element with children on the same spot clears everything the
   * server put there, and the page looks right until a reader looks at the scale.
   */
  it('should keep the parity scale and the tables after hydrating from a redacted block', async () => {
    // Given a node page whose operation carries runtime facts, parameters and responses
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const built = runtimeDocument();
    const page = await renderPage(built, { nodeId: runtimeNodeId(built) });
    document.documentElement.innerHTML = renderHtmlDocument(page, {
      nonce: 'r4nd0mNONCEvalue',
      assets: { stylesheets: ['/assets/theme.css'], modules: ['/assets/openref.js'] },
    });

    const parityBefore = document.querySelectorAll('.oref-parity').length;
    const paramsBefore = document.querySelectorAll('.oref-param-row').length;
    const responsesBefore = document.querySelectorAll('.oref-response').length;
    expect(parityBefore).toBeGreaterThan(0);
    expect(paramsBefore).toBeGreaterThan(0);
    expect(responsesBefore).toBeGreaterThan(0);

    // And the state block carries the walk and none of the drawn models
    const state = readPageState(document);
    expect(state?.node?.drawn).toContain('runtime');
    expect(state?.node?.parameters).toEqual([]);
    expect(state?.node?.responses).toEqual([]);
    expect(state?.node?.runtime).toBeNull();
    expect(state?.node?.run).toBeNull();

    // When
    const hydrated = hydrateReference();

    // Then the markup the server wrote is still the markup on the page
    expect(hydrated).toBe(true);
    expect(document.querySelectorAll('.oref-parity')).toHaveLength(parityBefore);
    expect(document.querySelectorAll('.oref-param-row')).toHaveLength(paramsBefore);
    expect(document.querySelectorAll('.oref-response')).toHaveLength(responsesBefore);
    const messages = [...warn.mock.calls, ...error.mock.calls].map((call) => String(call[0]));
    expect(messages.filter((message) => message.includes('Hydration'))).toEqual([]);
  });

  it('should keep the request example and the states catalogue over their childless stubs', async () => {
    // Given the node page whose request body carries a generated example
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const withBody = smallDocument();
    const bodyNode = [...withBody.nodes.entries()].find(
      ([, node]) => node.kind === 'operation' && node.requestBody !== undefined,
    )?.[0];
    expect(bodyNode).toBeDefined();
    document.documentElement.innerHTML = await serveDocument(bodyNode);

    const exampleBefore = document.querySelector('.oref-section-request .oref-example');
    expect(exampleBefore).not.toBeNull();
    const exampleHtml = exampleBefore?.innerHTML ?? '';
    expect(exampleHtml).not.toBe('');

    // And the block carries the flag rather than the markup
    const state = readPageState(document);
    const media = state?.node?.requestBody[0];
    expect(media?.hasExample).toBe(true);
    expect(media?.exampleHtml).toBe('');

    // When
    const hydrated = hydrateReference();

    // Then
    expect(hydrated).toBe(true);
    expect(document.querySelector('.oref-section-request .oref-example')?.innerHTML).toBe(
      exampleHtml,
    );
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
    // proxy is up, which is the defence existing and not being offered. TX-GUTTER added the
    // parity scale and the display code, and that is 10: a page cached before it hydrates an
    // operation with no scale to adopt and findings citing no code. TX-FRAME added `kind`,
    // `frame` and the navigation drift counts, and moved the panel to the health page, and
    // that is 11: a page cached before it hydrates a shell with no tab bar data and an
    // overview that still claims the panel. TX-MARKUP widened the header promise, added the
    // response marks, the contracts grid, the rail method and the schema dialect, and that is
    // 12: a page cached before it hydrates a header with no kicker and responses that say
    // nothing the runtime knows. TX-PARITY-UI made the bar six constant kinds, the responses
    // compact, the parameters fact-joined and the health model KPI-carrying, and that is 13:
    // a page cached before it hydrates a bar with hidden tabs and responses that re-expand.
    // TX-ADOPT added `drawn` and `hasExample` and redacted what only server resolved
    // positions read, and that is 14: a page cached before it hydrates an operation article
    // whose client walk finds no `drawn` and draws nothing under the header. T040 added
    // `directTarget`, the platform name of the SPEC 16.2 direct mode warning, and that is 15:
    // a page cached before it hydrates a console with no warning, which on a served page is
    // correct and on a static one is the page from before the warning existed. T042 added
    // `staticProxy`, the prefix and pinned order of the SPEC 16.2 rewrite rules, and that is
    // 16: a page cached before it hydrates a console that sends direct on a deployment whose
    // rules are up, which is the generation side existing and never being offered. T046 added
    // `service` and the rail's `serviceId`, the federated card of SPEC 15.3, and that is 17:
    // a page cached before it hydrates a rail whose service groups have no card link and no
    // mark for the live status to land on.
    expect(state?.pageModelVersion).toBe(17);
  });
});

describe('the federated page and its live status, per SPEC 15.3', () => {
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

  it('should hydrate the service card without a mismatch and mark the live status after it', async () => {
    // Given: a served service page, and a snapshot the page's one on-load fetch will answer with
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const page = await renderPage(federatedDocument(), {
      page: 'service',
      serviceId: 'billing',
    });
    document.documentElement.innerHTML = renderHtmlDocument(page, {
      nonce: 'r4nd0mNONCEvalue',
      assets: { stylesheets: ['/assets/theme.css'], modules: ['/assets/openref.js'] },
    });

    // The remembered operation of an earlier case would make this page fetch the navigation,
    // which is real behaviour and another case's subject; cleared so the count below is this
    // page's own.
    sessionStorage.clear();

    const fetched: string[] = [];
    const fetchStub = vi.fn((input: unknown): Promise<Response> => {
      fetched.push(String(input));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            availability: 'ready',
            httpStatus: 200,
            degraded: true,
            remotes: [{ id: 'billing', status: 'degraded' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    });
    vi.stubGlobal('fetch', fetchStub);

    try {
      // When
      const hydrated = hydrateReference();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Then: no mismatch, exactly one on-load request, and it is the snapshot's address
      expect(hydrated).toBe(true);
      const messages = [...warn.mock.calls, ...error.mock.calls].map((call) => String(call[0]));
      expect(messages.filter((message) => message.includes('Hydration'))).toEqual([]);
      expect(fetched).toEqual(['/_federation']);

      // And the mark is on every element about the service: the rail's dot and the card's word
      const marked = document.querySelectorAll('[data-oref-service="billing"]');
      expect(marked.length).toBeGreaterThan(1);
      marked.forEach((element) => {
        expect(element.getAttribute('data-oref-remote-status')).toBe('degraded');
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('should fetch nothing on load for a page with no federation in it', async () => {
    // Given: the unfederated page, which must keep the SPEC 14.4.1 boundary exactly as it was
    sessionStorage.clear();
    const fetchStub = vi.fn();
    document.documentElement.innerHTML = await serveDocument();
    vi.stubGlobal('fetch', fetchStub);

    try {
      // When
      hydrateReference();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Then
      expect(fetchStub).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('should leave every mark neutral when the snapshot cannot be fetched', async () => {
    // Given
    const page = await renderPage(federatedDocument(), { page: 'service', serviceId: 'billing' });
    document.documentElement.innerHTML = renderHtmlDocument(page, {
      nonce: 'r4nd0mNONCEvalue',
      assets: { stylesheets: ['/assets/theme.css'], modules: ['/assets/openref.js'] },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('down'))),
    );

    try {
      // When
      hydrateReference();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Then: a mark that claims nothing, never a status nobody confirmed
      const marked = document.querySelectorAll('[data-oref-service="billing"]');
      expect(marked.length).toBeGreaterThan(0);
      marked.forEach((element) => {
        expect(element.hasAttribute('data-oref-remote-status')).toBe(false);
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

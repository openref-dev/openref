// @vitest-environment jsdom

import { SERVER_RESOLVED_ROOTS, SERVER_RESOLVED_SLOTS } from '@openref/vue';
import { describe, expect, it } from 'vitest';
import { h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { deferredComponents } from '../../src/browser/deferred';
import { EAGER_COMPONENTS } from '../../src/components/eager';
import { buildPageModel } from '../../src/page/domain/page-model';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { eventsDocument } from '../mocks/documents';

/**
 * The browser stub set of `TX-ADOPT`, pinned against the one home of the contract.
 *
 * `SERVER_RESOLVED_ROOTS` is what `@openref/theme-kit` refuses a theme against, and these
 * stubs are what production hydration matches a page against; the two reading different tags
 * would be a theme refused for a root the page does not require, or a page that loses a
 * position's markup to a stub the contract never named. In the integration suite rather than
 * the unit one because the stubs live in `src/browser`, whose DOM types the root typecheck
 * program deliberately excludes, per T011.
 */
describe('the browser stubs, pinned against the server resolved list', () => {
  it('should fill every stubbed position with a childless element of the contract root', async () => {
    // Given the browser's registry
    const components = deferredComponents({ document, provideRunner: () => undefined });

    // The slot names of SPEC 10.4 mapped to the registry entries that fill their positions.
    // DriftCard and ProvenanceTag have no entry deliberately: they resolve inside the stubbed
    // positions and never meet a stub of their own.
    const positions = {
      DocumentOverview: components.overviewPage,
      OperationHeader: components.operationHeader,
      RuntimePanel: components.runtimePanel,
      ParamTable: components.paramTable,
      ResponseList: components.responseList,
      HealthScore: components.healthPanel,
    } as const;

    for (const [slot, component] of Object.entries(positions)) {
      // When the stub renders
      const html = await renderToString(h(component));

      // Then it is one childless element of the root SERVER_RESOLVED_ROOTS pins
      const expected = SERVER_RESOLVED_ROOTS[slot as keyof typeof positions];
      expect(html, slot).toMatch(new RegExp(`^<${expected ?? ''}[ >]`));
      expect(html, slot).toMatch(new RegExp(`></${expected ?? ''}>$`));
    }
  });

  it('should have an entry for every rooted server resolved slot, so the lists cannot drift', () => {
    // Given the rooted half of the list
    const rooted = SERVER_RESOLVED_SLOTS.filter((slot) => SERVER_RESOLVED_ROOTS[slot]);

    // Then each is one of the positions the case above renders
    expect(rooted.sort()).toEqual(
      [
        'DocumentOverview',
        'OperationHeader',
        'RuntimePanel',
        'ParamTable',
        'ResponseList',
        'HealthScore',
      ].sort(),
    );
  });

  it('should fill each channel position with a stub whose root matches the one the server drew', async () => {
    // Given the channel page's model, and the two registries that fill its three positions
    const markdown = await createMarkdownRenderer();
    const page = buildPageModel(eventsDocument(), {
      nodeId: 'channel-orders-tenant-requests',
      markdown,
    });
    const channel = page.node?.channel ?? null;
    const browser = deferredComponents({ document, provideRunner: () => undefined });

    // The three positions of `T050`. They are positions and not slots, so `SERVER_RESOLVED_ROOTS`
    // does not name them; the property is the same one it exists for, and it is checked against
    // the markup the server really draws rather than against a second list.
    const positions = [
      ['channelFacts', { channel }],
      ['channelOperations', { channel }],
      ['messageList', { channel, schemas: page.schemas, basePath: page.basePath }],
    ] as const;

    for (const [name, props] of positions) {
      // When the server's component and the browser's stub both render
      const served = await renderToString(h(EAGER_COMPONENTS[name], props));
      const stub = await renderToString(h(browser[name]));

      // Then the server drew something, which is what makes the comparison below mean anything
      expect(served.length, name).toBeGreaterThan(stub.length);

      // And the stub is one childless element whose tag and class are the served root's, so
      // hydration adopts the markup instead of replacing it
      const root = /^<(\w+) class="([^"]*)"/.exec(served);
      expect(root, name).not.toBeNull();
      expect(stub, name).toBe(
        `<${root?.[1] ?? ''} class="${root?.[2] ?? ''}"></${root?.[1] ?? ''}>`,
      );
    }
  });
});

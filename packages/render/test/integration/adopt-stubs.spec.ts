// @vitest-environment jsdom

import { SERVER_RESOLVED_ROOTS, SERVER_RESOLVED_SLOTS } from '@openref/vue';
import { describe, expect, it } from 'vitest';
import { h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { deferredComponents } from '../../src/browser/deferred';

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
});

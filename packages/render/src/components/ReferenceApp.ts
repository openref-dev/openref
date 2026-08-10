/**
 * Root of the rendered reference: header, navigation, current node.
 *
 * It takes the whole page model as one prop, so the server render and the client
 * hydration are the same call with the same argument. Anything that differed between the
 * two would show up as a hydration mismatch, which is a silent class of bug, so there is
 * deliberately nothing here that could differ: no clock, no random, no environment check.
 *
 * A page shows one of three things: the document overview, one node, or one named schema. The
 * third exists because the navigation ends in a `Schemas` group and because a schema too far
 * from a use site to travel with the page is shown by linking to it.
 */

import { defineComponent, h, provide, type PropType, type VNode } from 'vue';
import { CommandPalette } from './CommandPalette';
import { MarkdownBlock } from './MarkdownBlock';
import { NavigationTree } from './NavigationTree';
import { NodePanel } from './NodePanel';
import { SchemaPanel } from './SchemaPanel';
import { overviewHref } from '../page/domain/links';
import { createNavigationStore, NAVIGATION_KEY } from '../page/api/nav-context';
import type { NavigationLoader } from '../page/domain/nav-source';
import type { PageModel } from '../page/domain/page-model';

/** Element the client mounts on, and the id the shell writes. */
export const APP_ROOT_ID = 'oref-app';

/** Target of the skip link, so a keyboard reader can pass the navigation in one key. */
export const MAIN_ID = 'oref-main';

function overview(page: PageModel): VNode {
  return h('article', { class: 'oref-overview' }, [
    h('h1', { class: 'oref-title' }, page.title),
    h(MarkdownBlock, { html: page.descriptionHtml }),
    page.servers.length === 0
      ? null
      : h('section', { class: 'oref-section oref-section-servers' }, [
          h('h2', { class: 'oref-section-title' }, 'Servers'),
          h(
            'ul',
            { class: 'oref-server-list' },
            page.servers.map((url) =>
              h('li', { class: 'oref-server', key: url }, [h('code', {}, url)]),
            ),
          ),
        ]),
  ]);
}

function main(page: PageModel, basePath: string): VNode {
  if (page.node !== null) {
    return h(NodePanel, {
      node: page.node,
      schemas: page.schemas,
      truncated: page.truncatedSchemas,
      basePath,
    });
  }

  if (page.schema !== null) {
    return h(SchemaPanel, {
      schema: page.schema,
      schemas: page.schemas,
      truncated: page.truncatedSchemas,
      basePath,
    });
  }

  return overview(page);
}

/** Renders a whole page from its model. */
export const ReferenceApp = defineComponent({
  name: 'OrefReferenceApp',

  props: {
    page: { type: Object as PropType<PageModel>, required: true },
    basePath: { type: String, default: '' },
    /**
     * How the rest of the navigation is fetched.
     *
     * ABSENT ON THE SERVER, ALWAYS. A server render must not fetch: it holds the whole
     * document already, and a page that waited on a request to render would put a network
     * round trip inside the two second prerender budget. The client supplies one in
     * `hydrateReference`, and a page with none keeps the navigation it shipped with.
     */
    loadNavigation: { type: Function as PropType<NavigationLoader>, default: undefined },
  },

  setup(props) {
    // Created once, for the life of this page, and handed to both components that ask about
    // the navigation so that they share one copy and one fetch.
    provide(
      NAVIGATION_KEY,
      createNavigationStore({
        entries: props.page.navigation,
        complete: props.page.navigationComplete,
        ...(props.loadNavigation === undefined ? {} : { loader: props.loadNavigation }),
      }),
    );

    return (): VNode => {
      const page = props.page;

      return h('div', { class: 'oref-root', 'data-oref-document': page.documentHash }, [
        // First in the document and first in the tab order, which is the only place a skip link
        // works. It is visible on focus and out of the way otherwise, which the theme decides.
        h('a', { class: 'oref-skip', href: `#${MAIN_ID}` }, 'Skip to content'),
        h('header', { class: 'oref-header' }, [
          h('a', { class: 'oref-brand', href: overviewHref(props.basePath) }, [
            h('span', { class: 'oref-brand-title' }, page.title),
            h('span', { class: 'oref-brand-version' }, page.version),
          ]),
          h(CommandPalette, { entries: page.navigation, basePath: props.basePath }),
        ]),
        h('div', { class: 'oref-layout' }, [
          h('aside', { class: 'oref-sidebar' }, [
            h('nav', { class: 'oref-nav', 'aria-label': 'API reference' }, [
              h(NavigationTree, {
                entries: page.navigation,
                activeNodeId: page.activeNodeId,
                activeSchemaId: page.activeSchemaId,
                basePath: props.basePath,
              }),
            ]),
          ]),
          h('main', { class: 'oref-content', id: MAIN_ID, tabindex: -1 }, [
            main(page, props.basePath),
          ]),
        ]),
      ]);
    };
  },
});

/**
 * Root of the rendered reference: the frame, the navigation, the page.
 *
 * It takes the whole page model as one prop, so the server render and the client
 * hydration are the same call with the same argument. Anything that differed between the
 * two would show up as a hydration mismatch, which is a silent class of bug, so there is
 * deliberately nothing here that could differ: no clock, no random, no environment check.
 *
 * A page shows one of three things: the document overview, one node, or one named schema. The
 * third exists because the navigation ends in a `Schemas` group and because a schema too far
 * from a use site to travel with the page is shown by linking to it. All three are slots, since
 * `TX-SLOTWIRE`: the registry named components for one of the three pages until then, which is a
 * contract with a hole in the middle rather than a small contract.
 *
 * THIS IS WHERE THE REGISTRY IS ASKED WHAT THE THEME PUT THERE. Every position below resolves
 * through `useSlot`, and a slot with no override falls through to the component this package
 * ships, which is what makes an L1 theme a change of markup rather than a fork. Before
 * `TX-SLOTWIRE` nothing on any page a reader opened ever consulted the registry.
 */

import { useSlot } from '@openref/vue';
import { defineComponent, h, provide, type Component, type PropType, type VNode } from 'vue';
import { AppShell, MAIN_ID } from './AppShell';
import { DocumentOverview } from './DocumentOverview';
import { NavigationTree } from './NavigationTree';
import { NodePanel } from './NodePanel';
import { SchemaPanel } from './SchemaPanel';
import { useDeferrable } from './deferrable';
import { createNavigationStore, NAVIGATION_KEY } from '../page/api/nav-context';
import type { NavigationLoader } from '../page/domain/nav-source';
import type { PageModel } from '@openref/vue';

/** Element the client mounts on, and the id the shell writes. */
export const APP_ROOT_ID = 'oref-app';

export { MAIN_ID };

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
    const deferrable = useDeferrable();
    const shell = useSlot('AppShell', AppShell);
    const navTree = useSlot('NavTree', NavigationTree);
    const overview = useSlot('DocumentOverview', DocumentOverview);
    const schemaPage = useSlot('SchemaPage', SchemaPanel);

    // Created once, for the life of this page, and handed to both components that ask about
    // the navigation so that they share one copy and one fetch.
    //
    // THE TREE IS HANDED WHAT IT HOLDS RATHER THAN THE STORE ITSELF, since `TX-SLOTWIRE`, because
    // `NavTree` is a slot and a theme cannot inject a key private to this package. The palette
    // still injects it: it is the deferred host of its own slot, it lives in this package, and
    // moving its state up would put the search in the first paint.
    const navigation = createNavigationStore({
      entries: props.page.navigation,
      complete: props.page.navigationComplete,
      ...(props.loadNavigation === undefined ? {} : { loader: props.loadNavigation }),
    });
    provide(NAVIGATION_KEY, navigation);

    /** The content column: whichever of the three pages this is. */
    function content(page: PageModel, healthPanel: Component): VNode {
      if (page.node !== null) {
        return h(NodePanel, {
          node: page.node,
          schemas: page.schemas,
          truncated: page.truncatedSchemas,
          basePath: props.basePath,
        });
      }

      if (page.schema !== null) {
        return h(schemaPage.value, {
          schema: page.schema,
          basePath: props.basePath,
          // Not contract props: the viewer needs the page's bounded schema slice to expand, and
          // `SchemaPanel` is the default that draws it. A theme override reads the two it was
          // promised and Vue passes the rest through as attributes.
          schemas: page.schemas,
          truncated: page.truncatedSchemas,
        });
      }

      return h(
        overview.value,
        {
          title: page.title,
          descriptionHtml: page.descriptionHtml,
          servers: page.servers,
          basePath: props.basePath,
        },
        {
          // THE CONDITION IS `healthRendered` AND NOT `health`, and that is what lets the report
          // stay on the server, per SPEC 7.2. The two fillings of this position draw the same
          // element: the server's from the report, the browser's from the section already under
          // it. The client is therefore handed a boolean where it used to be handed every
          // finding a second time.
          default: () => (page.healthRendered ? [h(healthPanel, { health: page.health })] : []),
        },
      );
    }

    return (): VNode => {
      const page = props.page;

      return h('div', { class: 'oref-root', 'data-oref-document': page.documentHash }, [
        h(
          shell.value,
          {
            title: page.title,
            version: page.version,
            basePath: props.basePath,
            activeNodeId: page.activeNodeId,
            activeSchemaId: page.activeSchemaId,
            page: page.node !== null ? 'node' : page.schema !== null ? 'schema' : 'overview',
          },
          {
            nav: () => [
              h(navTree.value, {
                entries: navigation.entries.value,
                activeNodeId: page.activeNodeId,
                activeSchemaId: page.activeSchemaId,
                basePath: props.basePath,
                complete: navigation.complete.value,
                total: page.navigationRows,
                load: () => navigation.load(),
              }),
            ],
            palette: () => [
              h(deferrable.commandPalette, {
                entries: page.navigation,
                basePath: props.basePath,
              }),
            ],
            default: () => [content(page, deferrable.healthPanel)],
          },
        ),
      ]);
    };
  },
});

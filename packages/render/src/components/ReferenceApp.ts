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
import {
  defineComponent,
  h,
  onMounted,
  provide,
  ref,
  type Component,
  type PropType,
  type VNode,
} from 'vue';
import { AppShell, MAIN_ID } from './AppShell';
import { DocumentOverview } from './DocumentOverview';
import { MarkdownBlock } from './MarkdownBlock';
import { methodBadge } from './method-badge';
import { NavigationTree } from './NavigationTree';
import { NodePanel } from './NodePanel';
import { SchemaPanel } from './SchemaPanel';
import { StateNotice } from './StateNotice';
import { StatesPanel } from './StatesPanel';
import { useDeferrable } from './deferrable';
import { createNavigationStore, NAVIGATION_KEY } from '../page/api/nav-context';
import {
  mergeRememberedFrame,
  recallOperation,
  rememberOperation,
  type RememberedOperation,
} from '../page/api/remembered';
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
    /**
     * The reader's fragment, already decoded, for the schema page's field anchors.
     *
     * EMPTY ON THE SERVER, ALWAYS, for the reason `loadNavigation` is absent there: a fragment
     * never reaches a server, so the server has nothing to read and the markup it sends cannot
     * depend on one. The client supplies it in `hydrateReference`, and the tree expands to the
     * field after mount, which is a state change and not a hydration difference.
     */
    anchor: { type: String, default: '' },
  },

  setup(props) {
    const deferrable = useDeferrable();
    const shell = useSlot('AppShell', AppShell);
    const navTree = useSlot('NavTree', NavigationTree);
    const overview = useSlot('DocumentOverview', DocumentOverview);
    const schemaPage = useSlot('SchemaPage', SchemaPanel);
    const notice = useSlot('StateNotice', StateNotice);

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

    // THE REMEMBERED OPERATION, per SPEC 11 and `TX-PARITY-UI`. Null on the server and in the
    // first client render, so hydration compares the markup the server sent; the merge is a
    // post-mount state change, the anchor walk's class. An operation page writes the memory,
    // the four operation-less kinds read it, and a memory about another document reads null.
    const remembered = ref<RememberedOperation | null>(null);

    onMounted(() => {
      const page = props.page;

      if ((page.kind === 'node' || page.kind === 'bench') && page.node !== null) {
        rememberOperation(props.basePath, {
          documentHash: page.documentHash,
          nodeId: page.node.id,
          crumb: page.frame.crumb,
          tabs: page.frame.tabs,
        });
        return;
      }

      if (
        page.kind === 'schema' ||
        page.kind === 'shapes' ||
        page.kind === 'health' ||
        page.kind === 'states'
      ) {
        remembered.value = recallOperation(props.basePath, page.documentHash);

        // THE RAIL'S CURRENT ROW NEEDS ITS GROUP'S CHILDREN, and a page without an operation
        // ships its groups closed, so an applied memory asks the shared store once, per SPEC
        // 11: the same single fetch the palette and the tree share, immutable and addressed
        // by hash. A failed fetch leaves the group closed, the way a failed opening does.
        if (remembered.value !== null) void navigation.load();
      }
    });

    /** The content column: whichever page this is, chosen by `kind` since `TX-FRAME`. */
    function content(page: PageModel, healthPanel: Component): VNode {
      // THE BENCH IS THE CONSOLE ON ITS OWN ADDRESS, per SPEC 13.3: the node travels for the
      // header and the runner view, and the sections stay on the operation page.
      if (page.kind === 'bench' && page.node !== null) {
        const node = page.node;
        // THE BENCH HEAD IS THE LAYOUT'S, per `TX-PARITY-UI`: the `Bench` kicker, the badge
        // and the path, the same identity the operation header leads with. A back link is not
        // drawn here: the app bar's back and the operation tab already lead there, and one
        // page saying one thing twice is the F15 class.
        const badge = node.method === null ? null : methodBadge(node.method, node.sse);

        return h('article', { class: 'oref-bench-page', 'data-oref-node': node.id }, [
          h('header', { class: 'oref-operation-header' }, [
            h('p', { class: 'oref-section-title oref-bench-kicker' }, 'Bench'),
            badge === null
              ? h('h1', { class: 'oref-title' }, node.title)
              : h('h1', { class: 'oref-title oref-endpoint' }, [
                  h('span', { class: `oref-badge ${badge.className}` }, badge.text),
                  h('code', { class: 'oref-path' }, node.path ?? ''),
                ]),
          ]),
          h(deferrable.tryIt, {
            run: node.run,
            basePath: props.basePath,
            // The verdict chip's declaration, per TX-MARKUP: what the document says this
            // operation answers with, read off the same rows the responses section draws.
            declared: node.responses.map((response) => response.statusCode),
            // The scan's rows, per SPEC 11's F14 boundary: a field the runtime does not read
            // is disabled with the reason, and only `not-seen-read` disables.
            unread: node.parameters
              .filter((parameter) => parameter.unread)
              .map((parameter) => `${parameter.location}:${parameter.name}`),
          }),
        ]);
      }

      // THE HEALTH PAGE CARRIES THE PANEL THE OVERVIEW LOST, per SPEC 7.3 as amended
      // 2026-08-14. The condition is `healthRendered` and not `health`, which is what lets
      // the report stay on the server, per SPEC 7.2: the server's filling draws from the
      // report, the browser's adopts the section already under it.
      if (page.kind === 'health') {
        return h('article', { class: 'oref-health-page' }, [
          page.healthRendered
            ? h(healthPanel, { health: page.health })
            : h(notice.value, {
                kind: 'health-missing',
                message:
                  'No health report exists for this document. Nothing has measured it, which ' +
                  'is a different statement from a score of zero.',
              }),
        ]);
      }

      // THE SHAPES SHOWCASE: the read half of the layout's page, the schema in request view.
      // The value driven fill half is its own task, and this page draws what exists rather
      // than promising it.
      if (page.kind === 'shapes' && page.schema !== null) {
        return h('article', { class: 'oref-shapes-page', 'data-oref-schema': page.schema.id }, [
          h('header', { class: 'oref-operation-header' }, [
            h('p', { class: 'oref-section-title' }, 'Value dependent shape'),
            h('h1', { class: 'oref-title' }, page.schema.name),
          ]),
          h(MarkdownBlock, { html: page.schema.descriptionHtml }),
          page.schema.missing
            ? h(notice.value, {
                kind: 'schema-missing',
                message: 'This document declares no such schema.',
              })
            : h(deferrable.schemaView, {
                slot: { kind: 'named', schemaId: page.schema.id },
                label: page.schema.name,
                view: 'request',
                schemas: page.schemas,
                truncated: page.truncatedSchemas,
                basePath: props.basePath,
              }),
        ]);
      }

      if (page.kind === 'states') {
        return h(StatesPanel);
      }

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
          // promised and Vue passes the rest through as attributes. `anchor` rides the same
          // way: the fragment is the default page's affordance, not a promise to every theme.
          schemas: page.schemas,
          truncated: page.truncatedSchemas,
          anchor: props.anchor,
        });
      }

      // The overview carries no panel since `TX-FRAME`: the health tab leads to the page
      // that does.
      return h(overview.value, {
        title: page.title,
        descriptionHtml: page.descriptionHtml,
        servers: page.servers,
        basePath: props.basePath,
      });
    }

    return (): VNode => {
      const page = props.page;

      // THE MEMORY'S THREE EFFECTS, per SPEC 11: the missing tabs appear, the breadcrumb
      // stays the operation's, and the rail's `aria-current` stays on the operation. The
      // page's own tabs win the merge, and the schema page's own current row yields, because
      // the maintainer's sentence names the operation as what the rail stays on.
      const memory = remembered.value;
      const frame = memory === null ? page.frame : mergeRememberedFrame(page.frame, memory);
      const activeNodeId = memory === null ? page.activeNodeId : memory.nodeId;
      const activeSchemaId = memory === null ? page.activeSchemaId : null;

      return h('div', { class: 'oref-root', 'data-oref-document': page.documentHash }, [
        h(
          shell.value,
          {
            title: page.title,
            version: page.version,
            basePath: props.basePath,
            activeNodeId,
            activeSchemaId,
            page: page.kind,
            frame,
          },
          {
            nav: () => [
              h(navTree.value, {
                entries: navigation.entries.value,
                activeNodeId,
                activeSchemaId,
                basePath: props.basePath,
                stats: page.frame.stats,
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

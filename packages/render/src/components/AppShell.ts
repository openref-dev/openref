/**
 * The page frame: the skip link, the header, the navigation rail and the content column.
 *
 * THE CONTENT ARRIVES AS CHILDREN AND THE NAVIGATION AS A NAMED SLOT. A shell handed the page
 * model would be a second renderer, and the three reference themes disagree about where the
 * blocks go rather than about what they say. What this position owns is the frame: which regions
 * exist, in what order, and what the landmark elements are.
 *
 * IT IS WHAT `defineTheme.layout` RESOLVES INTO. A theme writes `layout: () => import('./Layout.vue')`
 * or `components: { AppShell }`, never both, and `resolveTheme` refuses a theme that writes both.
 * Two mechanisms for one position is the defect `TX-SLOTWIRE` was filed about, in miniature.
 *
 * THE SKIP LINK IS FIRST IN THE DOCUMENT AND FIRST IN THE TAB ORDER, which is the only place a
 * skip link works. It is visible on focus and out of the way otherwise, which the theme decides.
 *
 * IT DRAWS THE REGIONS AND NOT THE ROOT ELEMENT. `ReferenceApp` keeps `.oref-root` and the
 * `data-oref-document` marker on it, because that marker is the document's identity and is read
 * by the client, by the browser budget harness and by three integration suites. A theme replacing
 * this position replaces the frame; it cannot replace the page's identity by forgetting to write
 * it, which is what putting the root inside the slot would have allowed.
 */

import { h, type VNode } from 'vue';
import { overviewHref } from '../page/domain/links';
import type { PageKind } from '@openref/vue';

/** Target of the skip link, so a keyboard reader can pass the navigation in one key. */
export const MAIN_ID = 'oref-main';

/** What a shell is handed besides its children. */
export interface AppShellProps {
  readonly title: string;
  readonly version: string;
  readonly basePath: string;
  readonly activeNodeId: string | null;
  readonly activeSchemaId: string | null;
  readonly page: PageKind;
}

/** The regions a shell places, each one already rendered by the position that owns it. */
export interface AppShellSlots {
  /** The content column: the overview, one node, or one named schema. */
  readonly default?: () => VNode[];
  /** The navigation tree, which is the `NavTree` position. */
  readonly nav?: () => VNode[];
  /** The search overlay, which is the `CommandPalette` position. */
  readonly palette?: () => VNode[];
}

/**
 * Renders the frame of one page.
 *
 * @param props - What the document is called and which page is open
 * @param context - Vue's second argument, for the regions this frame places
 * @returns The regions of the frame, in document order
 */
export function AppShell(
  props: AppShellProps,
  context: { readonly slots: AppShellSlots },
): VNode[] {
  return [
    h('a', { class: 'oref-skip', href: `#${MAIN_ID}` }, 'Skip to content'),
    h('header', { class: 'oref-header' }, [
      h('a', { class: 'oref-brand', href: overviewHref(props.basePath) }, [
        h('span', { class: 'oref-brand-title' }, props.title),
        h('span', { class: 'oref-brand-version' }, props.version),
      ]),
      ...(context.slots.palette?.() ?? []),
    ]),
    h('div', { class: 'oref-layout' }, [
      h('aside', { class: 'oref-sidebar' }, [
        h('nav', { class: 'oref-nav', 'aria-label': 'API reference' }, context.slots.nav?.() ?? []),
      ]),
      h(
        'main',
        { class: 'oref-content', id: MAIN_ID, tabindex: -1 },
        context.slots.default?.() ?? [],
      ),
    ]),
  ];
}

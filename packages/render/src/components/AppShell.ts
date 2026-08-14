/**
 * The page frame: the skip link, the app bar, the navigation rail and the content column.
 *
 * THE APP BAR IS THE LAYOUT'S, since `TX-FRAME`: the brand cell at rail width, the back link
 * and the breadcrumb of the current node, the palette trigger, and the tab bar whose members
 * are pages with addresses, per SPEC 11 and 13.3. The tabs arrive resolved in `frame`: this
 * position draws them and never derives an address, because a second spelling of a path is a
 * broken link no test on either side would see.
 *
 * THE CONTENT ARRIVES AS CHILDREN AND THE NAVIGATION AS A NAMED SLOT. A shell handed the page
 * model would be a second renderer, and the three reference themes disagree about where the
 * blocks go rather than about what they say. What this position owns is the frame: which regions
 * exist, in what order, and what the landmark elements are.
 *
 * IT IS WHAT `defineTheme.layout` RESOLVES INTO. A theme writes `layout: () => import('./Layout.vue')`
 * or `components: { AppShell }`, never both, and `resolveTheme` refuses a theme that writes both.
 *
 * THE ACTIVE TAB CARRIES THREE SIGNALS, colour, surface and the 2px bottom border, and the
 * three live in the stylesheet: this component's whole statement is `aria-current="page"`,
 * which is also the accessible one. The reason for three is monochrome print, the same reason
 * provenance carries a code and an edge style rather than a colour alone.
 *
 * THE SKIP LINK IS FIRST IN THE DOCUMENT AND FIRST IN THE TAB ORDER, which is the only place a
 * skip link works. It is visible on focus and out of the way otherwise, which the theme decides.
 *
 * IT DRAWS THE REGIONS AND NOT THE ROOT ELEMENT. `ReferenceApp` keeps `.oref-root` and the
 * `data-oref-document` marker on it, because that marker is the document's identity and is read
 * by the client, by the browser budget harness and by three integration suites.
 */

import { h, type VNode } from 'vue';
import { overviewHref } from '../page/domain/links';
import type { FrameModel, FrameTabKind, PageKind } from '@openref/vue';

/** Target of the skip link, so a keyboard reader can pass the navigation in one key. */
export const MAIN_ID = 'oref-main';

/**
 * What each tab says, keyed by its kind rather than matched on English: a theme that wants
 * other words draws its own bar from the same `frame`.
 */
const TAB_LABELS: Readonly<Record<FrameTabKind, string>> = {
  node: 'Operation',
  schema: 'Schema',
  bench: 'Bench',
  health: 'Health',
};

/** What a shell is handed besides its children. */
export interface AppShellProps {
  readonly title: string;
  readonly version: string;
  readonly basePath: string;
  readonly activeNodeId: string | null;
  readonly activeSchemaId: string | null;
  readonly page: PageKind;
  /** The app bar's data: tabs with targets resolved, breadcrumb, back, rail statistics. */
  readonly frame: FrameModel;
}

/** The regions a shell places, each one already rendered by the position that owns it. */
export interface AppShellSlots {
  /** The content column: whichever page this is. */
  readonly default?: () => VNode[];
  /** The navigation tree, which is the `NavTree` position. */
  readonly nav?: () => VNode[];
  /** The search overlay, which is the `CommandPalette` position. */
  readonly palette?: () => VNode[];
}

/**
 * Renders the frame of one page.
 *
 * @param props - What the document is called, which page is open, and the frame's data
 * @param context - Vue's second argument, for the regions this frame places
 * @returns The regions of the frame, in document order
 */
export function AppShell(
  props: AppShellProps,
  context: { readonly slots: AppShellSlots },
): VNode[] {
  const frame = props.frame;

  return [
    h('a', { class: 'oref-skip', href: `#${MAIN_ID}` }, 'Skip to content'),
    h('header', { class: 'oref-header' }, [
      h('a', { class: 'oref-brand', href: overviewHref(props.basePath) }, [
        h('span', { class: 'oref-brand-title' }, props.title),
        h('span', { class: 'oref-brand-version' }, props.version),
      ]),
      h('div', { class: 'oref-header-mid' }, [
        // A LINK AND NOT A HISTORY BUTTON: where back leads is a fact of the address, so it
        // works before hydration, in a static build, and in a reader opened from a shared url
        // whose history holds nothing.
        frame.backHref === '' ? null : h('a', { class: 'oref-back', href: frame.backHref }, 'Back'),
        frame.crumb === '' ? null : h('span', { class: 'oref-crumb' }, frame.crumb),
        ...(context.slots.palette?.() ?? []),
      ]),
      frame.tabs.length === 0
        ? null
        : h(
            'nav',
            { class: 'oref-tabs', 'aria-label': 'Sections' },
            frame.tabs.map((tab) =>
              h(
                'a',
                {
                  class: 'oref-tab',
                  key: tab.kind,
                  href: tab.href,
                  ...(tab.active ? { 'aria-current': 'page' } : {}),
                },
                [
                  TAB_LABELS[tab.kind],
                  tab.count > 0 ? h('span', { class: 'oref-tab-count' }, String(tab.count)) : null,
                ],
              ),
            ),
          ),
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

/**
 * The navigation, virtualized.
 *
 * Written as a render function rather than a single file component on purpose: an SFC needs a
 * template compiler in the build of every consumer of this package, and the compiler is exactly
 * the thing a strict policy forbids at runtime because it builds functions from strings. A
 * render function needs no compiler anywhere.
 *
 * THE TREE IS FLATTENED AND CUT INTO CHUNKS, per `page/domain/nav-rows.ts`, so that about sixty
 * rows are in the document at once whatever the document navigates. Depth survives as
 * `data-oref-level`, which the theme indents by: a nested list would have to be whole to be
 * nested, and whole is the thing being avoided.
 *
 * An unrendered chunk is an empty element that reserves the height of a full chunk through one
 * class, because every chunk holds the same number of rows. That is what makes virtualization
 * possible without writing a computed length into the document, which STANDARDS 10 forbids.
 *
 * The window opens on the chunk holding the page's own entry, and the container is scrolled to
 * it after mount, so a reader arriving at an operation sees it in the sidebar rather than a band
 * of reserved height where the chunks above it are.
 *
 * A GROUP THE PAGE DID NOT SHIP OPENS BY FETCHING. Since T012-R2 a page carries the navigation
 * it can draw rather than the document's whole index, per `nav-payload.ts`, so a closed group
 * is a header with a count and no children. Opening one asks for the rest, once, and a fetch
 * that fails leaves the group closed and says so rather than showing an empty group, which is
 * what "no children" would otherwise look like.
 *
 * IT READS ITS ENTRIES FROM ITS PROPS AND NOT FROM THE STORE, since `TX-SLOTWIRE`. `NavTree` is
 * a slot, and a position whose data arrived through an injection key private to this package is
 * a position a theme cannot fill. What it is handed is what the store holds at that moment, plus
 * the one function that can fetch the rest.
 *
 * Class names come from the vocabulary the default theme already declares, so that the markup
 * this package emits and the stylesheet that package ships agree without either one importing
 * the other.
 */

import { useSlot } from '@openref/vue';
import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type PropType,
  type VNode,
} from 'vue';
import { methodBadge } from './method-badge';
import { StateNotice } from './StateNotice';
import { nodeHref, schemaHref, serviceHref } from '../page/domain/links';
import {
  chunkAt,
  chunkOfActive,
  chunkRows,
  chunkWindow,
  expandedInSlice,
  flattenNavigation,
  type NavRow,
} from '../page/domain/nav-rows';
import type { FrameStatsModel, NavEntryModel } from '@openref/vue';

/** A box, in the two edges this needs. */
interface EdgesLike {
  readonly top: number;
  readonly bottom: number;
}

/**
 * What this needs from an element, and nothing else.
 *
 * THE DOM IS DESCRIBED HERE RATHER THAN IMPORTED, the way `browser/` and the harness describe
 * it: this directory compiles in a program with no DOM library, because everything in it also
 * renders on a server. The four members below are what finding a scroll container and moving
 * it by the smallest honest amount takes.
 */
interface ElementLike {
  readonly parentElement: ElementLike | null;
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  querySelector(selector: string): { getBoundingClientRect(): EdgesLike } | null;
  getBoundingClientRect(): EdgesLike;
}

/** Computed overflow values that make an element a scroll container. */
const SCROLLS = ['auto', 'scroll', 'overlay'];

/**
 * The element that actually scrolls, which is a question only the theme can answer.
 *
 * The nearest ancestor whose computed overflow scrolls, and this element itself when nothing
 * above it does. A package that renders markup cannot know which element a stylesheet gave the
 * overflow to: the default theme gives it to `.oref-sidebar` and leaves `.oref-nav-scroll`
 * visible, a theme that wanted the rail to scroll inside its own frame would do the reverse,
 * and both are legitimate. Reading it off the computed style asks rather than assumes.
 *
 * @param from - The rail this component drew
 * @returns The element whose scroll events move the window
 */
function scrollerOf(from: ElementLike): ElementLike {
  const view = globalThis as unknown as {
    getComputedStyle(element: ElementLike): { readonly overflowY: string };
  };

  for (let at: ElementLike | null = from; at !== null; at = at.parentElement) {
    if (SCROLLS.includes(view.getComputedStyle(at).overflowY)) return at;
  }

  return from;
}

function rowClasses(row: NavRow, active: boolean): string[] {
  const classes = ['oref-nav-item'];
  if (row.nodeId === null && row.schemaId === null) classes.push('oref-nav-group');
  if (row.deprecated) classes.push('oref-deprecated');
  if (active) classes.push('oref-active');
  return classes;
}

/** Entry ids on the way down to a node, so its group can open when the node becomes current. */
function ancestorsOf(entries: readonly NavEntryModel[], nodeId: string): readonly string[] {
  for (const entry of entries) {
    if (entry.nodeId === nodeId) return [];

    const below = ancestorsOf(entry.children, nodeId);
    if (below.length > 0 || entry.children.some((child) => child.nodeId === nodeId)) {
      return [entry.id, ...below];
    }
  }

  return [];
}

/** Renders the document navigation as a windowed list of links. */
export const NavigationTree = defineComponent({
  name: 'OrefNavigationTree',

  props: {
    entries: { type: Array as PropType<readonly NavEntryModel[]>, required: true },
    activeNodeId: { type: String as PropType<string | null>, default: null },
    activeSchemaId: { type: String as PropType<string | null>, default: null },
    basePath: { type: String, default: '' },
    /** The stats row above the tree: the document's counts, not this slice's. */
    stats: {
      type: Object as PropType<FrameStatsModel>,
      default: () => ({ operations: 0, groups: 0, drift: null }),
    },
    /** True when these entries are the whole navigation, so nothing has to be fetched. */
    complete: { type: Boolean, default: true },
    /** Rows in the whole navigation, so a partial tree can say what it is not showing. */
    total: { type: Number, default: 0 },
    /** Fetches the rest, once. Answers false when there is nothing to fetch or it failed. */
    load: {
      type: Function as PropType<() => Promise<boolean>>,
      default: async () => Promise.resolve(false),
    },
  },

  setup(props) {
    const notice = useSlot('StateNotice', StateNotice);

    // WHAT IS OPEN IS READ OFF THE SLICE, ONCE. The page ships the children of the groups it
    // renders open, so the first client render reproduces the server's rows from the same
    // data. Reading it later, after a fetch has filled every group, would open the document
    // entire and the markup would stop matching what it is hydrating.
    const expanded = ref(expandedInSlice(props.entries));
    const failed = ref(false);

    // THE REMEMBERED OPERATION OPENS ITS OWN GROUP, per SPEC 11 and `TX-PARITY-UI`: the
    // memory moves `activeNodeId` after mount on the pages that arrived without one, and the
    // rail's `aria-current` can only stay on a row that is drawn. The children arrive through
    // the shared store's single fetch, which the host starts when it applies the memory, so
    // this watches both the id and the entries and expands when the trail exists. It only
    // ever adds to the open set: what the reader opened stays open.
    watch(
      [(): string | null => props.activeNodeId, (): readonly NavEntryModel[] => props.entries],
      ([nodeId]) => {
        if (nodeId === null) return;

        const trail = ancestorsOf(props.entries, nodeId);
        if (trail.length === 0) return;

        expanded.value = new Set([...expanded.value, ...trail]);
      },
    );

    const rows = computed(() => flattenNavigation(props.entries, expanded.value));
    const chunks = computed(() => chunkRows(rows.value));

    // Where the window starts is a pure function of the page, so the server and the first client
    // render agree without anything being carried between them.
    const current = ref(chunkOfActive(rows.value, props.activeNodeId, props.activeSchemaId));

    async function toggle(row: NavRow): Promise<void> {
      if (expanded.value.has(row.id)) {
        const next = new Set(expanded.value);
        next.delete(row.id);
        expanded.value = next;
        return;
      }

      // Only a fetch can open a group whose children never travelled with the page.
      if (!props.complete && !(await props.load())) {
        failed.value = true;
        return;
      }

      expanded.value = new Set(expanded.value).add(row.id);
    }

    const visible = computed(() => new Set(chunkWindow(current.value, chunks.value.length)));

    // THE RAIL AND THE ELEMENT THE RAIL SCROLLS INSIDE ARE TWO ELEMENTS, and until this they
    // were assumed to be one. The handler sat on `.oref-nav-scroll`, which the shipped theme
    // draws `display: block` with a visible overflow, so it never fired: a `scroll` event does
    // not bubble, and the element that scrolls is `.oref-sidebar` above it. The window
    // therefore stayed on whatever chunk the first render chose, and a reader whose entry was
    // in chunk two or beyond met the reserved height of chunk zero as a blank band with the
    // rows below the fold. Measured 602.9px of blank on a 1440x640 viewport.
    const rail = ref<ElementLike | null>(null);
    let scroller: ElementLike | null = null;

    function onScroll(): void {
      if (scroller === null) return;

      const at = chunkAt(scroller, chunks.value.length);
      if (at !== current.value) current.value = at;
    }

    onMounted(() => {
      const element = rail.value;
      if (element === null) return;

      // The attribute is how the binding can be checked rather than described: a browser suite
      // reads it back and asserts the marked element is the one whose overflow really scrolls.
      scroller = scrollerOf(element);
      scroller.setAttribute('data-oref-nav-scroller', '');
      scroller.addEventListener('scroll', onScroll);

      // AND THE WINDOW IS BROUGHT INTO VIEW, WHICH IS THE OTHER HALF OF THE SAME DEFECT.
      // `chunkOfActive` opens the window on the reader's own entry, and nothing ever scrolled
      // the container to it, so the window was correct and off screen behind the reserved
      // height of the chunks above it.
      //
      // THE ARITHMETIC IS WRITTEN OUT RATHER THAN LEFT TO `scrollIntoView`, and the reason is
      // the second scroll it would do. That method walks every scrollable ancestor, so bringing
      // a row into the rail would also move the page under a reader who asked for neither. This
      // moves one container by the smallest amount that puts the row inside it, and moves it not
      // at all when the row is already there.
      const active = element.querySelector('.oref-nav-item.oref-active');

      if (active !== null) {
        const row = active.getBoundingClientRect();
        const view = scroller.getBoundingClientRect();
        const below = row.bottom - view.bottom;
        const above = row.top - view.top;

        scroller.scrollTop += below > 0 ? below : above < 0 ? above : 0;
      }
    });

    onBeforeUnmount(() => {
      scroller?.removeEventListener('scroll', onScroll);
      scroller?.removeAttribute('data-oref-nav-scroller');
      scroller = null;
    });

    /**
     * What a row says, per the layout since `TX-MARKUP`: an operation is its method badge and
     * its path, a channel its event badge and address, and everything else keeps its label.
     * The summary stays the palette's and the page's; the rail is the dense mono column the
     * design draws.
     */
    function rowBody(row: NavRow): VNode[] {
      if (row.nodeId === null || row.hint === '') {
        return [h('span', { class: 'oref-nav-label' }, row.label)];
      }

      if (row.method === '') {
        return [
          h('span', { class: 'oref-badge oref-method-event' }, 'EVT'),
          h('span', { class: 'oref-nav-path' }, row.hint),
        ];
      }

      // The SSE badge is the layout's identity mark, per `TX-PARITY-UI`; the path still
      // comes off the hint by the method's own length, because the hint is `METHOD /path`.
      const badge = methodBadge(row.method, row.sse);

      return [
        h('span', { class: `oref-badge ${badge.className}` }, badge.text),
        h('span', { class: 'oref-nav-path' }, row.hint.slice(row.method.length + 1)),
      ];
    }

    function renderRow(row: NavRow): VNode {
      const active =
        (row.nodeId !== null && row.nodeId === props.activeNodeId) ||
        (row.schemaId !== null && row.schemaId === props.activeSchemaId);

      const href =
        row.nodeId !== null
          ? nodeHref(row.nodeId, props.basePath)
          : row.schemaId !== null
            ? schemaHref(row.schemaId, props.basePath)
            : null;

      // THE DRIFT MARKER DRAWS ONLY ABOVE ZERO, per the `driftCount` rule: it is a warning
      // glyph, so its absence asserts nothing, and a document nothing measured shows none.
      const drift =
        row.driftCount > 0
          ? h('span', { class: 'oref-nav-drift' }, `▲${String(row.driftCount)}`)
          : null;

      // THE SERVICE GROUP'S MARK AND CARD LINK, per SPEC 15.3: a sibling of the toggle rather
      // than inside it, because a link inside a button is not markup. The anchor is the status
      // dot: neutral as served, coloured by the `data-oref-remote-status` attribute the
      // federation snapshot fetch writes, so a degraded remote is visible from anywhere the
      // rail is. A service with no remote entry is local and keeps the neutral mark.
      const serviceLink =
        row.serviceId === null
          ? null
          : h('a', {
              class: 'oref-nav-service',
              href: serviceHref(row.serviceId, props.basePath),
              'data-oref-service': row.serviceId,
              'aria-label': `Service ${row.label}`,
            });

      // A GROUP IS A BUTTON, AND A GROUP WITH NOTHING IN IT IS NOT. `childCount` is what the
      // document has rather than what this page carries, so a closed group offers to open and
      // an empty one, which `children` alone cannot tell it from, does not. A service group
      // with nothing in it still gets its card link: it is really in the federation, per the
      // merge's own navigation rule.
      if (href === null && (row.childCount > 0 || serviceLink !== null)) {
        return h(
          'li',
          {
            class:
              serviceLink === null ? 'oref-nav-entry' : 'oref-nav-entry oref-nav-entry-service',
            key: row.id,
            'data-oref-level': Math.min(row.level, 6),
          },
          [
            h(
              'button',
              {
                class: [...rowClasses(row, false), 'oref-nav-toggle'],
                type: 'button',
                'aria-expanded': row.expanded ? 'true' : 'false',
                onClick: () => {
                  void toggle(row);
                },
              },
              [
                h('span', { class: 'oref-nav-label' }, row.label),
                h('span', { class: 'oref-nav-count' }, String(row.childCount)),
                drift,
              ],
            ),
            serviceLink,
          ],
        );
      }

      const label =
        href === null
          ? h('span', { class: rowClasses(row, false) }, [...rowBody(row), drift])
          : h(
              'a',
              {
                class: rowClasses(row, active),
                href,
                ...(active ? { 'aria-current': 'page' } : {}),
              },
              [...rowBody(row), drift],
            );

      return h(
        'li',
        { class: 'oref-nav-entry', key: row.id, 'data-oref-level': Math.min(row.level, 6) },
        [label],
      );
    }

    return (): VNode =>
      h('div', { class: 'oref-nav-scroll', ref: rail }, [
        // THE STATS ROW SAYS WHAT THE DOCUMENT HOLDS, not what this slice carries, so a
        // partial tree still states the whole. Null and zero are different statements, per
        // SPEC 7.3, and until this only one of them was drawn: no report printed nothing,
        // which is what a clean measured document would have printed if the figure had been
        // a warning glyph. It is not, it is a count, so the absence gets words.
        h('div', { class: 'oref-nav-stats' }, [
          h('span', {}, `${String(props.stats.operations)} operations`),
          h('span', {}, `${String(props.stats.groups)} groups`),
          props.stats.drift === null
            ? h(notice.value, { kind: 'drift-missing', message: 'drift not measured' })
            : h('b', { class: 'oref-nav-stats-drift' }, `▲ ${String(props.stats.drift)}`),
        ]),
        ...chunks.value.map((chunk, index) =>
          h(
            'ul',
            {
              class: ['oref-nav-list', visible.value.has(index) ? 'oref-nav-rendered' : ''],
              key: index,
              'data-oref-chunk': index,
            },
            visible.value.has(index) ? chunk.map(renderRow) : [],
          ),
        ),
        // Rendered only after a failure, so it is absent from the server's markup and from the
        // first client render, and hydration has nothing to disagree about.
        failed.value
          ? h(notice.value, {
              kind: 'nav-unavailable',
              message:
                'The rest of the navigation could not be loaded. This page still lists what it arrived with.',
            })
          : null,
      ]);
  },
});

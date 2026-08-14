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
 * The window opens on the chunk holding the page's own entry, so a reader arriving at an
 * operation sees it in the sidebar rather than at the top of a list of two thousand.
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
import { computed, defineComponent, h, ref, type PropType, type VNode } from 'vue';
import { StateNotice } from './StateNotice';
import { nodeHref, schemaHref } from '../page/domain/links';
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

/** What this component needs from a scroll event target, and nothing else. */
interface ScrollTarget {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

interface ScrollEventLike {
  readonly target: unknown;
}

function isScrollTarget(value: unknown): value is ScrollTarget {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<ScrollTarget>;
  return (
    typeof candidate.scrollTop === 'number' &&
    typeof candidate.scrollHeight === 'number' &&
    typeof candidate.clientHeight === 'number'
  );
}

function rowClasses(row: NavRow, active: boolean): string[] {
  const classes = ['oref-nav-item'];
  if (row.nodeId === null && row.schemaId === null) classes.push('oref-nav-group');
  if (row.deprecated) classes.push('oref-deprecated');
  if (active) classes.push('oref-active');
  return classes;
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

    function onScroll(event: ScrollEventLike): void {
      const target = (event as { target?: unknown }).target;
      if (!isScrollTarget(target)) return;

      const at = chunkAt(target, chunks.value.length);
      if (at !== current.value) current.value = at;
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

      // A GROUP IS A BUTTON, AND A GROUP WITH NOTHING IN IT IS NOT. `childCount` is what the
      // document has rather than what this page carries, so a closed group offers to open and
      // an empty one, which `children` alone cannot tell it from, does not.
      if (href === null && row.childCount > 0) {
        return h(
          'li',
          { class: 'oref-nav-entry', key: row.id, 'data-oref-level': Math.min(row.level, 6) },
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
          ],
        );
      }

      const label =
        href === null
          ? h('span', { class: rowClasses(row, false) }, [
              h('span', { class: 'oref-nav-label' }, row.label),
              drift,
            ])
          : h(
              'a',
              {
                class: rowClasses(row, active),
                href,
                ...(active ? { 'aria-current': 'page' } : {}),
              },
              [h('span', { class: 'oref-nav-label' }, row.label), drift],
            );

      return h(
        'li',
        { class: 'oref-nav-entry', key: row.id, 'data-oref-level': Math.min(row.level, 6) },
        [label],
      );
    }

    return (): VNode =>
      h('div', { class: 'oref-nav-scroll', onScroll }, [
        // THE STATS ROW SAYS WHAT THE DOCUMENT HOLDS, not what this slice carries, so a
        // partial tree still states the whole. The drift cell draws only when a report
        // exists: null and zero are different statements, per SPEC 7.3.
        h('div', { class: 'oref-nav-stats' }, [
          h('span', {}, `${String(props.stats.operations)} operations`),
          h('span', {}, `${String(props.stats.groups)} groups`),
          props.stats.drift === null
            ? null
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

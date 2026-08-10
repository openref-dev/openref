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
 * Class names come from the vocabulary the default theme already declares, so that the markup
 * this package emits and the stylesheet that package ships agree without either one importing
 * the other.
 */

import { computed, defineComponent, h, ref, type PropType, type VNode } from 'vue';
import { nodeHref, schemaHref } from '../page/domain/links';
import {
  chunkAt,
  chunkOfActive,
  chunkRows,
  chunkWindow,
  flattenNavigation,
  type NavRow,
} from '../page/domain/nav-rows';
import type { NavEntryModel } from '../page/domain/page-model';

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
  },

  setup(props) {
    const rows = computed(() => flattenNavigation(props.entries));
    const chunks = computed(() => chunkRows(rows.value));

    // Where the window starts is a pure function of the page, so the server and the first client
    // render agree without anything being carried between them.
    const current = ref(chunkOfActive(rows.value, props.activeNodeId, props.activeSchemaId));

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

      const label =
        href === null
          ? h('span', { class: rowClasses(row, false) }, row.label)
          : h(
              'a',
              {
                class: rowClasses(row, active),
                href,
                ...(active ? { 'aria-current': 'page' } : {}),
              },
              row.label,
            );

      return h(
        'li',
        { class: 'oref-nav-entry', key: row.id, 'data-oref-level': Math.min(row.level, 6) },
        [label],
      );
    }

    return (): VNode =>
      h(
        'div',
        { class: 'oref-nav-scroll', onScroll },
        chunks.value.map((chunk, index) =>
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
      );
  },
});

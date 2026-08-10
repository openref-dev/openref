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
 * is a header with a count and no children. Opening one asks the store for the rest, once, and
 * a fetch that fails leaves the group closed and says so rather than showing an empty group,
 * which is what "no children" would otherwise look like.
 *
 * Class names come from the vocabulary the default theme already declares, so that the markup
 * this package emits and the stylesheet that package ships agree without either one importing
 * the other.
 */

import { computed, defineComponent, h, inject, ref, type PropType, type VNode } from 'vue';
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
import { NAVIGATION_KEY, type NavigationStore } from '../page/api/nav-context';
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
    const store = inject<NavigationStore | null>(NAVIGATION_KEY, null);

    // WHAT IS OPEN IS READ OFF THE SLICE, ONCE. The page ships the children of the groups it
    // renders open, so the first client render reproduces the server's rows from the same
    // data. Reading it later, after a fetch has filled every group, would open the document
    // entire and the markup would stop matching what it is hydrating.
    const expanded = ref(expandedInSlice(props.entries));

    const entries = computed(() => store?.entries.value ?? props.entries);
    const rows = computed(() => flattenNavigation(entries.value, expanded.value));
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
      if (store !== null && !store.complete.value && !(await store.load())) return;

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
              ],
            ),
          ],
        );
      }

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
      h('div', { class: 'oref-nav-scroll', onScroll }, [
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
        store?.failed.value === true
          ? h(
              'p',
              { class: 'oref-nav-error', role: 'status' },
              'The rest of the navigation could not be loaded. This page still lists what it arrived with.',
            )
          : null,
      ]);
  },
});

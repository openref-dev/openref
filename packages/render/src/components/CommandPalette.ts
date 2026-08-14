/**
 * The command palette: `Ctrl/Cmd+K`, type, arrow, enter.
 *
 * IT RENDERS NOTHING WHILE IT IS CLOSED. A dialog that is present and hidden is markup on every
 * page for a feature most readers never open, and on a document that navigates two thousand
 * entries the results list is the second largest thing the page could hold. Closed costs one
 * key listener.
 *
 * The server therefore renders it closed, always, and so does the first client render, which is
 * what keeps hydration identical. There is nothing to remember across a page load: a palette
 * that reopened itself after navigation would be a palette nobody could leave.
 *
 * Results are links. Enter activates the focused link rather than assigning to `location`, so
 * the keyboard path and the mouse path are the same path, and a middle click or a modifier does
 * what a reader expects of a link.
 *
 * ARIA is the combobox pattern: the input owns the listbox, `aria-activedescendant` says which
 * option is current, and focus stays in the input while the arrows move the selection.
 *
 * OPENING IT IS WHAT FETCHES THE INDEX. Since T012-R2 a page carries the navigation it can
 * draw and not the document's whole one, so searching needs the rest, and one keystroke deep is
 * exactly the place a fetch is invisible. It is the same payload and the same store the sidebar
 * uses, so opening a group first and the palette second costs one request between them. Until
 * it arrives the palette searches what the page shipped, which is a short list rather than an
 * empty one, and says that it is still loading.
 *
 * THE STATE IS HERE AND THE MARKUP IS THE SLOT, since `TX-SLOTWIRE`. This is the deferred host:
 * it holds what is open, what was typed and which row is selected, and it owns the search, which
 * is the part that must not be in the first paint. What it hands the `CommandPalette` slot is
 * that state and four callbacks, so a theme replaces the overlay without acquiring the index, the
 * shortcut or the store.
 *
 * A HIT IS THE PALETTE'S OWN ROW AND NOT A `SearchHit`. This searches the navigation slice and
 * never consults the search port, so the method and the path arrive joined into the one `hint`
 * string the sidebar draws, which is what the position can actually supply.
 */

import { useSlot, type PaletteHitModel } from '@openref/vue';
import {
  computed,
  defineComponent,
  h,
  inject,
  onBeforeUnmount,
  onMounted,
  ref,
  type PropType,
  type VNode,
} from 'vue';
import { PaletteOverlay } from './PaletteOverlay';
import { nodeHref, schemaHref } from '../page/domain/links';
import { flattenNavigation, type NavRow } from '../page/domain/nav-rows';
import { searchNavigation } from '../page/domain/nav-search';
import { NAVIGATION_KEY, type NavigationStore } from '../page/api/nav-context';
import type { NavEntryModel } from '@openref/vue';
import { listenerHost, type KeyEvent } from '../shared/dom';

function hrefOf(row: NavRow, basePath: string): string {
  if (row.nodeId !== null) return nodeHref(row.nodeId, basePath);
  return row.schemaId === null ? basePath : schemaHref(row.schemaId, basePath);
}

/** Holds the palette's state and the search, and hands both to whatever draws it. */
export const CommandPalette = defineComponent({
  name: 'OrefCommandPalette',

  props: {
    entries: { type: Array as PropType<readonly NavEntryModel[]>, required: true },
    basePath: { type: String, default: '' },
  },

  setup(props) {
    const overlay = useSlot('CommandPalette', PaletteOverlay);
    const store = inject<NavigationStore | null>(NAVIGATION_KEY, null);
    const openState = ref(false);
    const query = ref('');
    const selected = ref(0);

    // Flattened once and only when the palette is first opened, because a closed palette should
    // cost nothing on a page nobody searches from. Every entry present is searched, whatever the
    // sidebar has open: a reader typing a path is looking for it, not for what is on screen.
    const rows = computed<NavRow[]>(() =>
      openState.value ? flattenNavigation(store?.entries.value ?? props.entries) : [],
    );
    const hits = computed<PaletteHitModel[]>(() =>
      searchNavigation(rows.value, query.value).map((hit) => ({
        id: hit.row.id,
        label: hit.row.label,
        hint: hit.row.hint,
        href: hrefOf(hit.row, props.basePath),
      })),
    );
    const partial = computed(() => store !== null && !store.complete.value);

    function open(): void {
      openState.value = true;
      selected.value = 0;
      void store?.load();
    }

    function close(): void {
      openState.value = false;
      query.value = '';
      selected.value = 0;
    }

    function onGlobalKey(event: KeyEvent): void {
      const modifier = event.metaKey === true || event.ctrlKey === true;

      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (openState.value) close();
        else open();
        return;
      }

      if (event.key === 'Escape' && openState.value) {
        event.preventDefault();
        close();
      }
    }

    onMounted(() => {
      listenerHost()?.addEventListener('keydown', onGlobalKey);
    });

    onBeforeUnmount(() => {
      listenerHost()?.removeEventListener('keydown', onGlobalKey);
    });

    return (): VNode =>
      h(overlay.value, {
        open: openState.value,
        query: query.value,
        selected: selected.value,
        hits: hits.value,
        partial: partial.value,
        onOpen: open,
        onClose: close,
        onQuery: (text: string): void => {
          query.value = text;
          selected.value = 0;
        },
        onSelect: (index: number): void => {
          selected.value = index;
        },
      });
  },
});

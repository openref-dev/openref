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
 * A HIT IS THE PALETTE'S OWN ROW AND NOT A `SearchHit`, whichever of the two searches produced
 * it. The method and the path arrive joined into the one `hint` string the sidebar draws,
 * because that is what a navigation row can supply and a theme must not have to tell the two
 * sources apart.
 *
 * IT SEARCHES THE FULL TEXT INDEX WHEN THERE IS ONE AND THE NAVIGATION ROWS WHEN THERE IS NOT,
 * since T042. The two are alternatives rather than an addition: an index that answers a query
 * has already read every label and hint the rows carry, plus the descriptions, the parameters
 * and the schema names that no row does, so merging them would rank one document twice. The
 * index is not in this chunk either: it is fetched from this page's own origin on the first
 * open and loaded by a port the host supplied, exactly as the console reaches a runner.
 *
 * UNTIL IT ARRIVES, AND IF IT NEVER DOES, THE ROWS ARE WHAT IS SEARCHED. That is the fail open
 * policy of a progressive enhancement, and it is why nothing here awaits the load: the palette
 * opens and answers on the same keystroke it always did.
 */

import { useSlot, type PaletteHitModel, type SearchHit } from '@openref/vue';
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
import { NAV_HIT_LIMIT, searchNavigation } from '../page/domain/nav-search';
import { NAVIGATION_KEY, type NavigationStore } from '../page/api/nav-context';
import { createSearchStore } from '../page/api/search-context';
import type { SearchLoader } from '../page/domain/search-source';
import type { NavEntryModel } from '@openref/vue';
import { listenerHost, type KeyEvent } from '../shared/dom';

function hrefOf(row: NavRow, basePath: string): string {
  if (row.nodeId !== null) return nodeHref(row.nodeId, basePath);
  return row.schemaId === null ? basePath : schemaHref(row.schemaId, basePath);
}

/**
 * Where one index hit leads.
 *
 * THE KIND DECIDES, AND IT IS THE SAME TWO ADDRESS SPACES THE ROWS USE. A schema is a schema
 * page and everything else is a node page, which is exactly what `hrefOf` does with the two
 * nullable ids a row carries; the builders are the same builders, so an index hit and a
 * navigation hit for one operation resolve to one url.
 */
function hitHref(hit: SearchHit, basePath: string): string {
  return hit.kind === 'schema' ? schemaHref(hit.id, basePath) : nodeHref(hit.id, basePath);
}

/**
 * The `METHOD /path` line a hit is shown with, in the shape a navigation row already draws.
 *
 * The index stores the method lowercase, per `search-document.ts`, and the sidebar shows it
 * uppercase, so the case is fixed here rather than in either of them. A channel has an address
 * instead, and a schema has neither, which is a row with no hint and not a row with an empty
 * one pretending to be something.
 */
function hitHint(hit: SearchHit): string {
  if (hit.method !== undefined && hit.path !== undefined) {
    return `${hit.method.toUpperCase()} ${hit.path}`;
  }

  return hit.address ?? '';
}

/** Holds the palette's state and the search, and hands both to whatever draws it. */
export const CommandPalette = defineComponent({
  name: 'OrefCommandPalette',

  props: {
    entries: { type: Array as PropType<readonly NavEntryModel[]>, required: true },
    basePath: { type: String, default: '' },
    /**
     * Hash of the document this page is about, so an index about another one is refused.
     *
     * Empty on a page mounted without one, which is how most of the component tests mount it:
     * with no loader beside it nothing is ever fetched, so nothing is ever compared.
     */
    documentHash: { type: String, default: '' },
    /**
     * How the full text index is reached, bound to this page by whoever composed the entry.
     *
     * ABSENT ON THE SERVER, ALWAYS, and absent in a build that wires no port, which is the
     * palette as it shipped before T042: it matches the navigation rows and says so.
     */
    loadSearch: { type: Function as PropType<SearchLoader>, default: undefined },
  },

  setup(props) {
    const overlay = useSlot('CommandPalette', PaletteOverlay);
    const store = inject<NavigationStore | null>(NAVIGATION_KEY, null);
    // Created here rather than provided from above: the palette is the only reader, and this
    // component is already the deferred host of its own slot, so the store, the fetch and the
    // refusal all stay in the chunk a reader pays for by opening it.
    const search = createSearchStore({
      documentHash: props.documentHash,
      ...(props.loadSearch === undefined ? {} : { loader: props.loadSearch }),
    });
    const openState = ref(false);
    const query = ref('');
    const selected = ref(0);

    // Flattened once and only when the palette is first opened, because a closed palette should
    // cost nothing on a page nobody searches from. Every entry present is searched, whatever the
    // sidebar has open: a reader typing a path is looking for it, not for what is on screen.
    const rows = computed<NavRow[]>(() =>
      openState.value ? flattenNavigation(store?.entries.value ?? props.entries) : [],
    );
    const hits = computed<PaletteHitModel[]>(() => {
      const index = search.port.value;

      if (index !== null) {
        // THE LIMIT IS THE PALETTE'S AND NOT THE PORT'S. Both sources fill one list, and a host
        // supplied port with a default of its own would make the list's length depend on which
        // of the two answered.
        return index.search(query.value.trim(), NAV_HIT_LIMIT).map((hit) => ({
          // PREFIXED BY KIND, BECAUSE THE TWO ID SPACES ARE SEPARATE AND THE KEY IS ONE LIST.
          // A node and a schema may be registered under one id, which `SCHEMA_SEGMENT` exists
          // to keep apart in the url; two rows keyed alike would be one row to Vue.
          id: `${hit.kind}:${hit.id}`,
          label: hit.title,
          hint: hitHint(hit),
          href: hitHref(hit, props.basePath),
        }));
      }

      return searchNavigation(rows.value, query.value).map((hit) => ({
        id: hit.row.id,
        label: hit.row.label,
        hint: hit.row.hint,
        href: hrefOf(hit.row, props.basePath),
      }));
    });
    // WHAT `partial` MEANS IS "THIS IS NOT THE WHOLE DOCUMENT YET", and there are now two ways
    // to be in that state rather than one. The navigation is still a slice, or the index that
    // reads more than the rows do has not arrived; either way the sentence the overlay prints
    // is the true one, that what did not match is not everything there is.
    //
    // A LOAD THAT FAILED IS DELIBERATELY NOT PARTIAL. Nothing further is coming, so saying the
    // index is still loading would be the promise SPEC 11 refuses.
    const partial = computed(
      () => (store !== null && !store.complete.value) || search.pending.value,
    );
    // AND IT IS NOT `search-no-results` EITHER, DECIDED AT T042 AND RECORDED IN SPEC 11. That was
    // what a failed fetch showed until now: true of the search that ran, silent about what it ran
    // over, and therefore a degraded state presented to the reader as an ordinary empty one. A
    // theme with no entry for the fourth kind still prints `message`, which is where the sentence
    // lives, so nothing breaks at runtime; the kind widens `StateNoticeKind` all the same, which
    // is a break of the theme contract rather than a minor version of it, per
    // `ai-docs/design/CONTRACT.md`. The prop this branch feeds, `CommandPalette.degraded`, is the
    // additive half.
    const degraded = computed(() => search.failed.value);

    function open(): void {
      openState.value = true;
      selected.value = 0;
      void store?.load();
      // Kicked off beside the navigation and awaited by neither: the palette answers on this
      // keystroke from whatever it already has, and the results become the index's when it
      // arrives, which is a recompute of a computed and not a second render path.
      void search.load();
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
        degraded: degraded.value,
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

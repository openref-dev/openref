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
 */

import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  ref,
  type PropType,
  type VNode,
} from 'vue';
import { nodeHref, schemaHref } from '../page/domain/links';
import { flattenNavigation, type NavRow } from '../page/domain/nav-rows';
import { searchNavigation } from '../page/domain/nav-search';
import type { NavEntryModel } from '../page/domain/page-model';
import { listenerHost, type KeyEvent, type QueryRoot } from '../shared/dom';

/** Id of the listbox, so the input can own it by name. */
const LIST_ID = 'oref-palette-list';

/** Id of one option, so `aria-activedescendant` can name it. */
function optionId(index: number): string {
  return `oref-palette-option-${String(index)}`;
}

function hrefOf(row: NavRow, basePath: string): string {
  if (row.nodeId !== null) return nodeHref(row.nodeId, basePath);
  return row.schemaId === null ? basePath : schemaHref(row.schemaId, basePath);
}

/** Renders the search dialog and the key that opens it. */
export const CommandPalette = defineComponent({
  name: 'OrefCommandPalette',

  props: {
    entries: { type: Array as PropType<readonly NavEntryModel[]>, required: true },
    basePath: { type: String, default: '' },
  },

  setup(props) {
    const openState = ref(false);
    const query = ref('');
    const selected = ref(0);
    const inputRef = ref<{ focus(): void } | null>(null);
    const listRef = ref<QueryRoot | null>(null);

    // Flattened once and only when the palette is first opened, because a closed palette should
    // cost nothing on a page nobody searches from.
    const rows = computed<NavRow[]>(() =>
      openState.value ? flattenNavigation(props.entries) : [],
    );
    const hits = computed(() => searchNavigation(rows.value, query.value));

    function open(): void {
      openState.value = true;
      selected.value = 0;
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

    /** Follows the option the arrows selected, by activating its link. */
    function activate(): void {
      const container = listRef.value;
      if (container === null) return;

      const wanted = optionId(selected.value);
      for (const element of container.querySelectorAll('[data-oref-option]')) {
        if (element.getAttribute('data-oref-option') !== wanted) continue;
        element.focus();
        return;
      }
    }

    function onInputKey(event: KeyEvent): void {
      const total = hits.value.length;

      if (event.key === 'ArrowDown' && total > 0) {
        event.preventDefault();
        selected.value = (selected.value + 1) % total;
        return;
      }

      if (event.key === 'ArrowUp' && total > 0) {
        event.preventDefault();
        selected.value = (selected.value - 1 + total) % total;
        return;
      }

      if (event.key === 'Enter' && total > 0) {
        event.preventDefault();
        activate();
      }
    }

    function onInput(event: { readonly target: unknown }): void {
      const target = event.target as { value?: unknown } | null;
      query.value = typeof target?.value === 'string' ? target.value : '';
      selected.value = 0;
    }

    function renderHit(row: NavRow, index: number): VNode {
      const current = index === selected.value;

      return h(
        'li',
        {
          class: ['oref-palette-hit', current ? 'oref-active' : ''],
          key: row.id,
          id: optionId(index),
          role: 'option',
          'aria-selected': current,
        },
        [
          h(
            'a',
            {
              class: 'oref-palette-link',
              href: hrefOf(row, props.basePath),
              'data-oref-option': optionId(index),
              tabindex: -1,
            },
            [
              h('span', { class: 'oref-palette-label' }, row.label),
              row.hint === '' ? null : h('span', { class: 'oref-palette-hint' }, row.hint),
            ],
          ),
        ],
      );
    }

    return (): VNode | null => {
      if (!openState.value) {
        // The button is what makes the feature discoverable, and it is what a pointer user
        // needs: a shortcut nobody is told about is a shortcut nobody uses.
        return h(
          'button',
          {
            class: 'oref-palette-open',
            type: 'button',
            onClick: open,
            'aria-keyshortcuts': 'Control+K Meta+K',
          },
          'Search',
        );
      }

      return h('div', { class: 'oref-palette-scrim', onClick: close }, [
        h(
          'div',
          {
            class: 'oref-palette',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': 'Search the reference',
            onClick: (event: { stopPropagation(): void }): void => {
              event.stopPropagation();
            },
          },
          [
            h('input', {
              class: 'oref-palette-input',
              type: 'text',
              value: query.value,
              autofocus: true,
              ref: inputRef,
              role: 'combobox',
              'aria-expanded': 'true',
              'aria-controls': LIST_ID,
              'aria-autocomplete': 'list',
              'aria-label': 'Search operations and schemas',
              ...(hits.value.length === 0
                ? {}
                : { 'aria-activedescendant': optionId(selected.value) }),
              onInput,
              onKeydown: onInputKey,
            }),
            h(
              'ul',
              { class: 'oref-palette-list', id: LIST_ID, role: 'listbox', ref: listRef },
              hits.value.length === 0
                ? [
                    h(
                      'li',
                      { class: 'oref-palette-empty' },
                      query.value.trim() === '' ? 'Type to search' : 'Nothing matches',
                    ),
                  ]
                : hits.value.map((hit, index) => renderHit(hit.row, index)),
            ),
          ],
        ),
      ]);
    };
  },
});

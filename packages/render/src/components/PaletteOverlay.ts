/**
 * The search overlay: the button that opens it, the field, the results, and the two empty states.
 *
 * IT IS THE DEFAULT OF THE `CommandPalette` SLOT AND HOLDS NO STATE. What is open, what was
 * typed and which row is selected belong to the host, which is also where the search runs, so a
 * theme that replaces this markup acquires neither the index nor the shortcut.
 *
 * ONE EXCEPTION, AND IT IS ABOUT FOCUS RATHER THAN STATE: Enter activates the selected row by
 * focusing its link, which needs the element and therefore a ref. Focus is not state a host can
 * hold on this position's behalf.
 */

import { useSlot, type PaletteHitModel } from '@openref/vue';
import { defineComponent, h, ref, type PropType, type VNode } from 'vue';
import { StateNotice } from './StateNotice';
import { type KeyEvent, type QueryRoot } from '../shared/dom';

/** Id of the listbox, so the input can own it by name. */
const LIST_ID = 'oref-palette-list';

/** Id of one option, so `aria-activedescendant` can name it. */
function optionId(index: number): string {
  return `oref-palette-option-${String(index)}`;
}

/** Renders the search dialog and the button that opens it. */
export const PaletteOverlay = defineComponent({
  name: 'OrefPaletteOverlay',

  props: {
    open: { type: Boolean, default: false },
    query: { type: String, default: '' },
    selected: { type: Number, default: 0 },
    hits: { type: Array as PropType<readonly PaletteHitModel[]>, default: () => [] },
    partial: { type: Boolean, default: false },
    onOpen: { type: Function as PropType<() => void>, required: true },
    onClose: { type: Function as PropType<() => void>, required: true },
    onQuery: { type: Function as PropType<(query: string) => void>, required: true },
    onSelect: { type: Function as PropType<(index: number) => void>, required: true },
  },

  setup(props) {
    const notice = useSlot('StateNotice', StateNotice);
    const inputRef = ref<{ focus(): void } | null>(null);
    const listRef = ref<QueryRoot | null>(null);

    /** Follows the option the arrows selected, by activating its link. */
    function activate(): void {
      const container = listRef.value;
      if (container === null) return;

      const wanted = optionId(props.selected);
      for (const element of container.querySelectorAll('[data-oref-option]')) {
        if (element.getAttribute('data-oref-option') !== wanted) continue;
        element.focus();
        return;
      }
    }

    function onInputKey(event: KeyEvent): void {
      const total = props.hits.length;

      if (event.key === 'ArrowDown' && total > 0) {
        event.preventDefault();
        props.onSelect((props.selected + 1) % total);
        return;
      }

      if (event.key === 'ArrowUp' && total > 0) {
        event.preventDefault();
        props.onSelect((props.selected - 1 + total) % total);
        return;
      }

      if (event.key === 'Enter' && total > 0) {
        event.preventDefault();
        activate();
      }
    }

    function onInput(event: { readonly target: unknown }): void {
      const target = event.target as { value?: unknown } | null;
      props.onQuery(typeof target?.value === 'string' ? target.value : '');
    }

    function renderHit(hit: PaletteHitModel, index: number): VNode {
      const current = index === props.selected;

      return h(
        'li',
        {
          class: ['oref-palette-hit', current ? 'oref-active' : ''],
          key: hit.id,
          id: optionId(index),
          role: 'option',
          'aria-selected': current,
        },
        [
          h(
            'a',
            {
              class: 'oref-palette-link',
              href: hit.href,
              'data-oref-option': optionId(index),
              tabindex: -1,
            },
            [
              h('span', { class: 'oref-palette-label' }, hit.label),
              hit.hint === '' ? null : h('span', { class: 'oref-palette-hint' }, hit.hint),
            ],
          ),
        ],
      );
    }

    return (): VNode => {
      if (!props.open) {
        // The button is what makes the feature discoverable, and it is what a pointer user
        // needs: a shortcut nobody is told about is a shortcut nobody uses.
        return h(
          'button',
          {
            class: 'oref-palette-open',
            type: 'button',
            onClick: props.onOpen,
            'aria-keyshortcuts': 'Control+K Meta+K',
          },
          'Search',
        );
      }

      const empty =
        props.query.trim() === ''
          ? { kind: 'search-empty' as const, message: 'Type to search' }
          : props.partial
            ? {
                kind: 'search-partial' as const,
                message:
                  'Nothing matches what this page arrived with. The rest of the index is still loading.',
              }
            : { kind: 'search-no-results' as const, message: 'Nothing matches' };

      return h('div', { class: 'oref-palette-scrim', onClick: props.onClose }, [
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
              value: props.query,
              autofocus: true,
              ref: inputRef,
              role: 'combobox',
              'aria-expanded': 'true',
              'aria-controls': LIST_ID,
              'aria-autocomplete': 'list',
              'aria-label': 'Search operations and schemas',
              ...(props.hits.length === 0
                ? {}
                : { 'aria-activedescendant': optionId(props.selected) }),
              onInput,
              onKeydown: onInputKey,
            }),
            h(
              'ul',
              { class: 'oref-palette-list', id: LIST_ID, role: 'listbox', ref: listRef },
              props.hits.length === 0
                ? [h(notice.value, empty)]
                : props.hits.map((hit, index) => renderHit(hit, index)),
            ),
          ],
        ),
      ]);
    };
  },
});

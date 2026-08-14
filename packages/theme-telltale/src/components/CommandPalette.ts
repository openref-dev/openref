import { h, type VNode } from 'vue';
import { eventValue, type ValueEvent } from '../dom';
import type { PaletteHitModel } from '@openref/vue';

/**
 * The palette, which in this theme is the main way through the reference rather than a shortcut.
 *
 * IT DRAWS A BUTTON WHEN IT IS SHUT, WHICH IS NOT THE SAME AS DRAWING NOTHING. The position is
 * resolved on every page, open or not, so the strip always carries the control that opens it.
 *
 * The three empty states are `StateNotice` kinds and this position does not write their sentences:
 * it says which state it is in and the notice says what that means. Two positions writing the same
 * English is how the English comes to differ.
 */
export default function CommandPalette(props: {
  readonly open: boolean;
  readonly query: string;
  readonly selected: number;
  readonly hits: readonly PaletteHitModel[];
  readonly partial: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onQuery: (query: string) => void;
  readonly onSelect: (index: number) => void;
}): VNode {
  if (!props.open) {
    return h(
      'button',
      {
        type: 'button',
        class: 'tt-palette-open',
        onClick: (): void => {
          props.onOpen();
        },
      },
      'SEARCH',
    );
  }

  return h('div', { class: 'tt-palette', role: 'dialog', 'aria-label': 'Search' }, [
    h('div', { class: 'tt-palette-bar' }, [
      h('input', {
        class: 'tt-palette-input',
        type: 'search',
        value: props.query,
        autocomplete: 'off',
        'aria-label': 'Search the reference',
        onInput: (event: ValueEvent): void => {
          props.onQuery(eventValue(event));
        },
      }),
      h(
        'button',
        {
          type: 'button',
          class: 'tt-palette-close',
          onClick: (): void => {
            props.onClose();
          },
        },
        'ESC',
      ),
    ]),
    h(
      'ul',
      { class: 'tt-palette-hits' },
      props.hits.map((hit, index) =>
        h(
          'li',
          {
            key: hit.id,
            class: ['tt-palette-hit', index === props.selected ? 'tt-palette-selected' : null],
          },
          [
            h(
              'a',
              {
                class: 'tt-palette-link',
                href: hit.href,
                onMouseenter: (): void => {
                  props.onSelect(index);
                },
              },
              [
                h('span', { class: 'tt-palette-label' }, hit.label),
                h('span', { class: 'tt-palette-hint' }, hit.hint),
              ],
            ),
          ],
        ),
      ),
    ),
    props.partial
      ? h('p', { class: 'tt-palette-partial' }, 'searching the slice on this page')
      : null,
  ]);
}

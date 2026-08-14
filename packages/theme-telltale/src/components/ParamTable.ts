import { h, type VNode } from 'vue';
import type { ParameterModel } from '@openref/vue';

/**
 * Parameters, on the row grid, with the location in the gutter.
 *
 * A `table` AND NOT A LIST OF DIVS. These are rows with columns that line up across them, which is
 * what a table element is, and a reader on a screen reader gets the column headers announced with
 * each cell for free. The row height is `--oref-layout-row`, this theme's own token, so every
 * table on the page sits on one grid.
 *
 * The description is HTML the server rendered and sanitized, per SPEC 12, and it is placed in its
 * own row under the name rather than in a cell, because a sentence in a narrow column is a
 * sentence nobody reads.
 */
export default function ParamTable(props: {
  readonly parameters: readonly ParameterModel[];
}): VNode {
  return h('section', { class: 'tt-params' }, [
    h('h2', { class: 'tt-strip-head' }, 'PARAMETERS'),
    h('table', { class: 'tt-table' }, [
      h('thead', {}, [
        h('tr', { class: 'tt-row tt-row-head' }, [
          h('th', { class: 'tt-col-in', scope: 'col' }, 'IN'),
          h('th', { class: 'tt-col-name', scope: 'col' }, 'NAME'),
          h('th', { class: 'tt-col-type', scope: 'col' }, 'TYPE'),
          h('th', { class: 'tt-col-req', scope: 'col' }, 'REQ'),
        ]),
      ]),
      h(
        'tbody',
        {},
        props.parameters.flatMap((parameter) => {
          const key = `${parameter.location}:${parameter.name}`;
          const row = h(
            'tr',
            {
              class: ['tt-row', parameter.deprecated ? 'tt-row-deprecated' : null],
              key,
            },
            [
              h('td', { class: 'tt-col-in' }, parameter.location.slice(0, 3).toUpperCase()),
              h('td', { class: 'tt-col-name' }, [
                h('code', { class: 'tt-param-name' }, parameter.name),
                parameter.deprecated
                  ? h('span', { class: 'tt-flag tt-flag-deprecated' }, 'DEP')
                  : null,
              ]),
              h('td', { class: 'tt-col-type' }, parameter.typeLabel),
              h('td', { class: 'tt-col-req' }, parameter.required ? 'YES' : 'no'),
            ],
          );

          if (parameter.descriptionHtml === '') return [row];

          return [
            row,
            h('tr', { class: 'tt-row tt-row-prose', key: `${key}:prose` }, [
              h('td', { class: 'tt-col-prose', colspan: 4 }, [
                h('div', { class: 'tt-prose', innerHTML: parameter.descriptionHtml }),
              ]),
            ]),
          ];
        }),
      ),
    ]),
  ]);
}

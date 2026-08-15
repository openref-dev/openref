/**
 * The reading half of the shapes page: every branch of the schema, expanded at once.
 *
 * SERVER MARKUP THE CLIENT ADOPTS, the Health panel shape: no state, no handler, no client
 * render. Everything a row says is computed from the page's schema payload at render time,
 * so the browser claims the container and leaves the rows alone, and the reading half costs
 * the first paint nothing.
 */

import { defineComponent, h, type PropType, type VNode } from 'vue';
import type { IRSchema } from '@openref/core';
import { shapeRowsOf, type ShapeRow } from '../page/domain/shape-rows';

/** One row: name, type, requiredness column, and the condition line under them. */
function renderRow(row: ShapeRow): VNode {
  const type =
    row.href === undefined
      ? h('span', { class: 'oref-shape-type' }, row.type)
      : h('a', { class: 'oref-shape-type oref-schema-link', href: row.href }, row.type);

  return h(
    'li',
    {
      class: [
        'oref-shape-row',
        `oref-shape-d${String(row.depth)}`,
        ...(row.kind === 'variant' ? ['oref-shape-variant'] : []),
        ...(row.kind === 'pattern' ? ['oref-shape-pattern-row'] : []),
      ],
      key: row.path,
    },
    [
      h('span', { class: 'oref-shape-name' }, row.name),
      type,
      row.requiredness === ''
        ? null
        : h(
            'span',
            {
              class: [
                'oref-shape-req',
                ...(row.requiredness === 'conditional' ? ['oref-shape-req-cond'] : []),
              ],
            },
            row.requiredness,
          ),
      row.when === '' ? null : h('span', { class: 'oref-shape-when' }, row.when),
    ],
  );
}

/** Renders the reading half. */
export const ShapesReader = defineComponent({
  name: 'OrefShapesReader',

  props: {
    schemaId: { type: String, required: true },
    schemas: { type: Object as PropType<Readonly<Record<string, IRSchema>>>, required: true },
    basePath: { type: String, required: true },
  },

  setup(props) {
    return (): VNode => {
      const rows = shapeRowsOf(props.schemaId, props.schemas, props.basePath);

      return h('div', { class: 'oref-shapes-read' }, [
        h('h2', { class: 'oref-section-title' }, 'Reading: every branch at once'),
        rows.length === 0
          ? h(
              'p',
              { class: 'oref-shape-empty' },
              'This schema declares no fields, so there is nothing to read as a form.',
            )
          : h('ul', { class: 'oref-shape-rows' }, rows.map(renderRow)),
      ]);
    };
  },
});

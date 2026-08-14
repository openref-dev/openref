import { useSlot, type RuntimeModel, type RuntimeValueModel } from '@openref/vue';
import { defineComponent, h, type PropType, type VNode } from 'vue';
import DriftCard from './DriftCard';
import ProvenanceTag from './ProvenanceTag';

/**
 * What the running application knows about one node, as instrument cells, with its findings.
 *
 * A ROW IS TOLD FROM A ROW BY `kind` AND NEVER BY ITS LABEL. Matching on the label is matching on
 * English, and the English of this block changed twice during M1. `kind` is on the model for
 * exactly this, and it is how the three error groups of SPEC 6.4 stay three statements here
 * instead of becoming one list: a promise, an observation and a host wide list are different
 * things and this theme prints the difference.
 *
 * THE FINDINGS ARE DRAWN HERE BECAUSE THIS IS THE ONLY POSITION THEY REACH. `RuntimeModel.drift`
 * and `OperationHeader.drift` are the two places a node page's findings are handed to a theme, and
 * the header is handed them without a position to put them in: `DriftCard` is a position of its
 * own, and only a component that can resolve the registry can fill it. So the header prints how
 * many there are and this block prints them. A theme that drew neither would silently be a theme
 * with no contract drift in it, which is the product's first pillar.
 *
 * THE POSITION IS NOT RENDERED AT ALL FOR A NODE WITH NO FACTS, which the reference decides before
 * this component is reached, per SPEC 6.3. There is no empty state here because there is no way to
 * arrive at one, and a placeholder written for it would be markup nothing can reach.
 */
function value(item: RuntimeValueModel, index: number): VNode {
  const text =
    item.href === ''
      ? h('span', { class: 'tt-cell-text' }, item.text)
      : h('a', { class: 'tt-cell-link', href: item.href }, item.text);

  return h('li', { class: 'tt-cell-value', key: index }, [
    item.status === ''
      ? null
      : h('span', { class: ['tt-status', `tt-status-${item.statusClass}`] }, item.status),
    text,
    item.note === '' ? null : h('span', { class: 'tt-cell-note' }, item.note),
    item.confidence === null
      ? null
      : h(ProvenanceTag, { confidence: item.confidence, collector: item.collector }),
  ]);
}

export default defineComponent({
  name: 'TelltaleRuntimePanel',

  props: {
    nodeId: { type: String, required: true },
    runtime: { type: Object as PropType<RuntimeModel>, required: true },
  },

  setup(props) {
    const drift = useSlot('DriftCard', DriftCard);

    return (): VNode =>
      h('section', { class: 'tt-runtime', 'data-tt-node': props.nodeId, 'aria-label': 'Runtime' }, [
        h('h2', { class: 'tt-strip-head' }, 'RUNTIME'),
        h(
          'ul',
          { class: 'tt-cells' },
          props.runtime.rows.map((row) =>
            h('li', { class: ['tt-cell', `tt-cell-${row.kind}`], key: row.kind }, [
              h('span', { class: 'tt-cell-label' }, row.label),
              h('ul', { class: 'tt-cell-values' }, row.values.map(value)),
            ]),
          ),
        ),
        props.runtime.drift.length === 0
          ? null
          : h('div', { class: 'tt-findings' }, [
              h('h2', { class: 'tt-strip-head' }, 'FINDINGS'),
              h(
                'ul',
                { class: 'tt-finding-list' },
                props.runtime.drift.map((issue, index) => h(drift.value, { issue, key: index })),
              ),
            ]),
      ]);
  },
});

/**
 * What the running application knows about one operation, per SPEC 6.
 *
 * This is the half of the double scale the specification cannot supply: guards, scopes, roles,
 * the rate limit, the three groups of error contracts, the streaming shape, and the line of
 * source the handler is written on. It renders the model and computes nothing, like every other
 * component here, and it does so harder than the others: the link is already expanded, the limit
 * is already in words, the groups are already three rows, and every branch that is not here is a
 * branch that is not in the bundle every reader downloads.
 *
 * IT RENDERS NOTHING AT ALL WHEN THERE ARE NO FACTS, per SPEC 6.3, and the decision is made in
 * the model rather than here: `NodeModel.runtime` is null and this is not mounted. A block of
 * labelled slots with dashes in them is what a reader arriving from plain `@nestjs/swagger`
 * would see on every page, and it reads as a broken product rather than as an unused feature.
 *
 * THE ROWS CARRY A KIND AND A THEME READS THAT RATHER THAN THE LABEL, per `RuntimeRowModel.kind`.
 * This is the block the removed `ErrorContract` slot would have split off, and the reason it was
 * removed is T023's measurement: one list of labelled rows rather than five shapes was worth
 * 1.4 KB of the first paint. What a theme needs from that slot it gets by overriding this one and
 * switching on `kind`, and the three error groups keep the distinction T021 made structural.
 */

import { useSlot } from '@openref/vue';
import { defineComponent, h, type PropType, type VNode } from 'vue';
import { DriftCard } from './DriftCard';
import { ProvenanceTag } from './ProvenanceTag';
import type { RuntimeModel, RuntimeValueModel } from '@openref/vue';
import type { Component } from 'vue';

/**
 * One value on a row: a status, the text or the link, an aside, and the provenance mark.
 *
 * @param value - The value
 * @param tag - The component in the `ProvenanceTag` slot
 * @returns The item
 */
function valueNode(value: RuntimeValueModel, tag: Component): VNode {
  return h('span', { class: 'oref-runtime-item' }, [
    value.status === '' ? null : h('span', { class: value.statusClass }, value.status),
    value.href === ''
      ? value.text
      : h('a', { class: 'oref-source-link', href: value.href, rel: 'noreferrer' }, value.text),
    value.note === '' ? null : h('span', { class: 'oref-runtime-note' }, value.note),
    value.confidence === null
      ? null
      : h(tag, { confidence: value.confidence, collector: value.collector }),
  ]);
}

/** Renders the runtime facts of one node. */
export const RuntimePanel = defineComponent({
  name: 'OrefRuntimePanel',

  props: {
    nodeId: { type: String, required: true },
    runtime: { type: Object as PropType<RuntimeModel>, required: true },
  },

  setup(props) {
    const provenance = useSlot('ProvenanceTag', ProvenanceTag);
    const drift = useSlot('DriftCard', DriftCard);

    return (): VNode => {
      const runtime = props.runtime;
      const rows: VNode[] = [];

      // NO KEYS ON ANY OF THESE LISTS, AND THAT IS A PROPERTY OF THE PAGE RATHER THAN A SAVING.
      // A key exists so a diff can match an old child to a new one. This model is a prop that
      // never changes for the life of the page: navigation is a real navigation, so a different
      // node is a different document and a different tree. Nothing here is ever diffed against a
      // previous version of itself, and the strings would be bytes in a chunk SPEC 20 measures.
      for (const row of runtime.rows) {
        rows.push(h('dt', { class: 'oref-runtime-label' }, row.label));
        rows.push(
          h(
            'dd',
            { class: 'oref-runtime-value' },
            row.values.map((value) => valueNode(value, provenance.value)),
          ),
        );
      }

      return h('section', { class: 'oref-section oref-section-runtime' }, [
        h('h2', { class: 'oref-section-title' }, 'Runtime'),
        h('dl', { class: 'oref-runtime' }, rows),
        // Always emitted, empty and all. The branch that would leave it out is four lines of
        // markup saved on a clean operation against a test in the bundle every reader downloads,
        // and SPEC 20's cap on that bundle is the tighter of the two.
        h(
          'ul',
          { class: 'oref-drift-list' },
          runtime.drift.map((issue) => h(drift.value, { issue })),
        ),
      ]);
    };
  },
});

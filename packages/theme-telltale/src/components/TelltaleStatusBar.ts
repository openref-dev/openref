import { defineComponent, h, type PropType, type VNode } from 'vue';
import TelltaleBudgetMeter from './TelltaleBudgetMeter';
import type { PageKind } from '@openref/vue';

/**
 * The bench line: a fixed strip at the bottom saying what is open and what it weighs.
 *
 * A theme component and not a slot, per `ai-docs/design/CONTRACT.md`, carrying the theme's name in
 * code so it cannot be mistaken for one.
 *
 * WHAT IT SAYS IS WHAT THE SHELL KNOWS, WHICH IS LESS THAN IT LOOKS. The shell is handed the page
 * kind and the two active ids, and nothing about what is on the page: the content arrives as
 * opaque children. So this bar names the address rather than describing the contents, and the
 * design's three states, connected, stale and disconnected, are not drawn at all, because nothing
 * a shell is handed says whether a document is stale.
 */
export default defineComponent({
  name: 'TelltaleStatusBar',

  props: {
    page: { type: String as PropType<PageKind>, required: true },
    nodeId: { type: String as PropType<string | null>, default: null },
    schemaId: { type: String as PropType<string | null>, default: null },
  },

  setup(props) {
    return (): VNode =>
      h('footer', { class: 'tt-status' }, [
        h('span', { class: 'tt-status-kind' }, props.page.toUpperCase()),
        h('code', { class: 'tt-status-id' }, props.nodeId ?? props.schemaId ?? '/'),
        h(TelltaleBudgetMeter),
      ]);
  },
});

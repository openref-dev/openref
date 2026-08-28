import { h, type VNode } from 'vue';
import type { IRConfidence } from '@openref/vue';

/**
 * The mark that says where one runtime fact came from, per SPEC 6.1.
 *
 * Three letters and an edge style, and no colour is load bearing: the code survives a monochrome
 * print and is read aloud through the `abbr` title, and solid, dashed and dotted tell the three
 * levels apart at a glance. This theme's whole thesis is that a reader can see what is observed
 * and what is asserted without reading anything, so this is the one mark it will not compromise.
 *
 * THE CODE IS IN THE MARKUP AND NOT IN `content: var(--oref-prov-*-code)`. A code drawn by the
 * stylesheet vanishes when the stylesheet does not arrive, cannot be selected, and reaches a
 * screen reader only as generated content. The token exists for a theme that wants other letters
 * without writing a component; this theme writes the component.
 */
const CODES: Readonly<Record<IRConfidence, string>> = {
  declared: 'DCL',
  derived: 'DRV',
  inferred: 'INF',
};

export default function ProvenanceTag(props: {
  readonly confidence: IRConfidence;
  readonly collector: string;
}): VNode {
  return h(
    'abbr',
    {
      class: ['tt-prov', `tt-prov-${props.confidence}`],
      title: `${props.confidence}, ${props.collector}`,
    },
    CODES[props.confidence],
  );
}

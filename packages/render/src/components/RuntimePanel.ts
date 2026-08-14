/**
 * What the running application knows about one node, drawn against what the specification
 * declares: the parity scale of SPEC 6.3 and `TX-GUTTER`.
 *
 * THE SCALE IS THE ONLY RENDERING, AND THE LABELLED ROWS ARE GONE FROM THIS COMPONENT ON
 * PURPOSE. They were kept as a branch for the channel case, and no channel can reach it: every
 * collector is HTTP, so a channel cannot carry facts before M5 builds the event collectors, and
 * M5 owes channels a design of their own rather than eleven wrong labels. The branch was paid
 * for by every reader in the first paint bundle, against a `client-js-raw` cap with 907 bytes
 * of headroom, for a node kind that cannot occur. `RuntimeModel.rows` still travels, because
 * telltale's override reads it; what died is the default component's second way to draw.
 *
 * THE VERDICT GLYPHS RENDER FROM THE MONO STACK'S SYSTEM FALLBACK, per the maintainer's
 * 2026-08-14 decision: the subsets do not grow for eight characters, the stack's tail is a
 * deliberate fallback rather than an accident, and the browser suite asserts each glyph draws
 * at a non-zero width. The glyph spans are `aria-hidden` where a word or an `aria-label`
 * carries the meaning, so the marks are presentation and the words are the statement.
 *
 * IT RENDERS NOTHING AT ALL WHEN THERE ARE NO FACTS, per SPEC 6.3, and the decision is made in
 * the model rather than here: `NodeModel.runtime` is null and this is not mounted.
 *
 * FINDINGS JOINED TO A ROW RENDER AS ITS FIXBAR AND NOWHERE ELSE. The two unjoined lists,
 * findings below and runtime rows above, are the structural divergence session 54 recorded, and
 * the join is the point of the scale. What keeps the list under the scale is the remainder:
 * rules mapped to no row, `orphan-operation` and the `DX` group, which would otherwise vanish.
 */

import { useSlot } from '@openref/vue';
import { defineComponent, h, type PropType, type VNode } from 'vue';
import { DriftCard } from './DriftCard';
import { ProvenanceTag } from './ProvenanceTag';
import { SEVERITIES, severityChip } from './severity';
import type { ParityRowModel, RuntimeModel, RuntimeValueModel } from '@openref/vue';
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

/** Glyph, accessible name and box variant per verdict; the drift variant is the severity's. */
const VERDICTS = {
  match: ['=', 'match', ''],
  drift: ['≠', 'drift', ''],
  unknown: ['?', 'comparison not run', 'oref-verdict-unknown'],
} as const;

/**
 * One row of the scale: the spec cell, the gutter verdict, the runtime cell, and the FixBar.
 *
 * @param row - The row
 * @param tag - The component in the `ProvenanceTag` slot
 * @returns The row
 */
function parityRow(row: ParityRowModel, tag: Component): VNode {
  const [glyph, name, variant] = VERDICTS[row.verdict];
  const severity = SEVERITIES[row.severityClass];
  const suffix = severity === undefined ? '' : severity[2];

  // THE EMPTY SIDE IS DRAWN AND SAYS WHY, per SPEC 6.3: the hatch and the reason phrase are the
  // design's answer for a side that does not exist yet, and the phrase states a fact about the
  // instrument, never about the route.
  const runtime =
    row.runtime.length === 0
      ? h('div', { class: 'oref-parity-cell oref-parity-cell-runtime oref-hatch' }, [
          h('div', { class: 'oref-parity-label' }, 'application'),
          h('div', { class: 'oref-parity-empty' }, row.reason),
        ])
      : h(
          'div',
          { class: 'oref-parity-cell oref-parity-cell-runtime' },
          row.runtime.map((value) => valueNode(value, tag)),
        );

  const fix = row.fix;

  return h(
    'div',
    {
      class: ['oref-parity', row.verdict === 'drift' ? 'oref-parity-drift' : '', row.severityClass],
      'data-oref-parity': row.kind,
    },
    [
      h('div', { class: 'oref-parity-grid' }, [
        h('div', { class: 'oref-parity-cell oref-parity-cell-spec' }, [
          h('div', { class: 'oref-parity-label' }, row.label),
          h('div', { class: 'oref-parity-value' }, row.spec.value),
          row.spec.note === '' ? null : h('div', { class: 'oref-parity-sub' }, row.spec.note),
        ]),
        h('div', { class: 'oref-parity-gutter' }, [
          h(
            'span',
            {
              class: ['oref-verdict', variant, suffix === '' ? '' : `oref-verdict-${suffix}`],
              'aria-label': name,
            },
            glyph,
          ),
        ]),
        runtime,
      ]),
      fix === null || severity === undefined
        ? null
        : h('div', { class: ['oref-fixbar', `oref-fixbar-${suffix}`] }, [
            severityChip(row.severityClass),
            h('span', { class: 'oref-fixbar-text' }, fix.text),
            h('a', { class: 'oref-fixbar-rule', href: fix.href }, fix.code),
          ]),
    ],
  );
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

      // A finding a row consumed is its FixBar; what stays a list is the remainder. The set is
      // presentation grouping over two model lists, not a decision: which rule joins which row
      // was decided in the model, and this only avoids saying one finding twice.
      const consumed = new Set(runtime.parity.map((row) => row.fix?.code ?? ''));
      const remainder = runtime.drift.filter((issue) => !consumed.has(issue.code));

      // NO KEYS ON ANY OF THESE LISTS, AND THAT IS A PROPERTY OF THE PAGE RATHER THAN A SAVING.
      // A key exists so a diff can match an old child to a new one. This model is a prop that
      // never changes for the life of the page: navigation is a real navigation, so a different
      // node is a different document and a different tree. Nothing here is ever diffed against a
      // previous version of itself, and the strings would be bytes in a chunk SPEC 20 measures.
      return h('section', { class: 'oref-section oref-section-runtime' }, [
        h('div', { class: 'oref-parity-head' }, [
          h('div', { class: 'oref-parity-headcell oref-parity-headcell-spec' }, [
            'Specification declares',
          ]),
          h('div', { class: 'oref-parity-headtick' }),
          h('div', { class: 'oref-parity-headcell oref-parity-headcell-runtime' }, [
            'Application does',
          ]),
        ]),
        h(
          'div',
          {
            class: 'oref-parity-scale',
            role: 'group',
            'aria-label': 'Specification against runtime',
          },
          runtime.parity.map((row) => parityRow(row, provenance.value)),
        ),
        // Always emitted, empty and all. The branch that would leave it out is four lines of
        // markup saved on a clean operation against a test in the bundle every reader downloads,
        // and SPEC 20's cap on that bundle is the tighter of the two.
        h(
          'ul',
          { class: 'oref-drift-list' },
          remainder.map((issue) => h(drift.value, { issue })),
        ),
      ]);
    };
  },
});

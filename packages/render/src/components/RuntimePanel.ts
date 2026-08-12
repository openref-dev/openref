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
 * THE THREE CONFIDENCE LEVELS ARE READABLE WITH NO COLOUR AT ALL, per SPEC 6.1, and by two means
 * rather than one: the three letter code, which survives a monochrome print and is read aloud
 * through the `abbr` title, and the style of the mark's left edge, solid, dashed and dotted,
 * which tells them apart at a glance without anything being read.
 *
 * THE CODE IS IN THE MARKUP AND NOT IN `content: var(--oref-prov-*-code)`. The design's own
 * component inventory settles this for the glyphs beside it: they are content and live in the
 * component layer. A code drawn by the stylesheet vanishes when the stylesheet does not arrive,
 * cannot be selected, and reaches a screen reader only as generated content. A theme that wants
 * other letters overrides the `ProvenanceTag` slot, which is what the slot registry is for.
 */

import { defineComponent, h, type PropType, type VNode } from 'vue';
import type { DriftModel, RuntimeModel, RuntimeValueModel } from '../page/domain/page-model';

/**
 * One value on a row: a status, the text or the link, an aside, and the provenance mark.
 *
 * `abbr` with a `title` is the element the language already has for a short code standing for a
 * longer thing, so the expansion is a tooltip for a pointer and an accessible name for a reader
 * who is not using one. The collector's name travels in the same string, because "where did this
 * come from" and "who says so" are one question a reader asks once.
 *
 * @param value - The value
 * @returns The item
 */
function valueNode(value: RuntimeValueModel): VNode {
  return h('span', { class: 'oref-runtime-item' }, [
    value.status === '' ? null : h('span', { class: value.statusClass }, value.status),
    value.href === ''
      ? value.text
      : h('a', { class: 'oref-source-link', href: value.href, rel: 'noreferrer' }, value.text),
    value.note === '' ? null : h('span', { class: 'oref-runtime-note' }, value.note),
    value.code === ''
      ? null
      : h('abbr', { class: value.markClass, title: value.markTitle }, value.code),
  ]);
}

/**
 * One finding.
 *
 * THE FIX IS A LINE OF ITS OWN BENEATH THE DISCREPANCY, which is the design's instruction and
 * also SPEC 7.2's contract: a finding without its edit tells a reader something is wrong and
 * leaves them to work out what to do about it.
 *
 * @param issue - The finding
 * @returns The row
 */
export function driftRow(issue: DriftModel): VNode {
  return h('li', { class: `oref-drift ${issue.severityClass}` }, [
    h('span', { class: 'oref-drift-rule' }, issue.rule),
    issue.href === ''
      ? null
      : h('a', { class: 'oref-drift-subject', href: issue.href }, issue.subject),
    h('span', { class: 'oref-drift-message' }, issue.message),
    ...issue.sides.map((side) => h('span', { class: 'oref-drift-side' }, side)),
    h('p', { class: 'oref-drift-fix' }, issue.suggestion),
  ]);
}

/** Renders the runtime facts of one node. */
export const RuntimePanel = defineComponent({
  name: 'OrefRuntimePanel',

  props: {
    runtime: { type: Object as PropType<RuntimeModel>, required: true },
  },

  setup(props) {
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
        rows.push(h('dd', { class: 'oref-runtime-value' }, row.values.map(valueNode)));
      }

      return h('section', { class: 'oref-section oref-section-runtime' }, [
        h('h2', { class: 'oref-section-title' }, 'Runtime'),
        h('dl', { class: 'oref-runtime' }, rows),
        // Always emitted, empty and all. The branch that would leave it out is four lines of
        // markup saved on a clean operation against a test in the bundle every reader downloads,
        // and SPEC 20's cap on that bundle is the tighter of the two.
        h('ul', { class: 'oref-drift-list' }, runtime.drift.map(driftRow)),
      ]);
    };
  },
});

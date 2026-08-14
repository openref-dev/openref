/**
 * One finding: what the runtime says, what the specification says, and the fix.
 *
 * THE FIX IS A LINE OF ITS OWN BENEATH THE DISCREPANCY, which is the design's instruction and
 * also SPEC 7.2's contract: a finding without its edit tells a reader something is wrong and
 * leaves them to work out what to do about it.
 *
 * ONE COMPONENT, TWO CALLERS, per SPEC 7.3: the runtime block of a node page draws the findings
 * about that node, and the Health panel draws every finding grouped by rule. A finding on a page
 * that is not about its subject carries the link and the subject's name; on the page that is
 * already about it, both are empty.
 */

import { h, type VNode } from 'vue';
import type { DriftModel } from '@openref/vue';

/**
 * Renders one finding as a row.
 *
 * @param props - The finding
 * @returns The row
 */
export function DriftCard(props: { readonly issue: DriftModel }): VNode {
  const issue = props.issue;

  // THE CARD PRINTS NO DISPLAY CODE, AND THE ABSENCE WAS MEASURED RATHER THAN PREFERRED. Every
  // place a card is drawn already stands under the code: the Health panel groups findings by
  // rule and its summary line carries the code once, and an operation page's row findings carry
  // it in the FixBar. A copy per card is the same five characters up to 578 times on the T025
  // volume document, 22 KB of markup restating the group heading, and it pushed that page past
  // the bound the maintainer set.
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

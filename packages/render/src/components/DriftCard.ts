/**
 * One finding: what the runtime says, what the specification says, and the fix.
 *
 * THE FIX IS A LINE OF ITS OWN BENEATH THE DISCREPANCY, which is the design's instruction and
 * also SPEC 7.2's contract: a finding without its edit tells a reader something is wrong and
 * leaves them to work out what to do about it.
 *
 * ONE COMPONENT, TWO CALLERS, per SPEC 7.3: the runtime block of a node page draws the findings
 * about that node, and the Health panel draws every cause grouped by rule. A finding on a page
 * that is not about its subject carries the link and the subject's name; on the page that is
 * already about it, both are empty.
 *
 * THE SUBJECT IS DRAWN WHETHER OR NOT IT IS A LINK, SINCE 2026-09-05 AND SPEC 7.2. It was drawn
 * only when there was an href, so a finding whose subject is a handler, a gateway or a broker
 * printed no subject at all, and `discovery-incomplete` was gluing its subject onto the front of
 * its own message because that was the only way the address reached this page.
 *
 * THE REASONING IS BELOW THE FOLD AND THE FIRST THING IS SHORT. A `details` element opens with no
 * script and no inline style, which is why the panel already uses one per rule; it is the same
 * mechanism one level down.
 */

import { h, type VNode } from 'vue';
import type { DriftModel } from '@openref/vue';

/** The one subject of an ungrouped finding, drawn with its link when it has one. */
function subjectOf(issue: DriftModel): VNode | null {
  if (issue.subject === '') return null;
  if (issue.href === '') return h('span', { class: 'oref-drift-subject' }, issue.subject);

  return h('a', { class: 'oref-drift-subject', href: issue.href }, issue.subject);
}

/**
 * Renders one finding as a row.
 *
 * @param props - The finding
 * @returns The row
 */
export function DriftCard(props: { readonly issue: DriftModel }): VNode {
  const issue = props.issue;
  const grouped = issue.subjects.length > 1;

  // THE CARD PRINTS NO DISPLAY CODE AND NO SEVERITY CHIP, AND BOTH ABSENCES WERE MEASURED
  // RATHER THAN PREFERRED. Every place a card is drawn already stands under both: the Health
  // panel groups findings by rule, its summary line carries the code and, since
  // `TX-PARITY-UI`, the severity chip once, because a group's findings share one severity by
  // construction; an operation page's row findings carry both in the FixBar. A copy per card
  // is the same handful of characters up to 578 times on the T025 volume document: the code
  // was 22 KB of repetition, and the chip measured 40 KB more, each restating what the group
  // heading states once.
  return h('li', { class: `oref-drift ${issue.severityClass}` }, [
    h('span', { class: 'oref-drift-rule' }, issue.rule),
    grouped ? null : subjectOf(issue),
    h('span', { class: 'oref-drift-message' }, issue.message),
    ...issue.sides.map((side) => h('span', { class: 'oref-drift-side' }, side)),
    // EMPTY MEANS THE MESSAGE ALREADY SAID IT, per SPEC 7.2 and `causeModel`, not that the finding
    // has no edit. A rule that writes a suggestion of its own always has one to print.
    issue.suggestion === '' ? null : h('p', { class: 'oref-drift-fix' }, issue.suggestion),
    // ONE CAUSE, EVERY SUBJECT IT WAS FOUND ON, per SPEC 7.2. The count is on the summary so a
    // closed disclosure still says how wide the cause is, which is the figure a reader acts on;
    // the list itself is what they open when they want to know which routes.
    grouped
      ? h('details', { class: 'oref-drift-subjects' }, [
          h('summary', null, `${issue.count} subjects`),
          h(
            'ul',
            null,
            issue.subjects.map((subject) =>
              h(
                'li',
                null,
                subject.href === ''
                  ? h('span', { class: 'oref-drift-subject' }, subject.label)
                  : h('a', { class: 'oref-drift-subject', href: subject.href }, subject.label),
              ),
            ),
          ),
        ])
      : null,
    issue.detail === ''
      ? null
      : h('details', { class: 'oref-drift-why' }, [
          h('summary', null, 'Why this is reported'),
          h('p', null, issue.detail),
        ]),
  ]);
}

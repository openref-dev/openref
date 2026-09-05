import { h, type VNode } from 'vue';
import type { DriftModel } from '@openref/vue';

/**
 * One finding, as a row rather than as a card, which is what this theme calls it in its own notes.
 *
 * SEVERITY IS READABLE WITHOUT COLOUR, by the border style of the left edge, which is what
 * `--oref-drift-*-border-style` is for. `severityClass` arrives already computed, so the mapping
 * from a rule to a severity is made once, in the reference, rather than a second time here where
 * it could come to disagree.
 *
 * `href` AND `subject` ARE EMPTY ON THE PAGE THE FINDING IS ABOUT, which is what tells this row
 * whether to say what it is about. A row that always printed the subject would print the name of
 * the operation the reader is already looking at.
 *
 * A GROUPED FINDING NAMES EVERY SUBJECT AND NOT ONLY THE FIRST, per SPEC 7.2. `subject` is the
 * first of `subjects` for a theme that reads only the one, and this theme reads both, because the
 * count is what a reader acts on and the list is what they check it against.
 */
export default function DriftCard(props: { readonly issue: DriftModel }): VNode {
  const issue = props.issue;
  const grouped = issue.subjects.length > 1;

  return h('li', { class: ['tt-drift', `tt-drift-${issue.severityClass}`] }, [
    h('div', { class: 'tt-drift-line' }, [
      h('span', { class: 'tt-drift-rule' }, issue.rule),
      grouped
        ? h('span', { class: 'tt-drift-subject' }, `${issue.count} subjects`)
        : issue.subject === ''
          ? null
          : issue.href === ''
            ? h('span', { class: 'tt-drift-subject' }, issue.subject)
            : h('a', { class: 'tt-drift-subject', href: issue.href }, issue.subject),
    ]),
    h('p', { class: 'tt-drift-message' }, issue.message),
    issue.sides.length === 0
      ? null
      : h(
          'ul',
          { class: 'tt-drift-sides' },
          issue.sides.map((side, index) => h('li', { class: 'tt-drift-side', key: index }, side)),
        ),
    issue.suggestion === '' ? null : h('p', { class: 'tt-drift-fix' }, issue.suggestion),
    grouped
      ? h(
          'ul',
          { class: 'tt-drift-subjects' },
          issue.subjects.map((subject, index) =>
            h(
              'li',
              { key: index },
              subject.href === ''
                ? h('span', { class: 'tt-drift-subject' }, subject.label)
                : h('a', { class: 'tt-drift-subject', href: subject.href }, subject.label),
            ),
          ),
        )
      : null,
    issue.detail === ''
      ? null
      : h('details', { class: 'tt-drift-why' }, [
          h('summary', null, 'Why this is reported'),
          h('p', null, issue.detail),
        ]),
  ]);
}

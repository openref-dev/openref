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
 */
export default function DriftCard(props: { readonly issue: DriftModel }): VNode {
  const issue = props.issue;

  return h('li', { class: ['tt-drift', `tt-drift-${issue.severityClass}`] }, [
    h('div', { class: 'tt-drift-line' }, [
      h('span', { class: 'tt-drift-rule' }, issue.rule),
      issue.subject === ''
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
  ]);
}

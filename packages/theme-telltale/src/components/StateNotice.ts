import { h, type VNode } from 'vue';
import type { StateNoticeKind } from '@openref/vue';

/**
 * Empty and degraded states, which are content rather than an absence of it.
 *
 * THE SENTENCE ARRIVES AS A PROP AND THE KIND IS WHAT THIS THEME DRAWS FROM. `message` is what the
 * position that raised the notice wanted said; `kind` is what this theme marks it with, and it is
 * the field a stylesheet can key on. A theme that matched on the sentence would be matching on
 * English, which is the same defect as telling a runtime row apart by its label.
 *
 * Twelve kinds, and the list is closed. The record is total over `StateNoticeKind` rather than
 * defaulted, so a kind added to the contract fails to compile here instead of rendering a
 * mark this theme made up. `health-missing` arrived exactly that way, with `TX-FRAME`, and
 * `search-unavailable` with `T042`. `runtime-missing` and `drift-missing` arrived the same way
 * and share `HLTH` and `DRFT` with nothing: they are the two halves of that sentence this
 * product had been leaving unsaid, an operation nobody instrumented and a document with no
 * report, each of which used to be drawn as agreement.
 *
 * THE SENTENCE IS NEVER THIS THEME'S TO SUPPLY, which is why a theme that had not been updated
 * would still have shown the reader the new state's words: `message` arrives as a prop and only
 * the mark is looked up here.
 */
const MARKS: Readonly<Record<StateNoticeKind, string>> = {
  'nav-unavailable': 'NAV',
  'search-empty': 'FIND',
  'search-no-results': 'FIND',
  'search-partial': 'FIND',
  'search-unavailable': 'FIND',
  'no-server': 'SRV',
  'no-body-fields': 'BODY',
  'schema-missing': 'SCH',
  'no-schema': 'SCH',
  'health-missing': 'HLTH',
  'runtime-missing': 'RUN',
  'drift-missing': 'DRFT',
};

export default function StateNotice(props: {
  readonly kind: StateNoticeKind;
  readonly message: string;
}): VNode {
  return h('p', { class: ['tt-notice', `tt-notice-${props.kind}`], role: 'status' }, [
    h('span', { class: 'tt-notice-mark' }, MARKS[props.kind]),
    h('span', { class: 'tt-notice-text' }, props.message),
  ]);
}

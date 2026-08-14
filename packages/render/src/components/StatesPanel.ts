/**
 * The states showcase: every notice the product can say, drawn side by side.
 *
 * A THEME AUTHOR'S PAGE, NOT A READER'S, per the 2026-08-14 decision: it exists at its address,
 * enters no tab bar and no navigation, and its job is to put each `StateNotice` kind on one
 * screen so a theme's styling of the degraded states can be read without producing each
 * degradation by hand. The messages are specimens and say so; the full states material of the
 * layout, the stale cache card and the recovered handling chain, needs models that do not
 * exist before their tasks, and this page draws what exists rather than promising the rest.
 */

import { useSlot } from '@openref/vue';
import { defineComponent, h, type VNode } from 'vue';
import { StateNotice } from './StateNotice';
import type { StateNoticeKind } from '@openref/vue';

/** One specimen per kind, in the order the union declares them. */
const SPECIMENS: readonly (readonly [StateNoticeKind, string])[] = [
  [
    'nav-unavailable',
    'The rest of the navigation could not be loaded. Specimen of the sentence a failed fetch leaves in the rail.',
  ],
  ['search-empty', 'Type to search this reference. Specimen of the palette before a query.'],
  ['search-no-results', 'No matches. Specimen of a query the index answers with nothing.'],
  [
    'search-partial',
    'Searching what this page carries. Specimen of the palette before the whole index arrives.',
  ],
  [
    'no-server',
    'This document declares no server to send to. Specimen of a console with nowhere to go.',
  ],
  ['no-body-fields', 'This media type declares no fields. Specimen of an empty body editor.'],
  ['schema-missing', 'This document declares no such schema. Specimen of a stale link.'],
  ['no-schema', 'No schema is declared here. Specimen of a position with nothing to expand.'],
  [
    'health-missing',
    'No health report exists for this document. Specimen of a page nothing measured.',
  ],
];

/** The kinds whose default element is a list item, which is only valid inside a list. */
const LIST_KINDS: ReadonlySet<StateNoticeKind> = new Set([
  'search-empty',
  'search-no-results',
  'search-partial',
]);

/** Renders the catalogue. */
export const StatesPanel = defineComponent({
  name: 'OrefStatesPanel',

  setup() {
    const notice = useSlot('StateNotice', StateNotice);

    return (): VNode =>
      h('article', { class: 'oref-states-page' }, [
        h('header', { class: 'oref-operation-header' }, [
          h('h1', { class: 'oref-title' }, 'Empty and degraded states'),
        ]),
        h(
          'p',
          { class: 'oref-states-lead' },
          'Every notice the product can say, one specimen each, for styling a theme against. ' +
            'Readers reach these states in place; this page exists so a theme author does not have to.',
        ),
        ...SPECIMENS.map(([kind, message]) => {
          const drawn = h(notice.value, { kind, message });

          return h('section', { class: 'oref-states-item', key: kind }, [
            h('h2', { class: 'oref-section-title' }, kind),
            // The three palette notices are list items by contract, and a list item outside a
            // list is invalid markup, so the catalogue supplies the list they assume.
            LIST_KINDS.has(kind) ? h('ul', { class: 'oref-states-list' }, [drawn]) : drawn,
          ]);
        }),
      ]);
  },
});

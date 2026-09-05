/**
 * Empty and degraded states, which are content rather than an absence of it.
 *
 * ONE COMPONENT FOR EIGHT SENTENCES THAT WERE LITERALS IN FOUR FILES. A reader who searches and
 * finds nothing, a sidebar whose fetch failed, a document with no server, a schema page for an id
 * that is gone: each of those is a thing the product says, and each was written where it happened,
 * so a theme could not replace any of them and no two of them had to agree about anything.
 *
 * THE WORDS STAY AT THE CALL SITE AND THE MARKUP IS HERE. A component that held the sentences
 * would decide what a palette says about a partial index, which is the palette's business and
 * changes with what the palette knows. What is the same everywhere is the shape: the element, the
 * class the theme styles, and whether a reader who is not looking at it is told.
 *
 * THE ELEMENT DIFFERS BY KIND AND THAT IS NOT A STYLE DECISION. A notice inside the results
 * listbox has to be a list item or the list is invalid; the navigation's failure is announced,
 * because it happens after the page was read and a reader who does not look at the sidebar again
 * would never learn that it is short.
 */

import { h, type VNode } from 'vue';
import type { StateNoticeKind } from '@openref/vue';

/** Element, class and role per kind, in the vocabulary the default theme already declares. */
const SHAPES: Readonly<Record<StateNoticeKind, readonly [string, string, string | null]>> = {
  'nav-unavailable': ['p', 'oref-nav-error', 'status'],
  'search-empty': ['li', 'oref-palette-empty', null],
  'search-no-results': ['li', 'oref-palette-empty', null],
  'search-partial': ['li', 'oref-palette-empty', null],
  // A LIST ITEM AND NOT AN ANNOUNCEMENT, unlike `nav-unavailable`, and the difference is where the
  // reader is looking. The navigation fails behind a reader who has moved on; this one is drawn
  // inside the results list a reader is watching at the moment they typed, and a `role` inside a
  // listbox would replace the option role the list is built from.
  'search-unavailable': ['li', 'oref-palette-empty', null],
  'no-server': ['p', 'oref-tryit-notice', null],
  'no-body-fields': ['p', 'oref-tryit-notice', null],
  'schema-missing': ['p', 'oref-schema-empty', null],
  'no-schema': ['p', 'oref-schema-empty', null],
  'health-missing': ['p', 'oref-health-empty', null],
  // A PARAGRAPH IN THE SECTION THE SCALE WOULD HAVE FILLED, so a reader meets it where the
  // measurement would have been rather than in a corner of the page.
  'runtime-missing': ['p', 'oref-parity-empty', null],
  // A SPAN, BECAUSE THE RAIL'S STATS ROW IS A ROW OF SPANS. The kinds above choose an element
  // for the markup they sit in, and a paragraph in a flex row of counts is the same error a
  // list item outside a list is.
  'drift-missing': ['span', 'oref-nav-stats-missing', null],
};

/**
 * Renders one notice.
 *
 * @param props - Which state this is, and what to say about it
 * @returns The notice
 */
export function StateNotice(props: {
  readonly kind: StateNoticeKind;
  readonly message: string;
}): VNode {
  const [tag, className, role] = SHAPES[props.kind];

  return h(tag, { class: className, ...(role === null ? {} : { role }) }, props.message);
}

/**
 * Values that exist only because a slot carries them.
 *
 * Each of these is part of the frozen slot contract, so it lives beside the contract rather
 * than in whichever feature produces it.
 */

/**
 * Why a region is showing a notice instead of content.
 *
 * RESTATED FROM THE NOTICES THAT EXIST, in `TX-SLOTWIRE`, rather than from the six words the
 * design guessed at. Each of these is a sentence a reader can be shown today, and each is drawn
 * by one position of the shipped renderer:
 *
 * - `nav-unavailable`: the rest of the navigation could not be fetched, so the sidebar lists
 *   what the page arrived with
 * - `search-empty`, `search-no-results`, `search-partial`, `search-unavailable`: the four states of
 *   the command palette. The third is a page still searching the slice it shipped with, and the
 *   fourth is a page whose index could not be loaded at all, which is a different thing from
 *   finding nothing and said so since T042
 * - `no-server`: the document declares no server, so there is nowhere to send a request
 * - `no-body-fields`: a media type is declared with no properties, so the console has no fields
 *   to offer for it
 * - `schema-missing`: a schema page was opened for an id this document does not declare
 * - `no-schema`: a position declares no schema, so the viewer has no tree to draw
 * - `health-missing`, `runtime-missing`, `drift-missing`: the three halves of one statement, that
 *   nothing measured this. The document has no health report, the operation carries no runtime
 *   facts, and the rail has no finding count to print. Each is drawn where the measurement would
 *   have been, because an absent measurement and a measurement that found nothing look the same
 *   and mean opposite things
 *
 * WHAT IS NOT HERE IS THE SENTENCE BESIDE SEND. It is `SendButton.notice`, because the button
 * points at it with `aria-describedby` and a control announced as unavailable with the reason in
 * an unassociated sibling is announced without the reason at all, per SPEC 11.
 */
export type StateNoticeKind =
  | 'nav-unavailable'
  | 'search-empty'
  | 'search-no-results'
  | 'search-partial'
  // The palette whose index could not be fetched or read, since T042 and per SPEC 11. It was
  // `search-no-results` until then, which was true of the search that ran and silent about what
  // it ran over: a degraded state presented as an ordinary empty one. A theme that does not know
  // this kind still prints `message`, which is where the sentence lives, so nothing breaks at
  // runtime; the addition is nonetheless a break of the theme contract, because a total
  // `Record<StateNoticeKind, ...>` is a sanctioned spelling and stops compiling when this union
  // grows. See `ai-docs/design/CONTRACT.md` for the recording and the one line migration.
  | 'search-unavailable'
  | 'no-server'
  | 'no-body-fields'
  | 'schema-missing'
  | 'no-schema'
  // The health page for a document nothing measured, since `TX-FRAME`: the panel does not
  // exist there, per SPEC 7.3, and the page saying why is content rather than an absence.
  | 'health-missing'
  // THE TWO SIBLINGS `health-missing` WENT WITHOUT FOR THREE MILESTONES, and the gap they close
  // is the product's own thesis. Health said "nothing has measured it, which is a different
  // statement from a score of zero" while the other two halves of the same argument said
  // nothing at all: an operation with no runtime facts drew no parity scale, and a document
  // with no report drew no drift figure, so a reference nobody instrumented was pixel identical
  // to one that was instrumented and found in perfect agreement. That is the claim this product
  // exists to make, made silently in the wrong direction.
  //
  // `runtime-missing` is the operation page whose node carries no facts, per SPEC 6.3, drawn in
  // the position the parity scale would have taken. `drift-missing` is the rail's stats row on a
  // document with no health report, per SPEC 7.3, where the finding count would be: null and
  // zero are different statements, and until this only one of them was ever drawn.
  | 'runtime-missing'
  | 'drift-missing';

/**
 * What a bounded stream window has seen, per SPEC 14.6.
 *
 * `dropped` is what scrolled out of the window, which is named rather than silently absent: a
 * list that simply started later reads as a stream that started later.
 */
export interface StreamCounts {
  readonly received: number;
  readonly invalid: number;
  readonly dropped: number;
}

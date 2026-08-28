/**
 * The four sentences of the search palette, in one place, per SPEC 11 and `TX-PARITY-UI`.
 *
 * THE PALETTE READS THIS AND THE STATES CATALOGUE DERIVES ITS SPECIMENS FROM IT, because the
 * two drifted apart silently, `Type to search` against `Type to search this reference.`, and
 * the product disagreeing with its own sample catalogue is exactly what the catalogue was
 * built to prevent. One constant makes the drift structurally impossible, and the unit check
 * over both rendered surfaces is what catches the day someone inlines a string again.
 *
 * THE FOURTH ARRIVED AT T042 AND IS A DECISION RATHER THAN A SENTENCE, recorded in SPEC 11. A
 * failed index fetch was shown as `search-no-results`, which was true of the search that ran and
 * silent about what it ran over, so a reader learned that this reference contains nothing matching
 * their query when what had happened is that the index never arrived.
 */

/** What the palette says in each of its four empty states. */
export const PALETTE_NOTICES = {
  'search-empty': 'Type to search this reference.',
  'search-no-results': 'No matches.',
  'search-partial':
    'Nothing matches what this page arrived with. The rest of the index is still loading.',
  'search-unavailable':
    'The search index could not be loaded. What was searched is the navigation this page arrived with.',
} as const;

/** The palette's four kinds, in the order the catalogue lists them. */
export type PaletteNoticeKind = keyof typeof PALETTE_NOTICES;

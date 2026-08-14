/**
 * The three sentences of the search palette, in one place, per SPEC 11 and `TX-PARITY-UI`.
 *
 * THE PALETTE READS THIS AND THE STATES CATALOGUE DERIVES ITS SPECIMENS FROM IT, because the
 * two drifted apart silently, `Type to search` against `Type to search this reference.`, and
 * the product disagreeing with its own sample catalogue is exactly what the catalogue was
 * built to prevent. One constant makes the drift structurally impossible, and the unit check
 * over both rendered surfaces is what catches the day someone inlines a string again.
 */

/** What the palette says in each of its three empty states. */
export const PALETTE_NOTICES = {
  'search-empty': 'Type to search this reference.',
  'search-no-results': 'No matches.',
  'search-partial':
    'Nothing matches what this page arrived with. The rest of the index is still loading.',
} as const;

/** The palette's three kinds, in the order the catalogue lists them. */
export type PaletteNoticeKind = keyof typeof PALETTE_NOTICES;

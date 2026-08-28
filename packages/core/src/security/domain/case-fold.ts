/**
 * The one fold that decides whether two names are one file.
 *
 * ONE FUNCTION FOR EVERY CALLER, per SPEC 16.1 as amended by `T043`. Two guards asked this
 * question in the same round, the page plan of `@openref/static` and the asset catalog of
 * `@openref/render`, and each answered it with its own spelling of `toLowerCase`. They were wrong
 * in the same way, which is what two copies of a rule always come to; a shared function is the
 * only form in which they cannot drift apart again.
 *
 * CASE CONVERSION IS NOT CASE FOLDING, and the difference is not academic. Both of the earlier
 * spellings were driven to disk. `toLowerCase` left `ſample` and `sample` apart, which APFS puts
 * together, and a page was lost. Folding through the upper case fixed that pair and broke two
 * others: the upper case of `ẞ` is `ẞ`, so `ẞ` and `ss` stayed apart and a page was lost again,
 * while the upper case of `ı` is `I`, so `ı` and `i` were refused although the volume keeps them
 * apart. Unicode defines the operation these were approximating, and it is full case folding.
 */

/**
 * The full case foldings that differ from the lower case of the same character.
 *
 * THE REST OF THE FOLD IS `toLowerCase`, which already agrees with Unicode everywhere else, so
 * this table is exactly the difference rather than a second implementation of the whole mapping.
 * Every entry expands to more characters or to different ones: the sharp s and the long s, and
 * the Latin ligatures, which a case insensitive volume decomposes.
 *
 * `ẞ` IS NOT HERE AND DOES NOT NEED TO BE: its lower case is `ß`, which is, so the two reach one
 * answer through the same entry. That is the shape of the whole table.
 */
const FULL_FOLD: ReadonlyMap<string, string> = new Map([
  ['ß', 'ss'],
  ['ſ', 's'],
  ['ﬀ', 'ff'],
  ['ﬁ', 'fi'],
  ['ﬂ', 'fl'],
  ['ﬃ', 'ffi'],
  ['ﬄ', 'ffl'],
  ['ﬅ', 'st'],
  ['ﬆ', 'st'],
]);

/**
 * One string as a case insensitive filesystem sees it.
 *
 * NFC FIRST, because a volume that folds case also folds the composed and decomposed spellings of
 * one letter, and the normalizer already refuses a document whose ids collide only that way.
 *
 * THE ERROR DIRECTION IS CHOSEN, and SPEC 16.1 records why. Where a volume folds something Unicode
 * does not, a page can still be lost; where it folds less, a legal document is refused. The
 * refusal is the one to have: it names both ids and asks for a rename, while the loss says nothing
 * and reaches the reader as a dead link. The measured pairs are held by the suites of both callers
 * so a disagreement with a real volume is a failing test rather than a missing page.
 *
 * @param text - A path segment, a file name, or any id that will become one
 * @returns The folded form, for comparison only; never for display and never for a file name
 *
 * @example
 * caseFoldForFilesystem('ẞ') === caseFoldForFilesystem('ss'); // true
 * caseFoldForFilesystem('ı') === caseFoldForFilesystem('i'); // false
 */
export function caseFoldForFilesystem(text: string): string {
  let folded = '';

  for (const character of text.normalize('NFC').toLowerCase()) {
    folded += FULL_FOLD.get(character) ?? character;
  }

  return folded;
}

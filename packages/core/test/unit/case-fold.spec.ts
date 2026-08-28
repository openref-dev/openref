import { describe, expect, it } from 'vitest';
import { caseFoldForFilesystem } from '../../src/index';

/**
 * The fold of SPEC 16.1, held to the pairs that were measured on a real volume.
 *
 * ONE FUNCTION, TWO CALLERS, and this suite is where the agreement is stated. The page plan and
 * the asset catalog each had their own spelling of this and each lost a page; what a real volume
 * does is measured in `packages/static/test/integration/fold-on-disk.spec.ts`, and this pins the
 * function itself so a change to it fails here first.
 */
describe('caseFoldForFilesystem', () => {
  it.each([
    ['the capital sharp s, whose upper case is itself', 'ẞ', 'ss'],
    ['the small sharp s', 'ß', 'ss'],
    ['the long s, which lower casing leaves alone', 'ſample', 'sample'],
    ['a ligature', 'ﬁle', 'file'],
    ['a three letter ligature', 'ﬃx', 'ffix'],
    ['the Kelvin sign', 'K', 'k'],
    ['an ordinary capital', 'User', 'user'],
    ['a decomposed spelling', 'café', 'café'],
  ])('should fold %s together', (_reason, left, right) => {
    // Given the pair above

    // When
    const folded = [caseFoldForFilesystem(left), caseFoldForFilesystem(right)];

    // Then
    expect(folded[0]).toBe(folded[1]);
  });

  it.each([
    ['the dotless i, whose upper case is I', 'ı', 'i'],
    ['the dotted capital I', 'İ', 'i'],
    ['a diaeresis', 'ä', 'a'],
    ['a Greek letter', 'Ω', 'omega'],
    ['a final sigma', 'ς', 'sigma'],
    ['a caron', 'ǰ', 'j'],
  ])('should keep %s apart', (_reason, left, right) => {
    // Given the pair above

    // When
    const folded = [caseFoldForFilesystem(left), caseFoldForFilesystem(right)];

    // Then
    expect(folded[0]).not.toBe(folded[1]);
  });

  it('should leave an ordinary lower case id exactly as it is', () => {
    // Given
    const id = 'get-orders-id';

    // When
    const folded = caseFoldForFilesystem(id);

    // Then
    expect(folded).toBe(id);
  });
});

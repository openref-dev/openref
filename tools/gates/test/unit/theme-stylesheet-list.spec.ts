import { basename } from 'node:path';
import { DEFAULT_THEME_STYLESHEETS } from '@openref/theme';
import { describe, expect, it } from 'vitest';
import { FONT_STYLESHEETS, THEME_TOKEN_STYLESHEETS } from '../../src/config.js';

/**
 * The shipped theme's cascade, reconciled with the list the theme actually publishes.
 *
 * WHY THIS FILE EXISTS, AND IT IS F24. `THEME_TOKEN_STYLESHEETS` names the shipped theme's
 * stylesheets in load order, and its own comment said the order is what `DEFAULT_THEME_STYLESHEETS`
 * publishes minus the font file. Nothing compared them. A third stylesheet added to the theme has
 * to be added to `DEFAULT_THEME_STYLESHEETS`, to the package `exports` and to an exact equality
 * test to ship at all, and it would not have to be added here: `theme-motion` would then check a
 * cascade with a stylesheet missing from it and report conformance.
 *
 * It is the same shape as F23 one size down. A stated invariant that nothing checks is a comment,
 * and the gate it describes is only as accurate as the hand that last touched the list.
 *
 * COMPARED BY FILE NAME AND IN ORDER, not by path. The two lists address the same files from
 * different sides: the theme publishes package specifiers, because a theme consumed from another
 * package cannot use a relative path, and the gate holds repository paths, because it opens the
 * sources. What has to agree is which stylesheets there are and what order they cascade in, and
 * that the gate can open each of them is what the gate itself already checks.
 *
 * THE FONT FILE IS EXCLUDED BY NAMING IT FROM THE OTHER LIST rather than by a literal here. It is
 * excluded because it declares no token, and the list that knows which file that is is
 * `FONT_STYLESHEETS`. A literal would be a third hand written copy of the thing this test exists
 * to remove.
 */

/** The one theme that is code rather than a design document, keyed the same way in both lists. */
const SHIPPED = 'vernier, as shipped';

describe('THEME_TOKEN_STYLESHEETS', () => {
  it('should hold the shipped theme cascade the theme package publishes, minus the font file', () => {
    // Given the theme's own published order and the font stylesheet that carries no token
    const fontFile = fontStylesheet();
    const published = DEFAULT_THEME_STYLESHEETS.map((specifier) => basename(specifier)).filter(
      (file) => file !== basename(fontFile),
    );

    // When
    const checked = shippedCascade();

    // Then
    expect(checked.map((file) => basename(file))).toEqual(published);
  });

  it('should be checking a cascade rather than a single stylesheet', () => {
    // Given. The order is the whole reason the gate reads more than one file: reduced motion is
    // decided by source order, so a stylesheet that re-declares a duration after the reduced
    // motion block undoes it, and one file read on its own cannot see that. A shipped theme that
    // fell to a single stylesheet would make the gate pass by having nothing left to compare.
    const checked = shippedCascade();

    // When, Then
    expect(checked.length).toBeGreaterThan(1);
  });
});

/**
 * The shipped theme's cascade, as the motion gate reads it.
 *
 * @returns Repository relative stylesheet paths, in load order
 * @throws {Error} When no entry carries the shipped theme's label
 */
function shippedCascade(): readonly string[] {
  const entry = THEME_TOKEN_STYLESHEETS.find((candidate) => candidate.theme === SHIPPED);
  if (entry === undefined) throw new Error(`THEME_TOKEN_STYLESHEETS has no "${SHIPPED}" entry`);

  return entry.files;
}

/**
 * The stylesheet that declares the shipped theme's faces, named by the list that owns fonts.
 *
 * @returns Repository relative path
 * @throws {Error} When no entry carries the shipped theme's label
 */
function fontStylesheet(): string {
  const entry = FONT_STYLESHEETS.find((candidate) => candidate.theme === SHIPPED);
  if (entry === undefined) throw new Error(`FONT_STYLESHEETS has no "${SHIPPED}" entry`);

  return entry.file;
}

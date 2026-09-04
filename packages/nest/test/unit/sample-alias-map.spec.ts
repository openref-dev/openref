import { describe, expect, it } from 'vitest';
import { bundledLanguagesInfo } from 'shiki';
import { SAMPLE_LANGUAGES } from '@openref/samples';

/**
 * Which of SPEC 18's fifteen language ids are aliases of one shiki grammar, measured.
 *
 * IT LIVES HERE BECAUSE THIS IS THE ONE PACKAGE THAT HOLDS BOTH HALVES. The fifteen ids are
 * `@openref/samples`, which may depend on `core` and `runner` alone and therefore cannot see a
 * highlighter; the grammars are shiki, which `@openref/nest` declares as a dependency because it
 * ships the server side highlighter. Writing the ids out by hand next to shiki, or the grammars out
 * by hand next to the ids, would be the second copy of a list this repository has been caught by
 * more than once, so the case reads both from their owners.
 *
 * WHAT IT PINS AND WHY IT IS WORTH PINNING. SPEC 18's ruling of 2026-09-04 is that a tab is
 * identified by its `lang`, so two ids are two tabs whatever grammar they highlight with; the
 * grammar map is what decides how many distinct ids four command line tools have to spend to get
 * four tabs. The day shiki folds two more of the fifteen into one grammar, that decision is worth
 * re-reading, and this case is what makes that day visible instead of silent.
 */
describe('the alias map of SPEC 18, measured against the highlighter this project ships', () => {
  /** Every declared id and alias of the bundle, pointing at the grammar that answers for it. */
  const grammarOf = new Map<string, string>();
  for (const info of bundledLanguagesInfo) {
    grammarOf.set(info.id, info.id);
    for (const alias of info.aliases ?? []) grammarOf.set(alias, info.id);
  }

  it('should resolve every one of the fifteen, so a missing id is not read as a distinct grammar', () => {
    // Given, When: the subject asserted present before anything is said about how it groups. An id
    // shiki does not know would resolve to nothing and would then look like a grammar of its own,
    // which is the shape that makes the grouping below read as clean when it is unmeasured.
    const unknown = SAMPLE_LANGUAGES.filter((language) => !grammarOf.has(language.id));

    // Then
    expect(SAMPLE_LANGUAGES).toHaveLength(15);
    expect(unknown.map((language) => language.id)).toEqual([]);
  });

  it('should share exactly one grammar, between the three shell ids and nothing else', () => {
    // Given, When
    const groups = new Map<string, string[]>();
    for (const language of SAMPLE_LANGUAGES) {
      const grammar = grammarOf.get(language.id) ?? language.id;
      groups.set(grammar, [...(groups.get(grammar) ?? []), language.id]);
    }
    const shared = [...groups].filter(([, ids]) => ids.length > 1);

    // Then one group of three, `shellscript`, which is why cURL, HTTPie and wget spend three ids
    // between them; the other twelve ids answer to twelve grammars, one each.
    expect(shared).toEqual([['shellscript', ['shell', 'bash', 'sh']]]);
    expect(groups.size).toBe(13);
  });

  it('should give the fifteen fifteen distinct tab identities, whatever they highlight with', () => {
    // Given, When: the identity the ruling of 2026-09-04 settles on, which is the id and not the
    // grammar. This is the assertion that makes the grouping above a fact about highlighting
    // rather than a fact about tabs.
    const ids = SAMPLE_LANGUAGES.map((language) => language.id);

    // Then
    expect(new Set(ids).size).toBe(ids.length);
  });
});

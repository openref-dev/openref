/**
 * Level 3 outranks the generator, which is the one sentence SPEC 18 says about priority.
 *
 * WHAT "HIGHEST PRIORITY" HAS TO MEAN HERE, said as behaviour rather than as an adjective. A hand
 * written sample and a generated one for the same language cannot both be a tab: `CodeSample`
 * finds the active sample by its `lang`, so two entries carrying one language make the second
 * unreachable and make which one a reader sees depend on list order. So the rule is not only that
 * the document's samples come first; it is that a generated sample for a language the document
 * already wrote is not produced at all.
 *
 * THE DOCUMENT'S OWN ORDER IS KEPT. A reader who wrote three samples wrote them in an order, and
 * sorting them would be this package having an opinion about a document it did not write.
 *
 * THE SAME RULE HAD TO BE READ AGAINST THE DOCUMENT ITSELF, WHICH IT WAS NOT UNTIL 2026-09-04. The
 * function deduplicated the generated list against the declared one and never the declared list
 * against itself, so a document writing two samples under one `lang` reached a page with two tabs
 * of which one could be clicked and never shown. That is the same defect the paragraph above
 * describes, arriving from the other side, and it is answered the same way: the first entry under
 * a language is the tab and the rest are returned as {@link ComposedCodeSamples.unreachable}, so
 * the page can say what the document wrote and the strip cannot show.
 *
 * AND THE THIRD SIDE OF THE SAME RULE WAS SILENT UNTIL THE SAME DAY, WHICH IS WHAT THE MAINTAINER'S
 * RULING OF 2026-09-04 CLOSES. Dropping a generated sample is right and losing the language is not.
 * `continue` returned nothing, so a document writing `lang: "bash"` took the id HTTPie is keyed by
 * and HTTPie appeared in none of the three lists the page prints: it was not drawn, not held back
 * and not refused, and the word was nowhere on the page. Tab identity stays `lang`, which is what
 * the invariant of SPEC 18 already holds by and what keeps `IRCodeSample` frozen; what changes is
 * that the displaced generated sample comes back as {@link ComposedCodeSamples.shared} so the
 * caller can name the language sharing that tab.
 */

import type { IRCodeSample } from '@openref/core';

/** One list of samples, and the entries a tab strip keyed by language cannot show. */
export interface ComposedCodeSamples {
  /** The tabs, document samples first, one per language. */
  readonly samples: readonly IRCodeSample[];
  /**
   * Declared samples an earlier entry already claimed the language of, in document order.
   *
   * RETURNED RATHER THAN DROPPED, because dropping is the silence this whole section is written
   * against. The caller states it beside the tabs; nothing here decides the words.
   */
  readonly unreachable: readonly IRCodeSample[];
  /**
   * Generated samples a declared entry claimed the language of, in generator order.
   *
   * THE LANGUAGE SHARES THE TAB AND IS NOT PUT OUT OF THE PAGE, which is what the maintainer ruled
   * on 2026-09-04 and what SPEC 18 says from the same day. The declared sample is the tab, because
   * level 3 outranks the generator; this member is how the caller learns which language that tab is
   * keyed by, so it can say the name rather than let it vanish. Measured before the ruling: a
   * document writing `bash` left no trace of HTTPie anywhere on the page.
   */
  readonly shared: readonly IRCodeSample[];
}

/**
 * Puts the document's samples before the generated ones and drops the duplicates by language.
 *
 * @param declared - What the document wrote, from `IROperation.codeSamples`, absent when none
 * @param generated - What the generator produced
 * @returns One list, document samples first, what the document wrote that cannot be shown, and the
 *   generated samples whose language a declared entry took the tab of
 *
 * @example
 * const { samples } = composeCodeSamples(operation.codeSamples, generated);
 */
export function composeCodeSamples(
  declared: readonly IRCodeSample[] | undefined,
  generated: readonly IRCodeSample[],
): ComposedCodeSamples {
  const samples: IRCodeSample[] = [];
  const unreachable: IRCodeSample[] = [];
  const shared: IRCodeSample[] = [];
  const spoken = new Set<string>();
  const written = new Set((declared ?? []).map((sample) => sample.lang));

  for (const sample of declared ?? []) {
    if (spoken.has(sample.lang)) unreachable.push(sample);
    else {
      spoken.add(sample.lang);
      samples.push(sample);
    }
  }

  for (const sample of generated) {
    // THE TEST IS WHETHER THE DOCUMENT TOOK THE ID, NOT WHETHER ANYTHING TOOK IT. `spoken` also
    // holds every generated language added on this pass, and a caller naming one language twice is
    // a duplicate rather than a shared tab: there is no second language to name, and the sentence
    // would say a tab is shared with itself.
    if (written.has(sample.lang)) {
      shared.push(sample);
      continue;
    }

    if (spoken.has(sample.lang)) continue;

    spoken.add(sample.lang);
    samples.push(sample);
  }

  return { samples, unreachable, shared };
}

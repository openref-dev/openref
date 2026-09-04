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
}

/**
 * Puts the document's samples before the generated ones and drops the duplicates by language.
 *
 * @param declared - What the document wrote, from `IROperation.codeSamples`, absent when none
 * @param generated - What the generator produced
 * @returns One list, document samples first, and what the document wrote that cannot be shown
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
  const spoken = new Set<string>();

  for (const sample of declared ?? []) {
    if (spoken.has(sample.lang)) unreachable.push(sample);
    else {
      spoken.add(sample.lang);
      samples.push(sample);
    }
  }

  for (const sample of generated) {
    if (spoken.has(sample.lang)) continue;

    spoken.add(sample.lang);
    samples.push(sample);
  }

  return { samples, unreachable };
}

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
 */

import type { IRCodeSample } from '@openref/core';

/**
 * Puts the document's samples before the generated ones and drops the duplicates by language.
 *
 * @param declared - What the document wrote, from `IROperation.codeSamples`, absent when none
 * @param generated - What the generator produced
 * @returns One list, document samples first
 *
 * @example
 * composeCodeSamples(operation.codeSamples, samples);
 */
export function composeCodeSamples(
  declared: readonly IRCodeSample[] | undefined,
  generated: readonly IRCodeSample[],
): readonly IRCodeSample[] {
  const written = declared ?? [];
  const spoken = new Set(written.map((sample) => sample.lang));

  return [...written, ...generated.filter((sample) => !spoken.has(sample.lang))];
}

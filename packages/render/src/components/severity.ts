/**
 * The severity chip vocabulary, keyed by the model's severity class.
 *
 * ONE TABLE FOR EVERY CHIP, since `TX-PARITY-UI` put the chip on health finding rows beside
 * the FixBar that always had one: glyph, word and class suffix are one decision, and two
 * copies would come to disagree the first time the design renames a level. The design names
 * the levels crit, warn and note, and the suffix is how the FixBar, its chip and the verdict
 * box each get a class of their own rather than borrowing the finding card's, whose
 * background and mark edge belong to a card and not to a chip.
 */

import { h, type VNode } from 'vue';

/** Glyph, accessible word and class suffix per severity class. */
export const SEVERITIES: Readonly<Record<string, readonly [string, string, string]>> = {
  'oref-drift-crit': ['▲', 'critical', 'crit'],
  'oref-drift-warn': ['△', 'warning', 'warn'],
  'oref-drift-note': ['·', 'note', 'note'],
};

/**
 * The chip itself: the glyph, `aria-hidden` because the word beside it is the statement, and
 * the word.
 *
 * @param severityClass - The model's severity class, `oref-drift-crit`
 * @returns The chip, or null for a class the table does not know
 */
export function severityChip(severityClass: string): VNode | null {
  const severity = SEVERITIES[severityClass];
  if (severity === undefined) return null;

  return h('span', { class: ['oref-sev', `oref-sev-${severity[2]}`] }, [
    h('span', { class: 'oref-sev-glyph', 'aria-hidden': 'true' }, severity[0]),
    severity[1],
  ]);
}

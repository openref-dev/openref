/**
 * The mark that says where one runtime fact came from, per SPEC 6.1.
 *
 * THE THREE CONFIDENCE LEVELS ARE READABLE WITH NO COLOUR AT ALL, and by two means rather than
 * one: the three letter code, which survives a monochrome print and is read aloud through the
 * `abbr` title, and the style of the mark's left edge, solid, dashed and dotted, which tells them
 * apart at a glance without anything being read.
 *
 * THE CODE IS IN THE MARKUP AND NOT IN `content: var(--oref-prov-*-code)`. A code drawn by the
 * stylesheet vanishes when the stylesheet does not arrive, cannot be selected, and reaches a
 * screen reader only as generated content. A theme that wants other letters overrides this slot,
 * which is what the registry is for.
 *
 * IT DERIVES THE THREE STRINGS FROM THE TWO FACTS, since `TX-SLOTWIRE`. The page model used to
 * carry the code, the class and the tooltip, which made this position unable to supply its own
 * declared props: a slot handed `confidence` and `collector` cannot be fed a formatted class
 * name. The formatting is four lines and it belongs where the markup is.
 */

import { h, type VNode } from 'vue';
import type { IRConfidence } from '@openref/core';

/**
 * The mark glyph and the three letter code of each level, per the design contract.
 *
 * The glyphs, square, diamond and circle, sit outside the latin subsets the theme fonts ship,
 * and deliberately so, per the maintainer's 2026-08-14 decision: they render from the mono
 * stack's system fallback rather than from a grown subset, and the browser suite asserts each
 * draws at a non-zero width. The span is `aria-hidden` because the code and the `abbr` title
 * already say everything the glyph shows.
 */
const MARKS: Readonly<Record<IRConfidence, readonly [string, string]>> = {
  declared: ['■', 'DCL'],
  derived: ['◆', 'DRV'],
  inferred: ['○', 'INF'],
};

/**
 * Renders one provenance mark.
 *
 * `abbr` with a `title` is the element the language already has for a short code standing for a
 * longer thing, so the expansion is a tooltip for a pointer and an accessible name for a reader
 * who is not using one. The collector's name travels in the same string, because "where did this
 * come from" and "who says so" are one question a reader asks once.
 *
 * @param props - The level of the fact and the collector that produced it
 * @returns The mark
 */
export function ProvenanceTag(props: {
  readonly confidence: IRConfidence;
  readonly collector: string;
}): VNode {
  return h(
    'abbr',
    {
      class: `oref-prov oref-prov-${props.confidence}`,
      title: `${props.confidence}, ${props.collector}`,
    },
    [
      h('span', { class: 'oref-prov-glyph', 'aria-hidden': 'true' }, MARKS[props.confidence][0]),
      MARKS[props.confidence][1],
    ],
  );
}

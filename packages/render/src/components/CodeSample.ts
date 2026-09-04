/**
 * Call samples, one tab per language, per SPEC 18.
 *
 * WHAT IS HERE IS LEVEL 3 AND ONLY LEVEL 3. SPEC 18 has three: a generator that writes cURL,
 * TypeScript and Python from the same values the runner sends, templates for six more languages,
 * and `x-codeSamples`, which an author wrote by hand and which outranks both. The first two are
 * T057, in M6. What this draws is what the document says, and it draws it from
 * `CodeSampleModel`, which is the shape the generator will produce too, so a sample from either
 * source is indistinguishable to a theme.
 *
 * THE POSITION WAS BUILT BEFORE THE REGISTRY WAS FROZEN, DELIBERATELY. `CodeSample` was a name in
 * the registry that nothing resolved, which is the eighth defect class of SPEC 0: built, correct
 * and unreachable. Freezing a name with no position behind it would have been that class made
 * permanent, so the field was added to the normalizer, the page model and this block, and the
 * generator stayed where it was scheduled.
 *
 * THE TABS ARE BUTTONS AND THE STATE IS THE PAGE'S. One sample is visible at a time; the choice
 * is client state, which is why it arrives as a prop and a callback rather than being held here.
 * A `details` list would have needed no script and would have shown a reader four copies of one
 * request at once, which is the thing a tab strip exists to avoid.
 *
 * EVERY CLASS HERE IS A MODIFIER ON AN ELEMENT THE THEME ALREADY DRAWS, which is the shape T030
 * settled for the stream controls: the strip is `.oref-tryit-actions`, a tab is `.oref-send`, and
 * the sample is `.oref-example`, which is what a highlighted block of code already is. A block
 * that invented four classes would have needed four rules, and `theme-css-raw` has thirteen bytes
 * left in it. The modifiers are hooks for a theme that wants to tell a sample from a response.
 */

import { Fragment, h, type VNode } from 'vue';
import { MarkdownBlock } from './MarkdownBlock';
import type { CodeSampleModel } from '@openref/vue';

/**
 * Renders the call samples block.
 *
 * THE SECTION ELEMENT IS `NodePanel`'s AND THE CONTENTS ARE THIS SLOT'S, since 2026-09-03. The two
 * sentences that name a language the page holds back and a language whose emitter refused belong
 * inside the block a reader is looking at, and they may not be a slot's to drop, so the element
 * that holds all three is drawn one level up and this returns its children. What a theme replacing
 * this slot decides is still everything about how a sample looks, its own heading included.
 *
 * AN EMPTY STRIP IS NOT DRAWN, AND THAT IS THE OTHER HALF. An operation whose every language
 * refused has no tab to put in a strip, and `<div role="tablist"></div>` under a heading is the
 * shape the page model's own comment calls worse than no section at all: it announces a control
 * that is not there. The heading stays, because the section still has something to say, and what it
 * says is the refusal `NodePanel` prints under this.
 *
 * @param props - The samples, which one is showing, and how to change that
 * @returns The heading, the tab strip when there is one, and the sample showing
 */
export function CodeSample(props: {
  readonly samples: readonly CodeSampleModel[];
  readonly activeLang: string;
  readonly onSelect: (lang: string) => void;
}): VNode {
  const active =
    props.samples.find((sample) => sample.lang === props.activeLang) ?? props.samples[0];

  return h(Fragment, [
    h('h2', { class: 'oref-section-title' }, 'Call it'),
    props.samples.length === 0
      ? null
      : h(
          'div',
          { class: 'oref-tryit-actions oref-sample-tabs', role: 'tablist' },
          props.samples.map((sample) =>
            h(
              'button',
              {
                class: [
                  'oref-send',
                  'oref-sample-tab',
                  sample.lang === active?.lang ? 'oref-active' : '',
                ],
                key: sample.lang,
                type: 'button',
                role: 'tab',
                'aria-selected': sample.lang === active?.lang ? 'true' : 'false',
                onClick: (): void => {
                  props.onSelect(sample.lang);
                },
              },
              sample.label,
            ),
          ),
        ),
    active === undefined
      ? null
      : h(MarkdownBlock, { html: active.sourceHtml, className: 'oref-example oref-sample' }),
  ]);
}

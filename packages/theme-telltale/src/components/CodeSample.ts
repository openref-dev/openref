import { h, type VNode } from 'vue';
import type { CodeSampleModel } from '@openref/vue';

/**
 * Call samples, one tab per language, per SPEC 18.
 *
 * `activeLang` IS EMPTY BEFORE ANYTHING IS CHOSEN, and the first tab is what shows then. It is
 * empty on the server and on the first client render, so both sides draw the same tab and the
 * hydration matches; a component that picked a default in its own state would have picked it on
 * one side only.
 *
 * The source arrives already highlighted, on the server, per SPEC 12. Nothing here parses code.
 */
export default function CodeSample(props: {
  readonly samples: readonly CodeSampleModel[];
  readonly activeLang: string;
  readonly onSelect: (lang: string) => void;
}): VNode {
  const active =
    props.samples.find((sample) => sample.lang === props.activeLang) ?? props.samples[0];

  return h('section', { class: 'tt-samples' }, [
    h('h2', { class: 'tt-strip-head' }, 'CALL'),
    h(
      'div',
      { class: 'tt-sample-tabs', role: 'tablist' },
      props.samples.map((sample) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            key: sample.lang,
            class: ['tt-sample-tab', sample === active ? 'tt-sample-current' : null],
            'aria-selected': sample === active ? 'true' : 'false',
            onClick: (): void => {
              props.onSelect(sample.lang);
            },
          },
          sample.label === '' ? sample.lang : sample.label,
        ),
      ),
    ),
    active === undefined
      ? null
      : h('div', { class: 'tt-sample-body', innerHTML: active.sourceHtml }),
  ]);
}

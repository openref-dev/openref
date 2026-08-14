/**
 * A streaming response as it arrives, per SPEC 14.6.
 *
 * AN INVALID ELEMENT IS MARKED AND SHOWN, NEVER DROPPED. Its raw text is beside the sentence
 * saying what the document expected, because the whole reason to check an element against the
 * declared item schema is to be able to look at the one that failed.
 *
 * AND THE GAP IS NAMED. The window holds the last five hundred elements, so a longer stream has a
 * beginning the reader is not looking at, and a list that simply started later would read as a
 * stream that started later.
 *
 * SIX ENDINGS AND SIX SENTENCES, because a stream that stopped for a reason the reader chose and
 * a stream the server stopped answering look identical once the elements stop arriving. The
 * message the runner supplies is appended where there is one, since that is where a status or a
 * limit is named.
 *
 * NO WRAPPER AND NO LIST, WHICH IS A STATEMENT ABOUT THE THEME RATHER THAN AN ECONOMY. This
 * region is made entirely of elements the theme already styles: a problem is `.oref-run-error`
 * and an element is `.oref-run-body`, both of which carry their own spacing and their own edge.
 * What is added is four modifiers, each on an element that is already styled, so a theme that
 * wants to treat a stream differently from a single response has somewhere to hang it.
 */

import { h, type VNode } from 'vue';
import type { RunnerStreamElement, RunnerStreamEnd, StreamCounts } from '@openref/vue';

/**
 * What to tell a reader about a stream that has ended.
 *
 * @param end - How the stream ended
 * @returns One sentence
 */
export function endSentence(end: RunnerStreamEnd): string {
  const reason =
    end.reason === 'complete'
      ? 'The server closed the stream.'
      : end.reason === 'terminator'
        ? 'The stream ended on its terminator.'
        : end.reason === 'stopped'
          ? 'You stopped the stream, and the request was closed.'
          : end.reason === 'timeout'
            ? 'The stream was closed because the server went quiet.'
            : end.reason === 'refused'
              ? 'The server did not open a stream.'
              : 'The stream ended abnormally.';

  return end.message === undefined ? reason : `${reason} ${end.message}`;
}

/**
 * Renders the stream controls, the window and how it ended.
 *
 * @param props - The window, the counts, the ending and the two controls
 * @returns The block
 */
export function StreamLog(props: {
  readonly elements: readonly RunnerStreamElement[];
  readonly counts: StreamCounts;
  readonly end: RunnerStreamEnd | null;
  readonly open: boolean;
  readonly mounted: boolean;
  readonly available: boolean;
  readonly onStart: () => void;
  readonly onStop: () => void;
}): VNode {
  const counts = props.counts;

  return h('div', { class: 'oref-run-result oref-stream' }, [
    h('div', { class: 'oref-tryit-actions' }, [
      h(
        'button',
        {
          class: 'oref-send oref-stream-start',
          type: 'button',
          // THE SAME THREE STATES SEND HAS, AND FOR THE SAME REASON, which is F14. Before mount
          // the button is a real target that says it is unavailable, because a natively disabled
          // control receives no click in Chrome and the press that was meant to fetch this
          // console would reach nothing to replay.
          disabled: props.mounted && (!props.available || props.open),
          'aria-disabled': props.mounted ? null : 'true',
          onClick: (): void => {
            if (props.open) return;
            props.onStart();
          },
        },
        props.open ? 'Streaming' : 'Stream',
      ),
      h(
        'button',
        {
          class: 'oref-send oref-stream-stop',
          type: 'button',
          disabled: !props.open,
          onClick: props.onStop,
        },
        'Stop',
      ),
    ]),
    counts.received === 0 && props.end === null
      ? null
      : h('div', { class: 'oref-run-summary' }, [
          h('span', { class: 'oref-run-time' }, `${String(counts.received)} received`),
          counts.invalid === 0
            ? null
            : h('span', { class: 'oref-run-time' }, `${String(counts.invalid)} invalid`),
          counts.dropped === 0
            ? null
            : h(
                'span',
                { class: 'oref-run-time' },
                `${String(counts.dropped)} scrolled out of the window`,
              ),
        ]),
    ...props.elements.flatMap((element) => [
      element.problem === undefined
        ? null
        : h(
            'p',
            { class: 'oref-run-error oref-stream-problem', key: `p:${String(element.seq)}` },
            element.problem,
          ),
      h('pre', { class: 'oref-run-body oref-stream-element', key: `d:${String(element.seq)}` }, [
        h('code', {}, element.data),
      ]),
    ]),
    props.end === null ? null : h('p', { class: 'oref-tryit-notice' }, endSentence(props.end)),
  ]);
}

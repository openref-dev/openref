import { h, type VNode } from 'vue';
import type { RunnerStreamElement, RunnerStreamEnd, StreamCounts } from '@openref/vue';

/**
 * A streaming response as it arrives, per SPEC 14.6.
 *
 * THE COUNTS ARE DRAWN EVEN WHEN THE WINDOW IS FULL, and that is the point of their existing. The
 * window is bounded, so a log that simply started later would read as a stream that started later.
 * `dropped` says what scrolled out, `invalid` says what did not match the declared item schema,
 * and `received` says what arrived.
 *
 * HOW IT ENDED IS A FACT AND NOT AN ABSENCE. `end` distinguishes a stream that completed from one
 * the reader stopped, one that timed out, one that was refused and one that hit its terminator,
 * and a log that only stopped drawing would say none of them.
 */
const ENDINGS: Readonly<Record<RunnerStreamEnd['reason'], string>> = {
  complete: 'complete',
  terminator: 'ended on its terminator',
  stopped: 'stopped here',
  timeout: 'timed out',
  refused: 'refused',
  failed: 'failed',
};

export default function StreamLog(props: {
  readonly elements: readonly RunnerStreamElement[];
  readonly counts: StreamCounts;
  readonly end: RunnerStreamEnd | null;
  readonly open: boolean;
  readonly mounted: boolean;
  readonly available: boolean;
  readonly onStart: () => void;
  readonly onStop: () => void;
}): VNode {
  return h('section', { class: ['tt-stream', props.open ? 'tt-stream-open' : null] }, [
    h('h2', { class: 'tt-strip-head' }, 'STREAM'),
    h('div', { class: 'tt-stream-controls' }, [
      h(
        'button',
        {
          type: 'button',
          class: 'tt-stream-start',
          disabled: !props.available || !props.mounted || props.open,
          onClick: (): void => {
            props.onStart();
          },
        },
        'START',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'tt-stream-stop',
          disabled: !props.open,
          onClick: (): void => {
            props.onStop();
          },
        },
        'STOP',
      ),
      h('span', { class: 'tt-stream-counts' }, [
        h('span', { class: 'tt-stream-count' }, `${String(props.counts.received)} in`),
        h('span', { class: 'tt-stream-count' }, `${String(props.counts.invalid)} invalid`),
        h('span', { class: 'tt-stream-count' }, `${String(props.counts.dropped)} dropped`),
      ]),
    ]),
    h(
      'ol',
      { class: 'tt-stream-log' },
      props.elements.map((element) =>
        h(
          'li',
          {
            class: ['tt-stream-row', element.problem === undefined ? null : 'tt-stream-invalid'],
            key: element.seq,
          },
          [
            h('span', { class: 'tt-stream-seq' }, String(element.seq)),
            element.event === undefined
              ? null
              : h('span', { class: 'tt-stream-event' }, element.event),
            h('code', { class: 'tt-stream-data' }, element.data),
            element.problem === undefined
              ? null
              : h('span', { class: 'tt-stream-problem' }, element.problem),
          ],
        ),
      ),
    ),
    props.end === null
      ? null
      : h('p', { class: ['tt-stream-end', `tt-stream-${props.end.reason}`] }, [
          ENDINGS[props.end.reason],
          props.end.message === undefined
            ? null
            : h('span', { class: 'tt-stream-end-note' }, props.end.message),
        ]),
  ]);
}

import { h, type VNode } from 'vue';
import type { RunnerResult } from '@openref/vue';

/**
 * Status, headers, body and timing of the last response.
 *
 * THE POSITION IS RESOLVED BEFORE ANYTHING HAS BEEN SENT, which is why this draws an empty state
 * rather than returning nothing. A position that only existed once it had content would be a
 * position a theme could not fill with an empty state, and the reader would meet the console as a
 * gap in the page.
 *
 * `error` IS WHAT THE RUNNER REFUSED WITH, and it is a different thing from a response with a 4xx
 * status: the first means nothing was sent, the second means something was and the API said no.
 * This theme prints them in different rows for that reason.
 */
export default function ResponseView(props: {
  readonly result: RunnerResult | undefined;
  readonly error: string | undefined;
  readonly pending: boolean;
}): VNode {
  if (props.error !== undefined) {
    return h('section', { class: 'tt-result tt-result-refused' }, [
      h('h2', { class: 'tt-strip-head' }, 'REFUSED'),
      h('p', { class: 'tt-result-error' }, props.error),
    ]);
  }

  if (props.result === undefined) {
    return h('section', { class: 'tt-result tt-result-idle' }, [
      h('h2', { class: 'tt-strip-head' }, 'RESULT'),
      h('p', { class: 'tt-result-idle-text' }, props.pending ? 'waiting' : 'nothing sent yet'),
    ]);
  }

  const result = props.result;

  return h('section', { class: 'tt-result' }, [
    h('h2', { class: 'tt-strip-head' }, 'RESULT'),
    h('div', { class: 'tt-result-line' }, [
      h(
        'span',
        { class: ['tt-status', `tt-status-${classOf(result.status)}`] },
        String(result.status),
      ),
      h('span', { class: 'tt-result-text' }, result.statusText),
      h('span', { class: 'tt-result-ms' }, `${String(Math.round(result.durationMs))} ms`),
    ]),
    result.notice === undefined
      ? null
      : h('p', { class: 'tt-result-notice', role: 'status' }, result.notice.message),
    h('table', { class: 'tt-table tt-result-headers' }, [
      h(
        'tbody',
        {},
        result.headers.map((header) =>
          h('tr', { class: 'tt-row', key: `${header.name}:${header.value}` }, [
            h('td', { class: 'tt-col-name' }, header.name),
            h('td', { class: 'tt-col-value' }, header.value),
          ]),
        ),
      ),
    ]),
    h('pre', { class: 'tt-result-body' }, [h('code', {}, result.body)]),
  ]);
}

function classOf(status: number): string {
  if (status < 300) return 'ok';
  if (status < 400) return 'info';
  if (status < 500) return 'warn';
  return 'crit';
}

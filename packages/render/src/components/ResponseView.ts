/**
 * Status, headers, body and timings of the last response.
 *
 * THE RESPONSE IS TEXT, NEVER MARKUP. Status, headers and body come from a third party server
 * and are rendered as text children, which Vue escapes. Nothing on this path touches
 * `innerHTML`, and `security.spec.ts` plants a script tag in a response body to prove it.
 *
 * A 401 WHOSE CAUSE IS AN EXPIRED SESSION IS NEVER A BARE STATUS CODE, per SPEC 14.4.1. That
 * line is the difference between a reader concluding the endpoint is broken and a reader
 * learning that their sign in ran out; it is also drawn when the renewal worked, because a
 * silent second of delay otherwise reads as a slow API.
 */

import { h, type VNode } from 'vue';
import { statusClass } from '../shared/status';
import type { RunnerResult } from '@openref/vue';

/**
 * Renders the last response, or what the runner refused with.
 *
 * @param props - The result, the refusal, and whether a request is in flight
 * @returns The response, the refusal, or null when nothing has been sent
 *
 * A REFUSAL AND A RESPONSE ARE NEVER BOTH DRAWN, because the runner clears one when it produces
 * the other: what a reader is looking at is the outcome of the last press on Send, and a stale
 * error beside a fresh response would be two answers to one question.
 */
export function ResponseView(props: {
  readonly result: RunnerResult | undefined;
  readonly error: string | undefined;
  readonly pending: boolean;
}): VNode | null {
  const result = props.result;

  if (props.error !== undefined) return h('p', { class: 'oref-run-error' }, props.error);

  if (result === undefined) return null;

  return h('div', { class: 'oref-run-result' }, [
    result.notice === undefined
      ? null
      : h('p', { class: 'oref-tryit-notice oref-run-notice' }, result.notice.message),
    h('div', { class: 'oref-run-summary' }, [
      h(
        'span',
        { class: `oref-status ${statusClass(String(result.status))}` },
        `${String(result.status)} ${result.statusText}`.trim(),
      ),
      h('span', { class: 'oref-run-time' }, `${String(Math.round(result.durationMs))} ms`),
    ]),
    result.headers.length === 0
      ? null
      : h(
          'dl',
          { class: 'oref-run-headers' },
          result.headers.flatMap((header) => [
            h('dt', { class: 'oref-run-header-name', key: `n:${header.name}` }, header.name),
            h('dd', { class: 'oref-run-header-value', key: `v:${header.name}` }, header.value),
          ]),
        ),
    h('pre', { class: 'oref-run-body' }, [h('code', {}, result.body)]),
  ]);
}

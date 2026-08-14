/**
 * The control a reader reaches for, and the sentence beside it.
 *
 * SEND IS NEVER NATIVELY DISABLED WHILE THE CONSOLE IS STILL DEFERRED, WHICH IS FINDING F14 AND
 * IS THE ONE RULE HERE THAT IS ABOUT A BROWSER RATHER THAN ABOUT A COMPONENT. A form control
 * carrying the `disabled` attribute receives no mouse event in Chrome: pointer events are still
 * dispatched, so the gate does open and the chunk does arrive, but `click` is never generated at
 * all, so there is no click to capture and none to replay, and the press that woke the console
 * sends nothing.
 *
 * Three states, and reading them is how a test tells a live console from the markup that was
 * served:
 *
 * - `aria-disabled` and no `disabled`: deferred. The markup is the server's, and a press on it
 *   opens the gate, fetches the chunk and is replayed into the console that arrives.
 * - `disabled`: live, and cannot send. This build carries no runner, or a request is in flight.
 * - neither: live and ready.
 *
 * AND THE NOTICE NAMES THE ACTION RATHER THAN PROMISING A STATE, which is the second half of the
 * same finding. A permanent excuse beside a control marked unavailable reads as a broken product,
 * per SPEC 11. The button is described by the notice, because `aria-disabled` keeps it focusable
 * and a control announced as unavailable with the reason in an unassociated sibling is announced
 * without the reason at all.
 *
 * THE SENTENCE IS A PROP AND NOT A `StateNotice`, and that is why the notice kinds do not carry
 * it: `aria-describedby` has to name an element inside this position, so the position owns it.
 */

import { h, type VNode } from 'vue';

/**
 * Id of the notice beside Send, so the button can point at it.
 *
 * A CONSTANT RATHER THAN ONE PER NODE, because a page is one operation: the console is mounted by
 * the node page for the node it is about, so two consoles cannot share a document.
 */
export const NOTICE_ID = 'oref-tryit-notice';

/**
 * Renders Send and its notice.
 *
 * @param props - Whether it can act, whether it is acting, and what to say when it cannot
 * @returns The actions row
 */
export function SendButton(props: {
  readonly available: boolean;
  readonly pending: boolean;
  readonly mounted: boolean;
  readonly notice: string;
  readonly onSend: () => void;
}): VNode {
  return h('div', { class: 'oref-tryit-actions' }, [
    h(
      'button',
      {
        class: 'oref-send',
        type: 'button',
        // Live and unable to send, which is the only state the native attribute is right for.
        // Before mount it would take the reader's press away from the gate.
        disabled: props.mounted && (!props.available || props.pending),
        'aria-disabled': props.mounted ? null : 'true',
        // Points at the notice exactly while the notice is drawn, so the description is never a
        // reference to an element that is not in the document.
        'aria-describedby': props.notice === '' ? null : NOTICE_ID,
        onClick: props.onSend,
      },
      props.pending ? 'Sending' : 'Send',
    ),
    props.notice === ''
      ? null
      : h('span', { class: 'oref-tryit-notice', id: NOTICE_ID }, props.notice),
  ]);
}

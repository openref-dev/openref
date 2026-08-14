/**
 * The control a reader reaches for, and the sentence beside it.
 *
 * THE SERVED BUTTON IS A REAL ENABLED CONTROL, WHICH IS THE 2026-08-14 REWRITE OF F14'S RULE
 * AND THE THIRD TIME THIS MECHANISM WAS REPORTED BROKEN. The press on a deferred Send does
 * exactly what the notice says: it brings the console and is replayed into it, so the markup
 * declaring the button disabled was a lie told to every pipeline that respects a declared
 * state. Three of them are measured in SPEC 11: assistive technology announces an
 * `aria-disabled` control as unavailable and may not activate it, automation with an
 * actionability policy refuses to press it at all, and native `disabled` loses the gesture in
 * the engine itself, a pointerdown with no click, which is the original F14. So the deferred
 * state carries neither attribute, and the theme paints the button as the actionable control
 * it is.
 *
 * Two states can still say no, and both are after mount, which is when the truth is known:
 *
 * - `disabled`: live and cannot send. This build carries no runner, or a request is in flight.
 * - neither, no notice: live and ready.
 *
 * What separates the deferred state from the live ready one is the notice: the load sentence
 * stands beside the button exactly until the console mounts, and tests read that sentence
 * rather than any attribute.
 *
 * AND THE NOTICE NAMES THE ACTION RATHER THAN PROMISING A STATE, per SPEC 11. The button is
 * described by the notice through `aria-describedby`, so what a screen reader hears beside
 * Send is the same sentence a sighted reader sees, and it is a true sentence about a press.
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
        // Live and unable to send, which is the only state any disabling attribute is right
        // for. Before mount the button acts on a press, so declaring it disabled would hand
        // every state-respecting pipeline a reason to discard that press.
        disabled: props.mounted && (!props.available || props.pending),
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

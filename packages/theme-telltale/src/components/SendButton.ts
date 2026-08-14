import { h, type VNode } from 'vue';

/**
 * Sending the request.
 *
 * THE NOTICE IS ASSOCIATED WITH THE BUTTON AND NOT MERELY NEXT TO IT. A control announced as
 * unavailable with the reason in an unassociated sibling is announced without the reason at all,
 * per SPEC 11, so the sentence has an id and the button points at it with `aria-describedby`.
 *
 * THE SERVED BUTTON IS NOT DISABLED, per the SPEC 11 rule rewritten 2026-08-14, and this file
 * is the measured case behind the rewrite. `mounted` is false on the server and in the first
 * client render, and this component read that as `disabled`, so the served button was one an
 * engine drops the click on: pressing Send armed the console's loader through `pointerdown`
 * and sent nothing, measured in Chromium and Firefox, which is F14 reproduced in the second
 * theme. A press on the deferred button does what the notice says, so the button is enabled
 * until the console itself knows it cannot act.
 */
const NOTICE_ID = 'tt-send-notice';

export default function SendButton(props: {
  readonly available: boolean;
  readonly pending: boolean;
  readonly mounted: boolean;
  readonly notice: string;
  readonly onSend: () => void;
}): VNode {
  return h('div', { class: 'tt-send' }, [
    h(
      'button',
      {
        type: 'button',
        class: ['tt-send-button', props.pending ? 'tt-send-pending' : null],
        disabled: props.mounted && (!props.available || props.pending),
        ...(props.notice === '' ? {} : { 'aria-describedby': NOTICE_ID }),
        onClick: (): void => {
          props.onSend();
        },
      },
      props.pending ? 'SENDING' : 'SEND',
    ),
    props.notice === '' ? null : h('p', { class: 'tt-send-notice', id: NOTICE_ID }, props.notice),
  ]);
}

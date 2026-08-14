import { h, type VNode } from 'vue';

/**
 * Sending the request.
 *
 * THE NOTICE IS ASSOCIATED WITH THE BUTTON AND NOT MERELY NEXT TO IT. A control announced as
 * unavailable with the reason in an unassociated sibling is announced without the reason at all,
 * per SPEC 11, so the sentence has an id and the button points at it with `aria-describedby`.
 *
 * `mounted` IS FALSE ON THE SERVER AND IN THE FIRST CLIENT RENDER. A button that looked ready
 * before the console had loaded would be a button that does nothing when pressed, and the sentence
 * beside it is what says so meanwhile.
 */
const NOTICE_ID = 'tt-send-notice';

export default function SendButton(props: {
  readonly available: boolean;
  readonly pending: boolean;
  readonly mounted: boolean;
  readonly notice: string;
  readonly onSend: () => void;
}): VNode {
  const ready = props.available && props.mounted && !props.pending;

  return h('div', { class: 'tt-send' }, [
    h(
      'button',
      {
        type: 'button',
        class: ['tt-send-button', props.pending ? 'tt-send-pending' : null],
        disabled: !ready,
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

import { h, type VNode } from 'vue';
import { eventValue, type ValueEvent } from '../dom';
import type { UnsendableCause } from '@openref/core';
import type {
  RunnerDeviceAuthorization,
  RunnerOAuthFlowView,
  RunnerSecuritySchemeView,
  RunnerSessionStatus,
} from '@openref/vue';

/**
 * Credentials for the schemes an operation requires, and the sign in for the ones that have one.
 *
 * NOTHING TYPED HERE IS EVER RENDERED BACK. `mounted` is false in the server render and in the
 * first client render, so the fields are drawn empty and disabled until hydration has matched: a
 * credential that reached the markup would be a credential in the page cache, and the render is
 * cached by document hash per SPEC 12. The reference does the same and for the same reason.
 *
 * `unsendableCause` IS DRAWN AND NOT SKIPPED. A scheme a browser cannot send draws the reason
 * rather than nothing, because a scheme that draws nothing is indistinguishable from a scheme the
 * document never declared. The record below is total over `UnsendableCause` rather than defaulted,
 * so a fourth cause added to the platform rule fails to compile here instead of rendering a
 * sentence this theme made up. The cause is `core`'s and the words are the interface's, which is
 * why the sentences live in a theme at all.
 *
 * THE DEVICE FLOW IS A STATE OF THIS PANEL AND NOT A DIALOG. A device authorization is a code and
 * a URL the reader has to go and use, so it sits where the sign in button was.
 */
const CAUSES: Readonly<Record<UnsendableCause, string>> = {
  'mutual-tls':
    'needs a client certificate, chosen during the TLS handshake, which no code on a page takes part in',
  'cookie-api-key':
    'travels in Cookie, which is a forbidden header name; the same origin proxy of SPEC 14.5 removes this one',
  'http-challenge':
    'is a challenge and response the browser performs itself, so the console never sees it',
};

export default function AuthPanel(props: {
  readonly schemes: readonly RunnerSecuritySchemeView[];
  readonly credentials: Readonly<Record<string, string>>;
  readonly inputs: Readonly<Record<string, string>>;
  readonly flows: Readonly<Record<string, readonly RunnerOAuthFlowView[]>>;
  readonly chosenFlow: Readonly<Record<string, string>>;
  readonly sessions: Readonly<Record<string, RunnerSessionStatus>>;
  readonly notices: Readonly<Record<string, string>>;
  readonly devices: Readonly<Record<string, RunnerDeviceAuthorization>>;
  readonly pending: string | null;
  readonly mounted: boolean;
  readonly onCredential: (schemeId: string, value: string) => void;
  readonly onInput: (schemeId: string, field: string, value: string) => void;
  readonly onFlow: (schemeId: string, kind: string) => void;
  readonly onSignIn: (schemeId: string) => void;
  readonly onSignOut: (schemeId: string) => void;
}): VNode {
  return h('section', { class: 'tt-auth' }, [
    h('h2', { class: 'tt-strip-head' }, 'AUTH'),
    h(
      'ul',
      { class: 'tt-auth-list' },
      props.schemes.map((scheme) => {
        const session = props.sessions[scheme.id];
        const device = props.devices[scheme.id];
        const flows = props.flows[scheme.id] ?? scheme.flows;
        const notice = props.notices[scheme.id] ?? '';

        return h('li', { class: 'tt-auth-scheme', key: scheme.id }, [
          h('div', { class: 'tt-auth-line' }, [
            h('code', { class: 'tt-auth-id' }, scheme.id),
            h('span', { class: 'tt-auth-type' }, scheme.type),
            session?.signedIn === true ? h('span', { class: 'tt-auth-live' }, 'SIGNED IN') : null,
          ]),

          scheme.unsendableCause === undefined
            ? h('label', { class: 'tt-field' }, [
                h('span', { class: 'tt-field-label' }, 'credential'),
                h('input', {
                  class: 'tt-field-input',
                  type: 'password',
                  autocomplete: 'off',
                  disabled: !props.mounted,
                  value: props.mounted ? (props.credentials[scheme.id] ?? '') : '',
                  onInput: (event: ValueEvent): void => {
                    props.onCredential(scheme.id, eventValue(event));
                  },
                }),
              ])
            : h(
                'p',
                { class: 'tt-auth-unsendable' },
                `this scheme ${CAUSES[scheme.unsendableCause]}`,
              ),

          flows.length === 0
            ? null
            : h('div', { class: 'tt-auth-flows' }, [
                h(
                  'div',
                  { class: 'tt-auth-flow-choice', role: 'radiogroup', 'aria-label': 'Flow' },
                  flows.map((flow) =>
                    h(
                      'button',
                      {
                        type: 'button',
                        key: flow.kind,
                        class: [
                          'tt-auth-flow',
                          props.chosenFlow[scheme.id] === flow.kind ? 'tt-auth-flow-on' : null,
                        ],
                        disabled: !props.mounted,
                        onClick: (): void => {
                          props.onFlow(scheme.id, flow.kind);
                        },
                      },
                      flow.kind,
                    ),
                  ),
                ),
                h('label', { class: 'tt-field' }, [
                  h('span', { class: 'tt-field-label' }, 'client id'),
                  h('input', {
                    class: 'tt-field-input',
                    type: 'text',
                    autocomplete: 'off',
                    disabled: !props.mounted,
                    value: props.mounted ? (props.inputs[`${scheme.id}:clientId`] ?? '') : '',
                    onInput: (event: ValueEvent): void => {
                      props.onInput(scheme.id, 'clientId', eventValue(event));
                    },
                  }),
                ]),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'tt-auth-signin',
                    disabled: !props.mounted || props.pending === scheme.id,
                    onClick: (): void => {
                      if (session?.signedIn === true) props.onSignOut(scheme.id);
                      else props.onSignIn(scheme.id);
                    },
                  },
                  session?.signedIn === true ? 'SIGN OUT' : 'SIGN IN',
                ),
              ]),

          device === undefined
            ? null
            : h('div', { class: 'tt-auth-device' }, [
                h('code', { class: 'tt-auth-code' }, device.userCode),
                h(
                  'a',
                  {
                    class: 'tt-auth-verify',
                    href: device.verificationUriComplete ?? device.verificationUri,
                    rel: 'noreferrer',
                  },
                  device.verificationUri,
                ),
              ]),

          notice === '' ? null : h('p', { class: 'tt-auth-notice', role: 'status' }, notice),
        ]);
      }),
    ),
  ]);
}

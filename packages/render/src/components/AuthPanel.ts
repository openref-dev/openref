/**
 * Credentials for the schemes an operation requires, and the sign in for the ones that have one.
 *
 * A CREDENTIAL NEVER REACHES THE MARKUP. The fields are empty in the server render and in the
 * first client render, and stored values are read after hydration has matched, which is what
 * `mounted` says. So a page cached by document hash, per SPEC 12, is a page that could not carry
 * one even if the cache were shared between readers.
 *
 * A SCHEME THAT CANNOT BE EXERCISED IS A ROW WITH A SENTENCE IN IT. `unsendableCause` comes from
 * the projection, so the sentence is in the server's markup before any script runs, and a reader
 * who finds no field for `mutualTLS` learns why rather than concluding the console forgot it.
 * That failure, an unsupported scheme rendering as absent, is the one this shape exists to
 * prevent.
 *
 * WHAT IS DRAWN FOLLOWS THE FLOW, because the flows ask for different things: a device code flow
 * needs a client id and nothing else, `password` needs the reader's own credentials, and
 * `clientCredentials` needs a secret. Drawing every field for every flow would ask a reader for a
 * password the flow they chose never sends.
 *
 * THE WORDS ARE THIS COMPONENT'S AND THE CAUSE IS THE DOCUMENT'S. `unsendableSchemeCause` in
 * `@openref/core` answers which of the three a scheme is, because the console and the runner have
 * to agree on that; what a reader reads is written here, where a theme can write it differently
 * and where it is downloaded only by a reader who opens the console.
 */

import type { UnsendableCause } from '@openref/core';
import { h, type VNode } from 'vue';
import { field, fieldId } from './field';
import { eventValue, type ValueEvent } from '../shared/dom';
import type {
  RunnerDeviceAuthorization,
  RunnerOAuthFlowView,
  RunnerSecuritySchemeView,
  RunnerSessionStatus,
} from '@openref/vue';

/** What a reader is told about a scheme a browser cannot send, one sentence per cause. */
const UNSENDABLE: Readonly<Record<UnsendableCause, string>> = {
  'mutual-tls':
    'this scheme asks for a client certificate during the TLS handshake, which the browser chooses and no code on this page takes part in; it cannot be exercised from the console',
  'cookie-api-key':
    'this key travels in a cookie, and Cookie is a header a browser will not let a script set; it becomes sendable through the same origin proxy',
  'http-challenge':
    'this is a challenge and response the browser performs itself, and a page cannot supply it; basic and bearer are the two http schemes a page can',
};

/** What one flow is called in the sentence a reader reads, rather than in the document. */
const FLOW_LABELS: Readonly<Record<string, string>> = {
  authorizationCode: 'authorization code, with PKCE S256',
  deviceAuthorization: 'device code',
  clientCredentials: 'client credentials',
  password: 'resource owner password',
  implicit: 'implicit',
};

/** Whether a scheme is signed into rather than typed into, per SPEC 14.4. */
export function isOAuthScheme(scheme: RunnerSecuritySchemeView): boolean {
  return scheme.type === 'oauth2' || scheme.type === 'openIdConnect';
}

/**
 * What a reader is asked for, per scheme.
 *
 * The label names the credential rather than the scheme id where the scheme says enough to do
 * so, because `bearerAuth` is the document's word for it and `Bearer token` is the reader's.
 */
function credentialLabel(scheme: RunnerSecuritySchemeView): string {
  if (scheme.type === 'http') {
    const written = scheme.scheme ?? 'http';
    const named = written.toLowerCase();
    // CAPITALIZED, BECAUSE THE COMMENT ABOVE ALREADY SAID SO AND THE CODE DID NOT. A document
    // writes `bearer` because RFC 7235 registers it in lower case; a reader being asked for a
    // credential reads `Bearer token`, which is the word the label was introduced to use.
    const label = `${named.charAt(0).toUpperCase()}${named.slice(1)}`;

    return named === 'basic' ? 'user:password' : `${label} token`;
  }
  if (scheme.type === 'apiKey') return `${scheme.name ?? 'API key'} (${scheme.in ?? 'header'})`;

  return scheme.id;
}

/** What the console is handed about the schemes of one operation. */
export interface AuthPanelProps {
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
  readonly onInput: (schemeId: string, name: string, value: string) => void;
  readonly onFlow: (schemeId: string, kind: string) => void;
  readonly onSignIn: (schemeId: string) => void;
  readonly onSignOut: (schemeId: string) => void;
}

/**
 * What the reader is told about their session.
 *
 * THE EXPIRY IS SAID AS AN ESTIMATE AND NEVER AS A GATE, per SPEC 14.4.1. It is measured from
 * the moment the token endpoint answered, and a sleeping machine or a clock that is off moves
 * it; the authority on whether a token is alive is the API's own 401, so this sentence informs
 * and never blocks a send.
 */
function sessionNote(session: RunnerSessionStatus | undefined): string {
  if (session?.signedIn !== true) return 'not signed in';

  const expiry = session.expiresAtMs;
  if (expiry === undefined) return 'signed in';

  const minutes = Math.round((expiry - Date.now()) / 60_000);
  if (minutes <= 0) return 'signed in, and the token endpoint said this token has run out';

  return `signed in, about ${String(minutes)} minutes left by the token endpoint's estimate`;
}

/** One text field of the sign in form, kept short because there are up to four of them. */
function authField(
  props: AuthPanelProps,
  scheme: RunnerSecuritySchemeView,
  name: string,
  label: string,
  secret: boolean,
): VNode {
  const id = fieldId('oauth', `${scheme.id}-${name}`);

  return field(
    label,
    id,
    h('input', {
      class: 'oref-field-control',
      id,
      type: secret ? 'password' : 'text',
      autocomplete: 'off',
      value: props.inputs[`${scheme.id}:${name}`] ?? '',
      onInput: (event: ValueEvent) => {
        props.onInput(scheme.id, name, eventValue(event));
      },
    }),
    null,
  );
}

/** The sign in form for one OAuth2 or OpenID Connect scheme. */
function oauthBlock(props: AuthPanelProps, scheme: RunnerSecuritySchemeView, key: string): VNode {
  const flows = props.flows[scheme.id] ?? [];
  const chosen = props.chosenFlow[scheme.id] ?? flows[0]?.kind ?? 'authorizationCode';
  const session = props.sessions[scheme.id];
  const device = props.devices[scheme.id];
  const notice = props.notices[scheme.id];

  const rows: (VNode | null)[] = [
    h('span', { class: 'oref-field-label' }, `${scheme.id} (${scheme.type})`),
  ];

  if (flows.length === 0) {
    rows.push(
      h(
        'span',
        { class: 'oref-field-note' },
        scheme.type === 'openIdConnect'
          ? 'the flows this provider offers are read from its discovery document when you sign in'
          : 'this scheme declares no flow, so there is nothing to sign in with',
      ),
    );
  }

  if (flows.length > 1) {
    const id = fieldId('oauth', `${scheme.id}-flow`);

    rows.push(
      field(
        'Flow',
        id,
        h(
          'select',
          {
            class: 'oref-field-control',
            id,
            value: chosen,
            onChange: (event: ValueEvent) => {
              props.onFlow(scheme.id, eventValue(event));
            },
          },
          flows.map((flow) =>
            h('option', { key: flow.kind, value: flow.kind }, FLOW_LABELS[flow.kind] ?? flow.kind),
          ),
        ),
        null,
      ),
    );
  } else if (flows.length === 1) {
    rows.push(h('span', { class: 'oref-field-note' }, FLOW_LABELS[chosen] ?? chosen));
  }

  rows.push(authField(props, scheme, 'clientId', 'Client id', false));

  if (chosen === 'clientCredentials' || chosen === 'authorizationCode') {
    rows.push(
      authField(props, scheme, 'clientSecret', 'Client secret, if the client has one', true),
    );
  }

  if (chosen === 'password') {
    rows.push(
      authField(props, scheme, 'username', 'User name', false),
      authField(props, scheme, 'password', 'Password', true),
    );
  }

  rows.push(
    h('div', { class: 'oref-tryit-actions' }, [
      h(
        'button',
        {
          class: 'oref-send oref-signin',
          type: 'button',
          disabled: !props.mounted || props.pending === scheme.id,
          onClick: () => {
            props.onSignIn(scheme.id);
          },
        },
        session?.signedIn === true ? 'Sign in again' : 'Sign in',
      ),
      session?.signedIn === true
        ? h(
            'button',
            {
              class: 'oref-send oref-signout',
              type: 'button',
              onClick: () => {
                props.onSignOut(scheme.id);
              },
            },
            'Sign out',
          )
        : null,
    ]),
    h('span', { class: 'oref-field-note' }, sessionNote(session)),
  );

  if (device !== undefined) {
    rows.push(
      h(
        'p',
        { class: 'oref-tryit-notice' },
        `Enter the code ${device.userCode} at ${device.verificationUri}. This page is waiting for you to approve it.`,
      ),
    );
  }

  if (notice !== undefined && notice !== '') {
    rows.push(h('p', { class: 'oref-tryit-notice' }, notice));
  }

  return h('div', { class: 'oref-field oref-field-oauth', key }, rows);
}

/**
 * Renders one row per scheme the operation requires, and never an absence.
 *
 * @param props - The schemes, what has been typed into them, and what the sessions say
 * @returns One field per scheme
 */
export function AuthPanel(props: AuthPanelProps): VNode[] {
  return props.schemes.flatMap((scheme) => {
    const id = fieldId('auth', scheme.id);
    const reason =
      scheme.unsendableCause === undefined ? undefined : UNSENDABLE[scheme.unsendableCause];

    if (reason !== undefined) {
      return [
        h('div', { class: 'oref-field', key: id }, [
          h('span', { class: 'oref-field-label' }, `${scheme.id} (${scheme.type})`),
          h('span', { class: 'oref-field-note' }, reason),
        ]),
      ];
    }

    if (isOAuthScheme(scheme)) return [oauthBlock(props, scheme, id)];

    return [
      field(
        credentialLabel(scheme),
        id,
        h('input', {
          class: 'oref-field-control',
          id,
          // A credential is a password field: it keeps the value out of a screen share and
          // out of a browser's form value history, neither of which a text field does.
          type: 'password',
          autocomplete: 'off',
          value: props.credentials[scheme.id] ?? '',
          onInput: (event: ValueEvent) => {
            props.onCredential(scheme.id, eventValue(event));
          },
        }),
        scheme.type === 'http' && (scheme.scheme ?? '').toLowerCase() === 'basic'
          ? 'the user name and the password, joined by a colon'
          : null,
      ),
    ];
  });
}

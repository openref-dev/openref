/**
 * What a browser can put into a socket handshake, and the refusal for everything else.
 *
 * SPEC 14.7 IS A TABLE OF WHAT THE PLATFORM ALLOWS AND THIS FILE IS THAT TABLE APPLIED. A native
 * `WebSocket` is handed a url, the subprotocol list, and whatever cookies the browser decides to
 * send; it cannot set one request header, and no amount of implementation effort changes that.
 * Socket.IO adds an `auth` payload of its own on top of the same url.
 *
 * SO A SCHEME IS EITHER PLACED OR NAMED, NEVER DROPPED. The cause comes from `@openref/core`,
 * because the page has to answer the same question to draw its statement and cannot see this
 * package; the sentence is here, because it is about a value that will not be sent, which is a
 * different thing to tell a reader than "this scheme cannot be exercised", the sentence the page
 * says. That split is `T028`'s, and it is copied here deliberately rather than re-decided.
 *
 * THE REFUSAL IS ABOUT A VALUE AND NOT ABOUT A SCHEME, which is also `T028`'s rule. A channel that
 * declares `oauth2` and is opened with no credential at all is a legitimate thing to try: the
 * server answers however it answers, and refusing here would make the console unable to show that.
 * What is refused is a value the reader supplied that cannot travel, and it is refused before any
 * socket is opened, so nothing broken is ever put on the wire.
 */

import { AuthError, ErrorCode, handshakeBlockedCause } from '@openref/core';
import type { HandshakeBlockedCause } from '@openref/core';
import type { RunnableSecurityScheme } from '../../request/domain/request-plan';
import type {
  SocketHandshake,
  SocketTransportKind,
} from '../application/ports/socket-transport.port';

/**
 * What a refusal says, one sentence per cause, total over the union.
 *
 * A TOTAL RECORD RATHER THAN A LOOKUP WITH A DEFAULT. A sixth cause arriving in `@openref/core`
 * fails this file's compile, which is the only way a new cause cannot ship with no sentence.
 *
 * PRIVATE, AND THAT IS THE `T028` SHAPE MEASURED RATHER THAN GUESSED AT. `credentials.ts` keeps its
 * own `UNSENDABLE` record private and `AuthPanel.ts` keeps a second, deliberately different one,
 * because a refusal is about a value that will not be sent and a page is about a scheme that cannot
 * be exercised. T055 first exported this record through a `handshakeBlockSentence` accessor and a
 * `handshakeBlocks` helper; a blind review found both with no production reader, and exporting them
 * would have invited a page to draw the refusal's words, which are the wrong words for a page. What
 * keeps the two halves from drifting is not a shared accessor but the shared union: this record and
 * the renderer's are each total over `HandshakeBlockedCause`, so a sixth cause fails both compiles.
 * Listing the blocked schemes of a channel is `handshakeBlockedCause` in a loop, which `useSocket`
 * does over the document and the channel page does over its own models, each with what it has.
 */
const BLOCKED: Readonly<Record<HandshakeBlockedCause, string>> = {
  'handshake-header':
    'it travels in a request header at the handshake, and a native WebSocket cannot set one; the server bridge is the only route',
  'connection-credential':
    'it is a credential of the broker connection, and a browser socket has no field for it; the server bridge is the only route',
  'transport-certificate':
    'it is a client certificate chosen during the TLS handshake, which the browser chooses and no code on the page takes part in',
  'message-encryption':
    'it encrypts the messages themselves rather than the connection, so a handshake has nowhere to carry it',
  undeclared:
    'the document does not say where this scheme travels, so nothing can place it at a handshake',
};

/** What building a handshake needs. */
export interface SocketHandshakeInput {
  /** The socket address, `ws://` or `wss://`, already resolved against the server. */
  readonly address: string;
  readonly transport: SocketTransportKind;
  /** Schemes the channel requires, resolved against the document's own table. */
  readonly schemes: readonly RunnableSecurityScheme[];
  /** What the reader supplied, keyed by scheme id. An absent or empty value is not supplied. */
  readonly credentials: Readonly<Record<string, string>>;
  /** `Sec-WebSocket-Protocol` values the caller wants offered. */
  readonly protocols?: readonly string[];
  /** Query parameters the caller adds on top of whatever the schemes contribute. */
  readonly query?: readonly (readonly [string, string])[];
}

/**
 * Builds the handshake, or refuses a supplied value that cannot travel in one.
 *
 * @param input - The address, the transport, the schemes and what the reader supplied
 * @returns The handshake, ready for a transport
 * @throws {AuthError} When the reader supplied a value for a scheme a browser cannot present
 *
 * @example
 * const handshake = buildHandshake({ address, transport: 'native', schemes, credentials });
 */
export function buildHandshake(input: SocketHandshakeInput): SocketHandshake {
  const query: (readonly [string, string])[] = [...(input.query ?? [])];
  const auth: Record<string, string> = {};

  for (const scheme of input.schemes) {
    const value = input.credentials[scheme.id] ?? '';
    if (value === '') continue;

    const cause = handshakeBlockedCause(scheme);
    if (cause !== undefined) {
      throw new AuthError(
        `security scheme '${scheme.id}' holds a value that cannot reach a socket handshake: ${BLOCKED[cause]}`,
        ErrorCode.RUN_AUTH_FAILED,
        undefined,
        { schemeId: scheme.id, type: scheme.type, cause },
      );
    }

    // WHAT IS LEFT IS EXACTLY THE TWO FORMS SPEC 14.7 ADMITS. A key in the query is part of the
    // address; a key in a cookie is sent by the browser itself and there is nothing to place, so
    // it contributes no value here and is not an omission. Anything else was refused above.
    if (scheme.in === 'query') {
      const name = scheme.name ?? '';
      if (name === '') {
        throw new AuthError(
          `security scheme '${scheme.id}' puts its key in the query and names no parameter`,
          ErrorCode.RUN_AUTH_FAILED,
          undefined,
          { schemeId: scheme.id },
        );
      }

      // SOCKET.IO GETS THE SAME PAIR IN ITS OWN PAYLOAD AS WELL AS IN THE ADDRESS, per SPEC 14.7.
      // `auth` is the mechanism its own server side reads, and the query is what a proxy in front
      // of it sees; sending one and not the other would work against half the deployments.
      if (input.transport === 'socket.io') auth[name] = value;
      query.push([name, value]);
    }
  }

  return {
    kind: input.transport,
    url: appendQuery(input.address, query),
    protocols: input.protocols ?? [],
    auth,
  };
}

/**
 * Puts the query pairs on the address, keeping whatever query the address already had.
 *
 * WRITTEN OUT RATHER THAN THROUGH `URL`, because an address with a template variable still in it
 * is not a url `URL` will parse, and a reader who has not filled a variable in should get the
 * transport's own refusal about the address rather than a parser error from the credential layer.
 */
function appendQuery(address: string, query: readonly (readonly [string, string])[]): string {
  if (query.length === 0) return address;

  const encoded = query
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('&');

  const separator = address.includes('?') ? '&' : '?';

  return `${address}${separator}${encoded}`;
}

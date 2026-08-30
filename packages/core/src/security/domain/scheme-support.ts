/**
 * Which security schemes a browser cannot send, and the sentence that says why.
 *
 * IN `core` FOR THE REASON THE SOURCE LINK EXPANSION IS, and it is the same shape of decision. The
 * rule has two consumers on opposite sides of the dependency graph: `@openref/runner` asks it when
 * there is a value to send, so that a value which cannot travel is refused rather than dropped on
 * the way out, and `@openref/vue` asks it while projecting an operation, so that the console draws
 * a row with a sentence in it instead of nothing at all. `runner` and `vue` cannot see each other,
 * so a copy in each would be two policies that disagree the first time one is edited, silently,
 * because each would have its own green tests.
 *
 * AN UNSUPPORTED SCHEME RENDERING AS ABSENT IS THE FAILURE THIS EXISTS TO PREVENT. A reader who
 * sees no field for `mutualTLS` learns nothing; a reader who sees the scheme named with the reason
 * beside it knows the console is complete and the API needs a client certificate.
 */

/** The part of a security scheme this question is answered from. */
export interface SecuritySchemeShape {
  readonly type: string;
  /** Where an `apiKey` travels. */
  readonly in?: string;
  /** HTTP authentication scheme, for `http`. */
  readonly scheme?: string;
}

/**
 * Why a browser cannot send a scheme, as a cause rather than as a sentence.
 *
 * `mutual-tls` needs a client certificate chosen during the TLS handshake, which no code on the
 * page takes part in, and nothing later changes that. `cookie-api-key` and `http-challenge` are
 * unsendable in direct mode: `Cookie` is a forbidden header name, and digest and negotiate are a
 * challenge and response the browser performs itself. The same origin proxy of SPEC 14.5 removes
 * the first of those two.
 */
export type UnsendableCause = 'mutual-tls' | 'cookie-api-key' | 'http-challenge';

/**
 * Why a browser cannot send this scheme, or undefined when it can.
 *
 * A CAUSE AND NOT THE SENTENCE, and the reason is where each of the two belongs. The rule is a
 * fact about the platform and lives here, where both `@openref/runner` and `@openref/vue` can ask
 * it; the words a reader sees are the interface's, so they live with the interface and a theme can
 * say them differently. Carrying the prose here also put three English sentences into the first
 * chunk of every page, because this is reachable from the projection.
 *
 * @param scheme - The scheme as the document declares it
 * @returns The cause, or undefined when the scheme can be sent
 *
 * @example
 * unsendableSchemeCause({ type: 'mutualTLS' });
 */
export function unsendableSchemeCause(scheme: SecuritySchemeShape): UnsendableCause | undefined {
  if (scheme.type === 'mutualTLS') return 'mutual-tls';
  if (scheme.type === 'apiKey' && scheme.in === 'cookie') return 'cookie-api-key';

  if (scheme.type === 'http') {
    const named = (scheme.scheme ?? '').toLowerCase();
    if (named !== 'basic' && named !== 'bearer') return 'http-challenge';
  }

  return undefined;
}

/**
 * Why a browser cannot present a scheme when it opens a socket, per SPEC 14.7.
 *
 * A SECOND QUESTION AND NOT THE SAME ONE, which is why it is a second union. `unsendableSchemeCause`
 * asks what a `fetch` cannot carry; this asks what a WebSocket handshake cannot carry, and the two
 * answers differ in both directions. A bearer token is an ordinary header to `fetch` and impossible
 * to a native `WebSocket`, which cannot set one at all. An `apiKey` in a cookie is refused by
 * `fetch` and is exactly what the browser sends by itself at a handshake.
 *
 * EACH CAUSE NAMES A DIFFERENT ROUTE, so they are not collapsed into one. The server bridge of SPEC
 * 14.8 answers the first two; a certificate is held by whoever opens the connection; message
 * encryption is not a handshake at all; and a document that did not say where a key travels is
 * fixed by editing the document. One cause with one sentence would have to point somewhere for all
 * five, and four of those pointers would be false.
 */
export type HandshakeBlockedCause =
  /** Rides a request header at the handshake, which a native `WebSocket` cannot set. */
  | 'handshake-header'
  /** A credential of the broker connection itself, which a browser socket has no field for. */
  | 'connection-credential'
  /** A client certificate chosen by the browser during the TLS handshake. */
  | 'transport-certificate'
  /** Key material for the messages rather than for the connection. */
  | 'message-encryption'
  /** The document does not say enough to place a value at all. */
  | 'undeclared';

/**
 * Where an `apiKey` can travel at a handshake: the address, or the browser's own cookie jar.
 *
 * `header` IS DELIBERATELY NOT HERE and neither is an absent location. The first is the whole
 * subject of SPEC 14.7 and the second is a document that did not say, which is `undeclared`.
 */
const HANDSHAKE_KEY_LOCATIONS: readonly string[] = ['query', 'cookie'];

/** Scheme types whose credential belongs to the connection rather than to a request header. */
const CONNECTION_CREDENTIAL_TYPES: readonly string[] = [
  'userPassword',
  'plain',
  'scramSha256',
  'scramSha512',
  'gssapi',
];

/**
 * Why a browser cannot present this scheme at a socket handshake, or undefined when it can.
 *
 * THE ANSWER FOR AN UNREADABLE SCHEME IS A CAUSE AND NEVER `undefined`. A requirement naming a
 * scheme the document never declared reaches this with a type nothing recognises, and returning
 * "a browser can present it" for a scheme nobody can read is a check defaulting to success. It
 * answers `undeclared` instead, which is both what is true and what a reader can act on.
 *
 * @param scheme - The scheme as the document declares it
 * @returns The cause, or undefined when a browser can present it at the handshake
 *
 * @example
 * handshakeBlockedCause({ type: 'http', scheme: 'bearer' });
 */
export function handshakeBlockedCause(
  scheme: SecuritySchemeShape,
): HandshakeBlockedCause | undefined {
  if (scheme.type === 'apiKey' || scheme.type === 'httpApiKey') {
    if (scheme.in === undefined || scheme.in === '') return 'undeclared';
    if (HANDSHAKE_KEY_LOCATIONS.includes(scheme.in)) return undefined;
    if (scheme.in === 'header') return 'handshake-header';

    // AsyncAPI's own `apiKey` puts the key in the connection's user or password field, per SPEC
    // 8.2, and a browser socket has neither. Any location outside the five the IR knows lands
    // here too, because a location this file cannot place is not a location it may ignore.
    return 'connection-credential';
  }

  if (scheme.type === 'http' || scheme.type === 'oauth2' || scheme.type === 'openIdConnect') {
    return 'handshake-header';
  }

  if (scheme.type === 'mutualTLS' || scheme.type === 'X509') return 'transport-certificate';

  if (scheme.type === 'symmetricEncryption' || scheme.type === 'asymmetricEncryption') {
    return 'message-encryption';
  }

  if (CONNECTION_CREDENTIAL_TYPES.includes(scheme.type)) return 'connection-credential';

  return 'undeclared';
}

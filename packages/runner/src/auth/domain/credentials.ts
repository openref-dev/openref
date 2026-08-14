/**
 * Credentials: what a scheme contributes to a request, and where the value is kept.
 *
 * SPEC 14.4 lists every scheme the runner supports, and since T028 the list is complete: `apiKey`
 * in a header or a query parameter, `http` basic and bearer, and the OAuth2 family, whose access
 * token is a credential like any other once it has been obtained. What obtains it is
 * `oauth-session.service.ts`; what this file knows is that a token in the store becomes a bearer
 * header, which is why `oauth2` and `openIdConnect` need three lines here rather than a module.
 *
 * TWO SCHEMES CANNOT BE SENT FROM A BROWSER AND THE TWO ARE NOT THE SAME KIND OF CANNOT. An
 * `apiKey` in a cookie is unsendable in direct mode because `Cookie` is a forbidden header name
 * and `fetch` drops it, exactly as a cookie parameter is, and the same origin proxy of T029
 * removes both. `mutualTLS` needs a client certificate the browser chooses at the TLS handshake,
 * which no code on the page participates in, and nothing later removes that.
 */

import { AuthError, ErrorCode, unsendableSchemeCause, type UnsendableCause } from '@openref/core';
import type { AuthContribution, RunnableSecurityScheme } from '../../request/domain/request-plan';
import { base64Text } from './base64';

/**
 * What a refusal says, one sentence per cause.
 *
 * THE CAUSE IS `core`'S AND THE WORDS ARE THIS PACKAGE'S. The rule about what a browser can send
 * is a fact both this package and the console need, so it lives upstream of both; the sentence
 * here is about a value that will not be sent, and the console's is about a scheme that cannot be
 * used, which are two different things to tell a reader.
 */
const UNSENDABLE: Readonly<Record<UnsendableCause, string>> = {
  'mutual-tls':
    'mutualTLS presents a client certificate during the TLS handshake, which the browser chooses',
  'cookie-api-key':
    'Cookie is a header a browser will not let a script set; the same origin proxy of T029 removes this',
  'http-challenge':
    'this http scheme is a challenge and response the browser performs itself, and a page cannot supply it',
};

/** Where a credential is kept between reloads, per SPEC 14.4. */
export type CredentialStorageMode = 'memory' | 'session' | 'local' | 'off';

/** Default storage, per SPEC 14.4. */
export const DEFAULT_CREDENTIAL_STORAGE: CredentialStorageMode = 'session';

/**
 * The part of `Storage` this package uses, said structurally.
 *
 * The same technique as `shared/dom.ts` in the renderer, and for the same reason: this package
 * compiles without the DOM lib, so it names what it touches instead of depending on a global
 * type. Anything with these three methods satisfies it, which is what makes storage testable
 * with a plain object.
 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Prefix every stored key carries, so a host page's own keys are never touched. */
export const CREDENTIAL_KEY_PREFIX = 'oref.credential.';

function storageFor(mode: CredentialStorageMode): KeyValueStorage | null {
  if (mode === 'session' || mode === 'local') {
    const global = globalThis as { sessionStorage?: unknown; localStorage?: unknown };
    const candidate = mode === 'session' ? global.sessionStorage : global.localStorage;

    if (candidate === null || typeof candidate !== 'object') return null;

    const store = candidate as Partial<KeyValueStorage>;
    return typeof store.getItem === 'function' && typeof store.setItem === 'function'
      ? (candidate as KeyValueStorage)
      : null;
  }

  return null;
}

/**
 * Holds credentials for the length of a session, or not at all.
 *
 * `off` is not an empty implementation of the other three: it reads back nothing it was given,
 * so a caller cannot tell "stored and unavailable" from "never stored" and therefore cannot
 * accidentally rely on it. `memory` keeps values for the life of the page and loses them on
 * reload, which is what a reader expects of a console they did not ask to remember anything.
 */
export class CredentialStore {
  private readonly memory = new Map<string, string>();
  private readonly backing: KeyValueStorage | null;

  /**
   * @param mode - Storage mode, defaulting to `session` per SPEC 14.4
   * @param storage - Backing storage, defaulting to the one the mode names on `globalThis`
   */
  constructor(
    public readonly mode: CredentialStorageMode = DEFAULT_CREDENTIAL_STORAGE,
    storage?: KeyValueStorage,
  ) {
    this.backing = mode === 'off' || mode === 'memory' ? null : (storage ?? storageFor(mode));
  }

  /**
   * Reads the credential for one scheme.
   *
   * @param schemeId - Id of the security scheme
   * @returns The value, or undefined when there is none
   */
  read(schemeId: string): string | undefined {
    if (this.mode === 'off') return undefined;

    const stored = this.backing?.getItem(CREDENTIAL_KEY_PREFIX + schemeId);
    if (stored !== null && stored !== undefined) return stored;

    return this.memory.get(schemeId);
  }

  /**
   * Writes the credential for one scheme. An empty value clears it.
   *
   * @param schemeId - Id of the security scheme
   * @param value - The credential as the reader typed it
   */
  write(schemeId: string, value: string): void {
    if (this.mode === 'off') return;

    if (value === '') {
      this.memory.delete(schemeId);
      this.backing?.removeItem(CREDENTIAL_KEY_PREFIX + schemeId);
      return;
    }

    this.memory.set(schemeId, value);
    this.backing?.setItem(CREDENTIAL_KEY_PREFIX + schemeId, value);
  }
}

/**
 * Turns the credentials a reader supplied into headers and query values.
 *
 * A scheme with no credential contributes nothing and is not an error. Sending an authenticated
 * operation with no credential and reading the 401 is a legitimate thing to try, and refusing
 * it would make the console unable to demonstrate the API's own behaviour. That is also why an
 * unsendable scheme with no value is passed over rather than refused: an operation whose document
 * offers `mutualTLS` or a bearer token is one a reader may still send with the bearer.
 *
 * @param schemes - Security schemes the operation requires
 * @param credentials - Values keyed by scheme id
 * @returns Headers and query values to add to the request
 * @throws {AuthError} When a scheme carries a value a browser cannot send
 *
 * @example
 * const auth = applyCredentials(operation.security, { bearer: 'token' });
 */
export function applyCredentials(
  schemes: readonly RunnableSecurityScheme[],
  credentials: Readonly<Record<string, string>>,
): AuthContribution {
  const headers: Record<string, string> = {};
  const query: (readonly [string, string])[] = [];

  for (const scheme of schemes) {
    const value = credentials[scheme.id] ?? '';
    if (value === '') continue;

    const unsendable = unsendableSchemeCause(scheme);
    if (unsendable !== undefined) {
      throw new AuthError(
        `security scheme '${scheme.id}' holds a value that cannot be sent: ${UNSENDABLE[unsendable]}`,
        ErrorCode.RUN_AUTH_FAILED,
        undefined,
        { schemeId: scheme.id, type: scheme.type },
      );
    }

    if (scheme.type === 'apiKey') {
      applyApiKey(scheme, value, headers, query);
      continue;
    }

    if (scheme.type === 'http') {
      applyHttp(scheme, value, headers);
      continue;
    }

    // AN OAUTH2 OR OPENID CONNECT CREDENTIAL IS AN ACCESS TOKEN AND TRAVELS AS A BEARER. RFC 6750
    // is what says so, and the token type the token endpoint reported is not consulted: the one
    // other type in use, `mac`, was never standardised and no server this console can reach issues
    // one. A scheme type nothing above ever produces lands here too, and a bearer header is the
    // reading that sends the reader's own credential and nothing else.
    headers.Authorization = `Bearer ${value}`;
  }

  return { headers, query };
}

function applyApiKey(
  scheme: RunnableSecurityScheme,
  value: string,
  headers: Record<string, string>,
  query: (readonly [string, string])[],
): void {
  const name = scheme.name ?? '';
  if (name === '') {
    throw new AuthError(
      `security scheme '${scheme.id}' is an apiKey that names no header or query parameter`,
      ErrorCode.RUN_AUTH_FAILED,
      undefined,
      { schemeId: scheme.id },
    );
  }

  if (scheme.in === 'header') {
    headers[name] = value;
    return;
  }

  if (scheme.in === 'query') {
    query.push([name, value]);
    return;
  }

  // Unreachable while `unsendableReason` runs first: a cookie apiKey is refused there, with the
  // sentence the console renders. Left as a refusal rather than a default so that a third
  // location arriving in a later OpenAPI does not silently become a header.
  throw new AuthError(
    `security scheme '${scheme.id}' carries its apiKey in '${scheme.in ?? ''}', which is neither ` +
      'a header nor a query parameter',
    ErrorCode.RUN_AUTH_FAILED,
    undefined,
    { schemeId: scheme.id, in: scheme.in ?? '' },
  );
}

/**
 * Applies `http` basic or bearer.
 *
 * BASIC IS STORED AS `user:password` AND ENCODED HERE. RFC 7617 defines the credential as exactly
 * that pair joined by a colon, so the store holds what the scheme is made of rather than a second
 * shape that has to be taken apart. A value with no colon in it is a user name with an empty
 * password, which is what a reader who filled one field of two meant, and it is what the RFC's own
 * grammar allows.
 */
function applyHttp(
  scheme: RunnableSecurityScheme,
  value: string,
  headers: Record<string, string>,
): void {
  const named = (scheme.scheme ?? '').toLowerCase();

  headers.Authorization = named === 'basic' ? `Basic ${base64Text(value)}` : `Bearer ${value}`;
}

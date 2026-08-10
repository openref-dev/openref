/**
 * Credentials: what M0 carries, what it refuses, and where a value is kept.
 *
 * SPEC 14.4 lists every scheme the runner eventually supports and SPEC 14.1 cuts M0 down to
 * `apiKey` and `http bearer`. Everything else is refused by name rather than ignored, because a
 * request sent without the credential the operation requires comes back 401 and reads as an API
 * defect rather than as a missing feature.
 *
 * TWO REFUSALS ARE PERMANENT RATHER THAN "UNTIL M2". An `apiKey` in a cookie cannot be set by a
 * script at all, and `mutualTLS` needs a client certificate the browser chooses, not the page.
 * Both say so in their message instead of promising a milestone that will not fix them.
 */

import { AuthError, ErrorCode } from '@openref/core';
import type { AuthContribution, RunnableSecurityScheme } from '../../request/domain/request-plan';

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
 * it would make the console unable to demonstrate the API's own behaviour.
 *
 * @param schemes - Security schemes the operation requires
 * @param credentials - Values keyed by scheme id
 * @returns Headers and query values to add to the request
 * @throws {AuthError} When a scheme is outside the M0 subset and has a credential to apply
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

    if (scheme.type === 'apiKey') {
      applyApiKey(scheme, value, headers, query);
      continue;
    }

    if (scheme.type === 'http') {
      applyHttp(scheme, value, headers);
      continue;
    }

    throw new AuthError(unsupportedMessage(scheme), ErrorCode.RUN_AUTH_FAILED, undefined, {
      schemeId: scheme.id,
      type: scheme.type,
    });
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

  throw new AuthError(
    `security scheme '${scheme.id}' carries its apiKey in a cookie, which a browser will not ` +
      'let a script set; a cookie credential has to be set by the site itself',
    ErrorCode.RUN_AUTH_FAILED,
    undefined,
    { schemeId: scheme.id, in: scheme.in ?? '' },
  );
}

function applyHttp(
  scheme: RunnableSecurityScheme,
  value: string,
  headers: Record<string, string>,
): void {
  if ((scheme.scheme ?? '').toLowerCase() !== 'bearer') {
    throw new AuthError(
      `security scheme '${scheme.id}' is http '${scheme.scheme ?? ''}', and M0 carries bearer ` +
        'only; the remaining http schemes arrive in M2',
      ErrorCode.RUN_AUTH_FAILED,
      undefined,
      { schemeId: scheme.id, scheme: scheme.scheme ?? '' },
    );
  }

  headers.Authorization = `Bearer ${value}`;
}

function unsupportedMessage(scheme: RunnableSecurityScheme): string {
  if (scheme.type === 'mutualTLS') {
    return `security scheme '${scheme.id}' is mutualTLS, which a page cannot present a client certificate for`;
  }

  return (
    `security scheme '${scheme.id}' is '${scheme.type}', and M0 carries apiKey and http bearer ` +
    'only; oauth2 and openIdConnect arrive in M2'
  );
}

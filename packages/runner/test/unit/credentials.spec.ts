import { AuthError, ErrorCode } from '@openref/core';
import { describe, expect, it } from 'vitest';
import {
  applyCredentials,
  CREDENTIAL_KEY_PREFIX,
  CredentialStore,
  DEFAULT_CREDENTIAL_STORAGE,
  type KeyValueStorage,
} from '../../src/index';
import { API_KEY_HEADER, API_KEY_QUERY, BEARER, OAUTH } from '../mocks/operations';

/** A plain object standing in for `sessionStorage`, which is all the store asks for. */
function fakeStorage(): KeyValueStorage & { readonly entries: Map<string, string> } {
  const entries = new Map<string, string>();

  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

describe('applyCredentials', () => {
  it('should put an http bearer token in the Authorization header', () => {
    // Given
    const schemes = [BEARER];

    // When
    const auth = applyCredentials(schemes, { bearerAuth: 'token-value' });

    // Then
    expect(auth.headers).toEqual({ Authorization: 'Bearer token-value' });
    expect(auth.query).toEqual([]);
  });

  it('should put an apiKey in the header the scheme names', () => {
    // Given
    const schemes = [API_KEY_HEADER];

    // When
    const auth = applyCredentials(schemes, { apiKey: 'k' });

    // Then
    expect(auth.headers).toEqual({ 'X-Key': 'k' });
  });

  it('should put an apiKey in the query parameter the scheme names', () => {
    // Given
    const schemes = [API_KEY_QUERY];

    // When
    const auth = applyCredentials(schemes, { apiKeyQuery: 'k' });

    // Then
    expect(auth.query).toEqual([['access_token', 'k']]);
    expect(auth.headers).toEqual({});
  });

  it('should contribute nothing for a scheme with no credential rather than refuse to send', () => {
    // Given, sending without a credential and reading the 401 is a legitimate thing to try.
    const schemes = [BEARER, API_KEY_HEADER];

    // When
    const auth = applyCredentials(schemes, {});

    // Then
    expect(auth).toEqual({ headers: {}, query: [] });
  });

  it('should refuse http basic and name the milestone', () => {
    // Given
    const schemes = [{ id: 'basic', type: 'http', scheme: 'basic' }];

    // When
    const apply = (): unknown => applyCredentials(schemes, { basic: 'x' });

    // Then
    expect(apply).toThrow(AuthError);
    expect(apply).toThrow(/M2/);
  });

  it('should refuse oauth2 and name the milestone', () => {
    // Given
    const schemes = [OAUTH];

    // When
    const apply = (): unknown => applyCredentials(schemes, { oauth: 'x' });

    // Then
    expect(apply).toThrow(AuthError);
    expect(apply).toThrow(/oauth2/);
  });

  it('should refuse mutualTLS as impossible rather than as unfinished', () => {
    // Given, SPEC 14.4 says it is recognised and unsupported in a browser, and no milestone
    // changes that: the certificate is the browser's to choose, not the page's.
    const schemes = [{ id: 'mtls', type: 'mutualTLS' }];

    // When
    const apply = (): unknown => applyCredentials(schemes, { mtls: 'x' });

    // Then
    expect(apply).toThrow(AuthError);
    expect(apply).toThrow(/client certificate/);
    expect(apply).not.toThrow(/M2/);
  });

  it('should refuse an apiKey carried in a cookie as impossible rather than as unfinished', () => {
    // Given
    const schemes = [{ id: 'cookieKey', type: 'apiKey', in: 'cookie', name: 'sid' }];

    // When
    const apply = (): unknown => applyCredentials(schemes, { cookieKey: 'x' });

    // Then
    expect(apply).toThrow(AuthError);
    expect(apply).toThrow(/cookie/);
  });

  it('should refuse an apiKey scheme that names no header or query parameter', () => {
    // Given
    const schemes = [{ id: 'nameless', type: 'apiKey', in: 'header' }];

    // When
    let thrown: unknown;
    try {
      applyCredentials(schemes, { nameless: 'x' });
    } catch (error: unknown) {
      thrown = error;
    }

    // Then
    expect((thrown as AuthError).code).toBe(ErrorCode.RUN_AUTH_FAILED);
  });
});

describe('CredentialStore', () => {
  it('should default to session storage, per SPEC 14.4', () => {
    // Given
    const expected = 'session';

    // When
    const actual = DEFAULT_CREDENTIAL_STORAGE;

    // Then
    expect(actual).toBe(expected);
  });

  it('should write through to the backing storage under a prefixed key', () => {
    // Given
    const storage = fakeStorage();
    const store = new CredentialStore('session', storage);

    // When
    store.write('bearerAuth', 'token');

    // Then
    expect(store.read('bearerAuth')).toBe('token');
    expect(storage.entries.get(`${CREDENTIAL_KEY_PREFIX}bearerAuth`)).toBe('token');
  });

  it('should clear a credential when the value is empty', () => {
    // Given
    const storage = fakeStorage();
    const store = new CredentialStore('session', storage);
    store.write('bearerAuth', 'token');

    // When
    store.write('bearerAuth', '');

    // Then
    expect(store.read('bearerAuth')).toBeUndefined();
    expect(storage.entries.size).toBe(0);
  });

  it('should keep a memory credential without touching any storage', () => {
    // Given
    const storage = fakeStorage();
    const store = new CredentialStore('memory', storage);

    // When
    store.write('bearerAuth', 'token');

    // Then
    expect(store.read('bearerAuth')).toBe('token');
    expect(storage.entries.size).toBe(0);
  });

  it('should read back nothing at all when storage is off', () => {
    // Given, `off` is not an empty implementation of the others: a caller cannot tell "stored
    // and unavailable" from "never stored", so it cannot come to rely on it.
    const storage = fakeStorage();
    const store = new CredentialStore('off', storage);

    // When
    store.write('bearerAuth', 'token');

    // Then
    expect(store.read('bearerAuth')).toBeUndefined();
    expect(storage.entries.size).toBe(0);
  });

  it('should fall back to memory when the named storage is not there', () => {
    // Given, a server render has no sessionStorage and must not throw for the lack of one.
    const store = new CredentialStore('session');

    // When
    store.write('bearerAuth', 'token');

    // Then
    expect(store.read('bearerAuth')).toBe('token');
  });
});

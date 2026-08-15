/**
 * The regression suite of T035's first finding: a redirect flow finishing on a page that never
 * started it.
 *
 * WHAT MADE THE DEFECT INVISIBLE IS WHAT THIS FILE REFUSES TO DO. Every existing case holds one
 * `OAuthSessionService` across `signIn` and `completeAuthorization`, because in jsdom and under
 * Node there is nothing to stop it. A browser stops it: the reader leaves for the authorization
 * server and returns to a new document with a new runner, so the service that wrote the pending
 * record is not the service that reads it. Each case here builds the second service separately,
 * sharing only what a browser shares, which is `sessionStorage`.
 */

import { describe, expect, it } from 'vitest';
import { AuthError } from '@openref/core';
import { CredentialStore, OAuthSessionService } from '../../src/index';
import type { RunnableOAuthFlow } from '../../src/index';

/** A storage that survives, the way `sessionStorage` survives a navigation. */
function storage(): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly raw: Map<string, string>;
} {
  const raw = new Map<string, string>();

  return {
    raw,
    getItem: (key) => raw.get(key) ?? null,
    setItem: (key, value) => void raw.set(key, value),
    removeItem: (key) => void raw.delete(key),
  };
}

/**
 * The real credential store over a storage of our own.
 *
 * THE REAL ONE RATHER THAN A SHAPE THAT LOOKS LIKE IT, because what the access token does on its
 * way in is part of what these cases are about, and a hand written pair of methods would be the
 * test asserting against itself.
 */
function credentialStore(): CredentialStore {
  const values = new Map<string, string>();

  return new CredentialStore('session', {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  });
}

const FLOW: RunnableOAuthFlow = {
  kind: 'authorizationCode',
  authorizationUrl: 'https://issuer.example/authorize',
  tokenUrl: 'https://issuer.example/token',
  scopes: ['orders:read'],
};

/** One service, as a fresh page load builds one. */
function serviceOn(
  pendingStorage: ReturnType<typeof storage>,
  send: (plan: unknown) => Promise<{ status: number; body: string }>,
): OAuthSessionService {
  return new OAuthSessionService({
    transport: { send: send as never },
    store: credentialStore(),
    storage: 'session',
    pendingStorage,
    random: (length: number) => new Uint8Array(length).fill(7),
  });
}

describe('a redirect flow that returns to a new page', () => {
  it('should complete the exchange on a service that never ran the sign in', async () => {
    // Given a page that started the flow and then went away
    const pending = storage();
    const first = serviceOn(pending, () => Promise.resolve({ status: 200, body: '{}' }));
    const outcome = await first.signIn(
      'oauth',
      FLOW,
      { clientId: 'public-client' },
      {
        redirectUri: 'https://docs.example/docs/_oauth/callback',
        returnPath: '/docs/orders',
      },
    );

    if (outcome.kind !== 'redirect') throw new Error('the flow did not redirect');
    const state = new URL(outcome.url).searchParams.get('state') ?? '';

    // When the reader lands on a new document, whose runner is a new object
    const sent: { url?: string; body?: string }[] = [];
    const second = serviceOn(pending, (plan) => {
      sent.push(plan as { url?: string; body?: string });
      return Promise.resolve({
        status: 200,
        body: JSON.stringify({ access_token: 'granted', token_type: 'Bearer' }),
      });
    });

    const landed = await second.completeAuthorization({ code: 'the-code', state });

    // Then the exchange happened, against the url the document declared, and the reader is sent
    // back where they were. Before T035 this refused with `this page has no record of the flow`.
    expect(landed).toEqual({ schemeId: 'oauth', returnPath: '/docs/orders' });
    expect(sent[0]?.url).toBe('https://issuer.example/token');
    expect(sent[0]?.body).toContain('code=the-code');
    expect(second.status('oauth').signedIn).toBe(true);
  });

  it('should never write the client secret into the storage the record lives in', async () => {
    // Given a sign in a reader supplied a secret for
    const pending = storage();
    const service = serviceOn(pending, () => Promise.resolve({ status: 200, body: '{}' }));

    await service.signIn(
      'oauth',
      FLOW,
      { clientId: 'confidential', clientSecret: 'the-secret-value' },
      { redirectUri: 'https://docs.example/docs/_oauth/callback', returnPath: '/docs/orders' },
    );

    // Then nothing in what was written carries it. This store is readable by any script on the
    // origin, which is the whole reason SPEC 14.4 separates a credential from a public fact.
    const written = [...pending.raw.values()].join('\n');
    expect(written).not.toContain('the-secret-value');
    expect(written).toContain('confidential');
    expect(written).toContain('https://issuer.example/token');
  });

  it('should refuse a confidential client by name rather than exchanging without its secret', async () => {
    // Given a sign in with a secret, and the new page a redirect lands on
    const pending = storage();
    const first = serviceOn(pending, () => Promise.resolve({ status: 200, body: '{}' }));
    const outcome = await first.signIn(
      'oauth',
      FLOW,
      { clientId: 'confidential', clientSecret: 'the-secret-value' },
      { redirectUri: 'https://docs.example/docs/_oauth/callback', returnPath: '/docs/orders' },
    );

    if (outcome.kind !== 'redirect') throw new Error('the flow did not redirect');
    const state = new URL(outcome.url).searchParams.get('state') ?? '';

    let called = false;
    const second = serviceOn(pending, () => {
      called = true;
      return Promise.resolve({ status: 200, body: '{}' });
    });

    // When the reader comes back
    const failure = await second
      .completeAuthorization({ code: 'the-code', state })
      .then(() => null)
      .catch((cause: unknown) => cause);

    // Then the reason is the storage policy and not the server's opinion, and no request carrying
    // half a client was ever sent
    expect(failure).toBeInstanceOf(AuthError);
    expect((failure as AuthError).message).toContain('did not survive the redirect');
    expect(called).toBe(false);
  });

  it('should drop a pending record whose flow is not shaped like one', async () => {
    // Given a record somebody else wrote into this origin's storage
    const pending = storage();
    pending.setItem(
      'oref.oauth.pending',
      JSON.stringify({ schemeId: 'oauth', state: 'x', runnableFlow: 'not-an-object' }),
    );

    const service = serviceOn(pending, () => Promise.resolve({ status: 200, body: '{}' }));

    // When a landing reads it
    const landed = await service.completeAuthorization({ code: 'c', state: 'x' });

    // Then it is dropped rather than repaired, and the record does not survive to be read again
    expect(landed).toBeUndefined();
    expect(pending.raw.size).toBe(0);
  });
});

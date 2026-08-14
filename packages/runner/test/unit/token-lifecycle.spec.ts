import { AuthError } from '@openref/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRunner,
  CREDENTIAL_KEY_PREFIX,
  PENDING_AUTHORIZATION_KEY,
  type CredentialStorageMode,
  type RunnableOperation,
  type RunnableOAuthFlow,
} from '../../src/index';
import {
  AUTHORIZE_URL,
  CLIENT_FLOW,
  CODE_FLOW,
  DEVICE_FLOW,
  DEVICE_URL,
  IMPLICIT_FLOW,
  PASSWORD_FLOW,
  ScriptedTransport,
  TOKEN_URL,
  fakeStorage,
  fixedRandom,
  reply,
  tokenReply,
} from '../mocks/oauth';
import { operation, OAUTH } from '../mocks/operations';

/**
 * The token lifecycle of SPEC 14.4.1, one clause per case.
 *
 * WHAT IS BEING TESTED IS MOSTLY A COUNT, and that is deliberate. "One refresh and one retry,
 * never a loop" is not a property a reader can see in a message; it is the number of requests that
 * left. So the transport records every plan and the assertions are on how many went where, which
 * is what makes a loop fail here rather than be caught in review.
 */

const API = 'https://api.example.com';
const ORDERS = `${API}/orders`;

/** An operation guarded by the oauth2 scheme, so a 401 on it can mean an expired session. */
function guarded(): RunnableOperation {
  return operation({
    nodeId: 'get-orders',
    path: '/orders',
    parameters: [],
    security: [OAUTH],
  });
}

function runnerWith(
  transport: ScriptedTransport,
  storage: CredentialStorageMode = 'session',
  backing = fakeStorage(),
): ReturnType<typeof createRunner> {
  return createRunner({
    visibility: 'public',
    storage,
    storageBacking: backing,
    pendingStorage: backing,
    transport,
    random: fixedRandom(),
    wait: async () => Promise.resolve(),
  });
}

async function signedIn(
  transport: ScriptedTransport,
  flow: RunnableOAuthFlow = CLIENT_FLOW,
  storage: CredentialStorageMode = 'session',
  backing = fakeStorage(),
): Promise<ReturnType<typeof createRunner>> {
  const runner = runnerWith(transport, storage, backing);
  await runner.signIn('oauth', flow, {
    clientId: 'console',
    username: 'ada',
    password: 'lovelace',
  });

  return runner;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the refresh token', () => {
  it.each(['memory', 'session', 'local', 'off'] as const)(
    'should never reach the backing store under storage %s',
    async (mode) => {
      // Given, the check is over the storage object rather than over an interface that promises
      // not to write one, which is the same shape the `off` test already had.
      const backing = fakeStorage();
      const transport = new ScriptedTransport([
        tokenReply({ refresh_token: 'refresh-secret', expires_in: 60 }),
      ]);

      // When
      await signedIn(transport, CLIENT_FLOW, mode, backing);

      // Then
      const written = [...backing.entries.values()].join('|');
      expect(written).not.toContain('refresh-secret');
    },
  );

  it('should still renew from a refresh token it holds only in memory', async () => {
    // Given, the point of the rule above is that the token is unreachable rather than unused.
    const transport = new ScriptedTransport([
      tokenReply({ refresh_token: 'refresh-secret' }),
      reply(401, 'expired'),
      tokenReply({ access_token: 'access-2', refresh_token: 'refresh-2' }),
      reply(200, '{"ok":true}'),
    ]);
    const runner = await signedIn(transport, CLIENT_FLOW);

    // When
    const result = await runner.send({ operation: guarded(), serverUrl: API, values: {} });

    // Then
    expect(result.status).toBe(200);
    expect(transport.formsTo(TOKEN_URL)[1]?.get('grant_type')).toBe('refresh_token');
    expect(transport.formsTo(TOKEN_URL)[1]?.get('refresh_token')).toBe('refresh-secret');
  });
});

describe('storage off', () => {
  it('should retain no token of any kind', async () => {
    // Given, a mode in which almost nothing is kept is not a mode.
    const backing = fakeStorage();
    const transport = new ScriptedTransport([
      tokenReply({ access_token: 'access-secret', refresh_token: 'refresh-secret' }),
    ]);

    // When
    const runner = await signedIn(transport, CLIENT_FLOW, 'off', backing);

    // Then
    expect(backing.entries.size).toBe(0);
    expect(runner.credential('oauth')).toBeUndefined();
    expect(runner.sessionStatus('oauth').signedIn).toBe(false);
  });

  it.each(['memory', 'off'] as const)(
    'should refuse a redirect flow under storage %s rather than write the verifier anyway',
    async (mode) => {
      // Given, a redirect flow leaves this page and returns to a new one, so the verifier and the
      // state would have to outlive a reload, and under these two modes nothing may.
      const backing = fakeStorage();
      const runner = runnerWith(new ScriptedTransport([]), mode, backing);

      // When
      const signIn = runner.signIn(
        'oauth',
        CODE_FLOW,
        { clientId: 'console' },
        {
          redirectUri: 'https://docs.example.com/_oauth/callback',
          returnPath: '/get-orders',
        },
      );

      // Then
      await expect(signIn).rejects.toBeInstanceOf(AuthError);
      expect(backing.entries.has(PENDING_AUTHORIZATION_KEY)).toBe(false);
    },
  );
});

describe('a 401 with a session behind it', () => {
  it('should refresh once and retry once, and never loop', async () => {
    // Given, a transport that answers 401 twice: if anything loops, the counts below move.
    const transport = new ScriptedTransport([
      tokenReply({ refresh_token: 'r1' }),
      reply(401, 'expired'),
      tokenReply({ access_token: 'access-2' }),
      reply(401, 'still no'),
    ]);
    const runner = await signedIn(transport, CLIENT_FLOW);

    // When
    const result = await runner.send({ operation: guarded(), serverUrl: API, values: {} });

    // Then
    expect(transport.countTo(ORDERS)).toBe(2);
    // One sign in and one refresh, and no third call to the token endpoint.
    expect(transport.countTo(TOKEN_URL)).toBe(2);
    expect(result.status).toBe(401);
  });

  it('should report the second 401 as the API answer rather than offer another sign in', async () => {
    // Given, the token was issued a moment ago, so blaming the session for the server's decision
    // would be blaming the wrong party.
    const transport = new ScriptedTransport([
      tokenReply({ refresh_token: 'r1' }),
      reply(401, 'expired'),
      tokenReply({ access_token: 'access-2' }),
      reply(401, 'forbidden by policy'),
    ]);
    const runner = await signedIn(transport, CLIENT_FLOW);

    // When
    const result = await runner.send({ operation: guarded(), serverUrl: API, values: {} });

    // Then
    expect(result.notice?.kind).toBe('renewed');
    expect(result.notice?.message).not.toMatch(/sign in/i);
    expect(runner.sessionStatus('oauth').signedIn).toBe(true);
  });

  it('should say that the session was renewed rather than pass the pause off in silence', async () => {
    // Given
    const transport = new ScriptedTransport([
      tokenReply({ refresh_token: 'r1' }),
      reply(401, 'expired'),
      tokenReply({ access_token: 'access-2' }),
      reply(200, '{"ok":true}'),
    ]);
    const runner = await signedIn(transport, CLIENT_FLOW);

    // When
    const result = await runner.send({ operation: guarded(), serverUrl: API, values: {} });

    // Then
    expect(result.status).toBe(200);
    expect(result.notice).toEqual({
      kind: 'renewed',
      message: 'the access token had expired, so the session was renewed and the request resent',
    });
  });

  it('should answer several concurrent 401s with one refresh', async () => {
    // Given, a documentation page sends several requests in a row easily and they can all come
    // back 401 together.
    const transport = new ScriptedTransport(
      [tokenReply({ refresh_token: 'r1' })],
      reply(401, 'expired'),
    );
    const runner = await signedIn(transport, CLIENT_FLOW);
    let refreshes = 0;
    const original = transport.send.bind(transport);
    vi.spyOn(transport, 'send').mockImplementation(async (plan) => {
      if (plan.url === TOKEN_URL) refreshes += 1;
      return original(plan);
    });

    // When
    await Promise.all([
      runner.send({ operation: guarded(), serverUrl: API, values: {} }),
      runner.send({ operation: guarded(), serverUrl: API, values: {} }),
      runner.send({ operation: guarded(), serverUrl: API, values: {} }),
    ]);

    // Then
    expect(refreshes).toBe(1);
  });

  it('should leave a 401 alone when nothing was ever signed in', async () => {
    // Given, there is no session to blame and nothing to renew, so the status is the API's answer.
    const transport = new ScriptedTransport([reply(401, 'no credential')]);
    const runner = runnerWith(transport);

    // When
    const result = await runner.send({ operation: guarded(), serverUrl: API, values: {} });

    // Then
    expect(result.status).toBe(401);
    expect(result.notice).toBeUndefined();
    expect(transport.countTo(ORDERS)).toBe(1);
  });
});

describe('a refresh that fails', () => {
  it('should end the session on invalid_grant and say so', async () => {
    // Given, RFC 6749 §5.2 is the one answer that means the grant is spent.
    const transport = new ScriptedTransport([
      tokenReply({ refresh_token: 'r1' }),
      reply(401, 'expired'),
      reply(400, '{"error":"invalid_grant","error_description":"token revoked"}'),
    ]);
    const runner = await signedIn(transport, CLIENT_FLOW);

    // When
    const result = await runner.send({ operation: guarded(), serverUrl: API, values: {} });

    // Then
    expect(result.notice?.kind).toBe('session-ended');
    expect(result.notice?.message).toMatch(/token revoked/);
    expect(result.notice?.message).toMatch(/[Ss]ign in again/);
    expect(runner.sessionStatus('oauth').signedIn).toBe(false);
    // And the request is not retried, because there is nothing to retry it with.
    expect(transport.countTo(ORDERS)).toBe(1);
  });

  it.each([
    ['a 5xx', reply(503, '{}')],
    ['an unparseable answer', reply(200, 'not json at all')],
    ['a 200 with no token in it', reply(200, '{"hello":"world"}')],
  ])('should leave the session alone on %s', async (_name, answer) => {
    // Given, nothing is known about the grant here; what is known is that the packet is lost.
    const transport = new ScriptedTransport([
      tokenReply({ refresh_token: 'r1' }),
      reply(401, 'expired'),
      answer,
    ]);
    const runner = await signedIn(transport, CLIENT_FLOW);

    // When
    const result = await runner.send({ operation: guarded(), serverUrl: API, values: {} });

    // Then
    expect(result.notice?.kind).toBe('renew-failed');
    expect(result.notice?.message).toMatch(/[Tt]ry again/);
    expect(runner.sessionStatus('oauth').signedIn).toBe(true);
  });

  it('should leave the session alone when the token endpoint could not be reached', async () => {
    // Given, a dropped packet costing a reader a sign in is what makes a tool unusable on the
    // networks where it is needed most.
    const transport = new ScriptedTransport([
      tokenReply({ refresh_token: 'r1' }),
      reply(401, 'expired'),
      new Error('the request did not reach a server'),
    ]);
    const runner = await signedIn(transport, CLIENT_FLOW);

    // When
    const result = await runner.send({ operation: guarded(), serverUrl: API, values: {} });

    // Then
    expect(result.notice?.kind).toBe('renew-failed');
    expect(runner.sessionStatus('oauth').signedIn).toBe(true);
  });
});

describe('the expiry estimate', () => {
  it('should be reported from the token endpoint answer', async () => {
    // Given
    const transport = new ScriptedTransport([tokenReply({ expires_in: 3600 })]);
    const backing = fakeStorage();
    const runner = createRunner({
      visibility: 'public',
      storageBacking: backing,
      pendingStorage: backing,
      transport,
      now: () => 1_000_000,
      random: fixedRandom(),
    });
    await runner.signIn('oauth', CLIENT_FLOW, { clientId: 'console' });

    // When
    const status = runner.sessionStatus('oauth');

    // Then
    expect(status.expiresAtMs).toBe(1_000_000 + 3600 * 1000);
  });

  it('should never be a reason to refuse to send', async () => {
    // Given, a clock that says the token ran out an hour ago. The authority on whether a token is
    // alive is the API's 401, and this console's timer is not consulted.
    const transport = new ScriptedTransport([tokenReply({ expires_in: 1 }), reply(200, '{}')]);
    const backing = fakeStorage();
    let now = 1_000_000;
    const runner = createRunner({
      visibility: 'public',
      storageBacking: backing,
      pendingStorage: backing,
      transport,
      now: () => now,
      random: fixedRandom(),
    });
    await runner.signIn('oauth', CLIENT_FLOW, { clientId: 'console' });
    now += 3600 * 1000;

    // When
    const result = await runner.send({ operation: guarded(), serverUrl: API, values: {} });

    // Then
    expect(result.status).toBe(200);
    expect(transport.countTo(ORDERS)).toBe(1);
  });
});

describe('the flows with no refresh token', () => {
  it('should ask an implicit session to sign in again rather than renew it', async () => {
    // Given, an implicit flow is issued no refresh token, so there is nothing to renew with.
    const backing = fakeStorage();
    const transport = new ScriptedTransport([reply(401, 'expired')]);
    const runner = runnerWith(transport, 'session', backing);
    const outcome = await runner.signIn(
      'oauth',
      IMPLICIT_FLOW,
      { clientId: 'console' },
      {
        redirectUri: 'https://docs.example.com/_oauth/callback',
        returnPath: '/get-orders',
      },
    );
    const state = new URL(outcome.kind === 'redirect' ? outcome.url : '').searchParams.get('state');
    await runner.completeAuthorization({ access_token: 'a', state: state ?? '' });

    // When
    const result = await runner.send({ operation: guarded(), serverUrl: API, values: {} });

    // Then
    expect(result.notice?.kind).toBe('session-ended');
    expect(result.notice?.message).toMatch(/[Ss]ign in again/);
    expect(transport.countTo(TOKEN_URL)).toBe(0);
  });

  it('should re-run the client credentials grant under the same one shot rule', async () => {
    // Given, this flow holds what a token is made from, so the reader is not asked for anything.
    const transport = new ScriptedTransport([
      tokenReply({ access_token: 'access-1' }),
      reply(401, 'expired'),
      tokenReply({ access_token: 'access-2' }),
      reply(200, '{}'),
    ]);
    const runner = await signedIn(transport, CLIENT_FLOW);

    // When
    const result = await runner.send({ operation: guarded(), serverUrl: API, values: {} });

    // Then
    expect(result.status).toBe(200);
    expect(transport.formsTo(TOKEN_URL)[1]?.get('grant_type')).toBe('client_credentials');
    expect(transport.countTo(ORDERS)).toBe(2);
  });

  it('should re-run the password grant with the credentials it already holds', async () => {
    // Given
    const transport = new ScriptedTransport([
      tokenReply({ access_token: 'access-1' }),
      reply(401, 'expired'),
      tokenReply({ access_token: 'access-2' }),
      reply(200, '{}'),
    ]);
    const runner = await signedIn(transport, PASSWORD_FLOW);

    // When
    const result = await runner.send({ operation: guarded(), serverUrl: API, values: {} });

    // Then
    expect(result.status).toBe(200);
    const renewal = transport.formsTo(TOKEN_URL)[1];
    expect(renewal?.get('grant_type')).toBe('password');
    expect(renewal?.get('username')).toBe('ada');
  });
});

describe('the absence of a background refresh', () => {
  it('should create no timer, measured on the runner rather than described', async () => {
    // Given, this page sits open in a tab for hours, and a timer renewing a session against
    // somebody's production API with nobody present is not a thing a documentation tool does.
    // The absence is the requirement, so the absence is what is asserted.
    vi.useFakeTimers();
    const transport = new ScriptedTransport([
      tokenReply({ refresh_token: 'r1', expires_in: 1 }),
      reply(401, 'expired'),
      tokenReply({ access_token: 'access-2', expires_in: 1 }),
      reply(200, '{}'),
    ]);

    // When
    const runner = await signedIn(transport, CLIENT_FLOW);
    const before = vi.getTimerCount();
    await runner.send({ operation: guarded(), serverUrl: API, values: {} });

    // Then
    expect(before).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the device flow', () => {
  it('should poll until the reader approves it, obeying slow_down', async () => {
    // Given, RFC 8628: the two waiting answers are neither a failure nor a token.
    const waits: number[] = [];
    const backing = fakeStorage();
    const transport = new ScriptedTransport([
      reply(
        200,
        JSON.stringify({
          device_code: 'device-1',
          user_code: 'WDJB-MJHT',
          verification_uri: 'https://auth.example.com/device',
          interval: 5,
          expires_in: 600,
        }),
      ),
      reply(400, '{"error":"authorization_pending"}'),
      reply(400, '{"error":"slow_down"}'),
      tokenReply({ access_token: 'device-token' }),
    ]);
    const runner = createRunner({
      visibility: 'public',
      storageBacking: backing,
      pendingStorage: backing,
      transport,
      random: fixedRandom(),
      wait: async (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });

    // When
    const outcome = await runner.signIn('oauth', DEVICE_FLOW, { clientId: 'console' });
    await runner.completeDeviceAuthorization('oauth');

    // Then
    expect(outcome.kind === 'device' ? outcome.device.userCode : '').toBe('WDJB-MJHT');
    expect(waits).toEqual([5000, 5000, 10_000]);
    expect(runner.credential('oauth')).toBe('device-token');
    expect(transport.countTo(DEVICE_URL)).toBe(1);
  });

  it('should give up when the device code expires rather than poll forever', async () => {
    // Given a clock that has run past the deadline by the first poll.
    let now = 0;
    const backing = fakeStorage();
    const transport = new ScriptedTransport(
      [
        reply(
          200,
          JSON.stringify({
            device_code: 'device-1',
            user_code: 'WDJB-MJHT',
            verification_uri: 'https://auth.example.com/device',
            interval: 1,
            expires_in: 2,
          }),
        ),
      ],
      reply(400, '{"error":"authorization_pending"}'),
    );
    const runner = createRunner({
      visibility: 'public',
      storageBacking: backing,
      pendingStorage: backing,
      transport,
      now: () => now,
      random: fixedRandom(),
      wait: async () => {
        now += 10_000;
        return Promise.resolve();
      },
    });
    await runner.signIn('oauth', DEVICE_FLOW, { clientId: 'console' });

    // When
    const poll = runner.completeDeviceAuthorization('oauth');

    // Then
    await expect(poll).rejects.toThrow(/expired/);
  });
});

describe('the authorization code round trip', () => {
  it('should exchange the code with the verifier it generated and store the token', async () => {
    // Given
    const backing = fakeStorage();
    const transport = new ScriptedTransport([tokenReply({ access_token: 'exchanged' })]);
    const runner = runnerWith(transport, 'session', backing);

    // When
    const outcome = await runner.signIn(
      'oauth',
      CODE_FLOW,
      { clientId: 'console' },
      {
        redirectUri: 'https://docs.example.com/_oauth/callback',
        returnPath: '/get-orders',
      },
    );
    const url = new URL(outcome.kind === 'redirect' ? outcome.url : '');
    const state = url.searchParams.get('state') ?? '';
    const landed = await runner.completeAuthorization({ code: 'abc', state });

    // Then
    expect(url.origin + url.pathname).toBe(AUTHORIZE_URL);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(landed?.returnPath).toBe('/get-orders');
    expect(runner.credential('oauth')).toBe('exchanged');
    const form = transport.formsTo(TOKEN_URL)[0];
    expect(form?.get('grant_type')).toBe('authorization_code');
    expect(form?.get('code_verifier')).toHaveLength(43);
    // And the single use record is gone, so a reload cannot replay it.
    expect(backing.entries.has(PENDING_AUTHORIZATION_KEY)).toBe(false);
  });

  it('should keep the access token under the same key the credential store uses', async () => {
    // Given, the access token obeys the storage policy of SPEC 14.4 because it is the same store.
    const backing = fakeStorage();
    const transport = new ScriptedTransport([tokenReply({ access_token: 'stored' })]);

    // When
    await signedIn(transport, CLIENT_FLOW, 'session', backing);

    // Then
    expect(backing.entries.get(`${CREDENTIAL_KEY_PREFIX}oauth`)).toBe('stored');
  });

  it('should refuse an answer that arrives with nothing pending', async () => {
    // Given, a page opened directly at a callback url, or a second reload of one.
    const runner = runnerWith(new ScriptedTransport([]));

    // When
    const landed = await runner.completeAuthorization({ code: 'abc', state: 'anything' });

    // Then
    expect(landed).toBeUndefined();
  });
});

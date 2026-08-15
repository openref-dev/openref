import { AuthError } from '@openref/core';
import { describe, expect, it } from 'vitest';
import {
  authorizationUrl,
  createPkceChallenge,
  codeExchangePlan,
  pkceChallengeFor,
  readAuthorizationCode,
  parseTokenResponse,
  readImplicitToken,
  PKCE_METHOD,
  type PendingAuthorization,
} from '../../src/index';
import { AUTHORIZE_URL, CODE_FLOW, IMPLICIT_FLOW, fixedRandom } from '../mocks/oauth';

/**
 * PKCE, and the several ways a crafted answer might try to get around it.
 *
 * THE TASK ASKS FOR THE CRAFTED RESPONSE AND NOT ONLY THE HAPPY PATH, so most of what is below is
 * an authorization server answering with something it should not: its own verifier, a method it
 * prefers, somebody else's state, no code at all. Every one of them has to end in a refusal or in
 * an exchange that carries this runner's own verifier, because a downgrade that only happens when
 * the server asks for it is still a downgrade.
 */

const CLIENT = { clientId: 'console' };

function pending(overrides: Partial<PendingAuthorization> = {}): PendingAuthorization {
  return {
    schemeId: 'oauth',
    flow: 'authorizationCode',
    state: 'state-1',
    verifier: 'v'.repeat(43),
    redirectUri: 'https://docs.example.com/_oauth/callback',
    returnPath: '/get-orders',
    ...overrides,
  };
}

describe('createPkceChallenge', () => {
  it('should derive the challenge as the base64url of the SHA-256 of the verifier', async () => {
    // Given
    const random = fixedRandom();

    // When
    const challenge = await createPkceChallenge(random);

    // Then
    expect(challenge.method).toBe('S256');
    expect(challenge.challenge).toBe(await pkceChallengeFor(challenge.verifier));
    // 32 random bytes are 43 base64url characters, which is the minimum RFC 7636 §4.1 allows.
    expect(challenge.verifier).toHaveLength(43);
  });

  it('should produce a verifier of unreserved characters only, per RFC 7636', async () => {
    // Given
    const random = fixedRandom(11);

    // When
    const { verifier } = await createPkceChallenge(random);

    // Then
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('should refuse to build one when the runtime has no random source', async () => {
    // Given, a verifier that can be predicted proves nothing, so there is no counter fallback
    // here of the kind the multipart boundary has.
    const absent = undefined;
    const previous = globalThis.crypto;

    // When
    Object.defineProperty(globalThis, 'crypto', { value: absent, configurable: true });
    const thrown = await (async (): Promise<unknown> => {
      try {
        return await createPkceChallenge();
      } catch (error: unknown) {
        return error;
      } finally {
        Object.defineProperty(globalThis, 'crypto', { value: previous, configurable: true });
      }
    })();

    // Then
    expect(thrown).toBeInstanceOf(AuthError);
    expect((thrown as AuthError).message).toMatch(/random source/);
  });
});

describe('authorizationUrl', () => {
  it('should send S256 as a constant rather than as something a caller chose', async () => {
    // Given
    const challenge = await createPkceChallenge(fixedRandom());

    // When
    const url = new URL(
      authorizationUrl(CODE_FLOW, CLIENT, {
        redirectUri: 'https://docs.example.com/_oauth/callback',
        state: 'state-1',
        challenge: challenge.challenge,
      }),
    );

    // Then
    expect(url.searchParams.get('code_challenge_method')).toBe(PKCE_METHOD);
    expect(url.searchParams.get('code_challenge')).toBe(challenge.challenge);
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('should refuse to start the code flow with no challenge at all', () => {
    // Given, the caller is what would be broken here, so this is a refusal rather than a retry.
    const request = { redirectUri: 'https://docs.example.com/_oauth/callback', state: 's' };

    // When
    const build = (): unknown => authorizationUrl(CODE_FLOW, CLIENT, request);

    // Then
    expect(build).toThrow(AuthError);
    expect(build).toThrow(/mandatory/);
  });

  it('should not put a challenge on the implicit flow, which has no exchange to prove', () => {
    // Given
    const request = { redirectUri: 'https://docs.example.com/_oauth/callback', state: 's' };

    // When
    const url = new URL(authorizationUrl(IMPLICIT_FLOW, CLIENT, request));

    // Then
    expect(url.searchParams.get('response_type')).toBe('token');
    expect(url.searchParams.has('code_challenge')).toBe(false);
    expect(url.origin + url.pathname).toBe(AUTHORIZE_URL);
  });
});

describe('readAuthorizationCode', () => {
  it('should read the code when the answer matches what was sent', () => {
    // Given
    const params = { code: 'abc', state: 'state-1' };

    // When
    const code = readAuthorizationCode(params, pending());

    // Then
    expect(code).toBe('abc');
  });

  it('should ignore a code_challenge_method the server sent back', () => {
    // Given, an answer trying to select `plain` for the exchange that follows.
    const params = {
      code: 'abc',
      state: 'state-1',
      code_challenge_method: 'plain',
      code_verifier: 'attacker-chosen',
    };

    // When
    const code = readAuthorizationCode(params, pending());
    const plan = codeExchangePlan(CODE_FLOW, CLIENT, {
      code,
      verifier: pending().verifier ?? '',
      redirectUri: pending().redirectUri,
    });
    const form = new URLSearchParams(typeof plan.body === 'string' ? plan.body : '');

    // Then, the exchange carries the verifier this runner generated and nothing the server named.
    expect(form.get('code_verifier')).toBe('v'.repeat(43));
    expect(form.has('code_challenge_method')).toBe(false);
  });

  it('should refuse an answer carrying a state this page did not send', () => {
    // Given
    const params = { code: 'abc', state: 'state-of-another-request' };

    // When
    const read = (): unknown => readAuthorizationCode(params, pending());

    // Then
    expect(read).toThrow(AuthError);
    expect(read).toThrow(/another request/);
  });

  it('should refuse an exchange when the pending record carries no verifier', () => {
    // Given, this is the shape a bypass would have: a flow that reached the exchange with no
    // proof of possession to send with the code.
    const params = { code: 'abc', state: 'state-1' };
    const record = { ...pending() };
    delete (record as { verifier?: string }).verifier;

    // When
    const read = (): unknown => readAuthorizationCode(params, record);

    // Then
    expect(read).toThrow(AuthError);
    expect(read).toThrow(/mandatory/);
  });

  it('should report the error the authorization server named rather than a missing code', () => {
    // Given
    const params = {
      error: 'access_denied',
      error_description: 'the reader said no',
      state: 'state-1',
    };

    // When
    const read = (): unknown => readAuthorizationCode(params, pending());

    // Then
    expect(read).toThrow(/access_denied/);
    expect(read).toThrow(/the reader said no/);
  });
});

describe('readImplicitToken', () => {
  it('should read a token out of the fragment parameters', () => {
    // Given
    const params = {
      access_token: 'a',
      token_type: 'Bearer',
      expires_in: '3600',
      state: 'state-1',
    };

    // When
    const token = readImplicitToken(params, pending({ flow: 'implicit' }));

    // Then
    expect(token.accessToken).toBe('a');
    expect(token.expiresInSeconds).toBe(3600);
  });

  it('should not carry a refresh token even when the server sent one', () => {
    // Given, RFC 6749 §4.2.2 forbids issuing one here, so a server that does is answering outside
    // the flow and the silent renewal of SPEC 14.4.1 must not apply to it.
    const params = { access_token: 'a', refresh_token: 'r', state: 'state-1' };

    // When
    const token = readImplicitToken(params, pending({ flow: 'implicit' }));

    // Then
    expect(token.refreshToken).toBeUndefined();
  });

  it('should refuse a fragment whose state does not match', () => {
    // Given
    const params = { access_token: 'a', state: 'somebody-elses' };

    // When
    const read = (): unknown => readImplicitToken(params, pending({ flow: 'implicit' }));

    // Then
    expect(read).toThrow(AuthError);
  });
});

describe('pkceChallengeFor', () => {
  it('should match the worked example of RFC 7636 appendix B', async () => {
    // Given, the verifier from the RFC's own appendix.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

    // When
    const challenge = await pkceChallengeFor(verifier);

    // Then
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('a token endpoint that answers with a redirect', () => {
  it('should name the redirect rather than blaming the body, as a browser reports it', () => {
    // Given the answer a browser gives for the `manual` redirect mode the token plan asks for:
    // an opaque response, status 0, empty body
    const outcome = parseTokenResponse(0, '');

    // Then the sentence is about the redirect. It read `not a JSON object` until T035, which sent
    // a reader to look at a body that was never delivered; the discovery reader has had the right
    // sentence for exactly this since T028, and only a browser produces the input.
    expect(outcome.kind).toBe('unknown');
    expect(outcome.kind === 'unknown' ? outcome.message : '').toContain('answered with a redirect');
  });

  it('should say the same for the 3xx Node reports for the same refusal', () => {
    // Given what Node hands back for the same plan
    const outcome = parseTokenResponse(307, '');

    // Then one finding, one sentence, whichever engine produced it
    expect(outcome.kind === 'unknown' ? outcome.message : '').toContain('answered with a redirect');
  });

  it('should still call a genuinely malformed body malformed', () => {
    // Given a 200 that is not JSON, which is the case the old sentence belonged to
    const outcome = parseTokenResponse(200, 'not json at all');

    // Then the two are told apart
    expect(outcome.kind === 'unknown' ? outcome.message : '').toContain('not a JSON object');
  });
});

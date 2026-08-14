import { AuthError } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { discoverProvider, discoveryPlan, readDiscoveryDocument } from '../../src/index';
import { ScriptedTransport, reply } from '../mocks/oauth';

/**
 * OpenID Connect discovery, and the four ways a document is refused.
 *
 * A DISCOVERY DOCUMENT IS AN INSTRUCTION TO SEND CREDENTIALS SOMEWHERE, which is why these cases
 * are mostly refusals. Whatever it names as the token endpoint is where a code verifier, a client
 * secret and possibly a reader's password are posted, so a document from an unexpected host, one
 * that arrived through a redirect, or one that advertises no S256 is not a document to work around.
 */

const ISSUER = 'https://auth.example.com';
const WELL_KNOWN = `${ISSUER}/.well-known/openid-configuration`;

function document(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['openid', 'orders:read'],
    ...overrides,
  });
}

describe('discoveryPlan', () => {
  it('should ask for the document without following a redirect', () => {
    // Given, `manual` is what makes a redirect visible rather than followed: a browser reports it
    // as an opaque answer and Node reports the 3xx itself, and both are refused below.
    const plan = discoveryPlan(WELL_KNOWN);

    // Then
    expect(plan.redirect).toBe('manual');
    expect(plan.method).toBe('GET');
    expect(plan.body).toBeNull();
  });

  it('should refuse a discovery url that is not https', () => {
    // Given, a credential is not sent over http, and this url is where the endpoints come from.
    const build = (): unknown =>
      discoveryPlan('http://auth.example.com/.well-known/openid-configuration');

    // Then
    expect(build).toThrow(AuthError);
    expect(build).toThrow(/https/);
  });

  it('should allow http on a loopback host, which is where a developer runs one', () => {
    // Given
    const plan = discoveryPlan('http://localhost:8080/.well-known/openid-configuration');

    // Then
    expect(plan.url).toBe('http://localhost:8080/.well-known/openid-configuration');
  });
});

describe('readDiscoveryDocument', () => {
  it('should read the flows a provider advertises', () => {
    // Given
    const body = document({
      device_authorization_endpoint: `${ISSUER}/device`,
      grant_types_supported: ['authorization_code', 'client_credentials'],
    });

    // When
    const provider = readDiscoveryDocument(WELL_KNOWN, 200, body);

    // Then
    expect(provider.issuer).toBe(ISSUER);
    expect(provider.flows.map((flow) => flow.kind)).toEqual([
      'authorizationCode',
      'clientCredentials',
      'deviceAuthorization',
    ]);
    expect(provider.flows[0]?.tokenUrl).toBe(`${ISSUER}/token`);
    expect(provider.scopes).toEqual(['openid', 'orders:read']);
  });

  it('should refuse a document that answered with a redirect', () => {
    // Given, the host that answers has to be the host the document named.
    const read = (): unknown => readDiscoveryDocument(WELL_KNOWN, 302, '');

    // Then
    expect(read).toThrow(AuthError);
    expect(read).toThrow(/redirect/);
  });

  it('should refuse an opaque redirect, which is what a browser reports as status 0', () => {
    // Given
    const read = (): unknown => readDiscoveryDocument(WELL_KNOWN, 0, '');

    // Then
    expect(read).toThrow(/redirect/);
  });

  it('should refuse a document served from a host other than the issuer it claims', () => {
    // Given, RFC 8414 §3.3. Without this, a document served from anywhere can name its own
    // endpoints and the reader's credential goes wherever it says.
    const read = (): unknown =>
      readDiscoveryDocument(
        'https://cdn.elsewhere.example/.well-known/openid-configuration',
        200,
        document(),
      );

    // Then
    expect(read).toThrow(AuthError);
    expect(read).toThrow(/refused/);
  });

  it.each([
    ['not JSON at all', 'this is not json'],
    ['a JSON array', '[]'],
    ['an object with no issuer', '{"token_endpoint":"https://auth.example.com/token"}'],
  ])('should refuse a document that is %s', (_name, body) => {
    // Given
    const read = (): unknown => readDiscoveryDocument(WELL_KNOWN, 200, body);

    // Then
    expect(read).toThrow(AuthError);
  });

  it('should refuse a provider that advertises plain and not S256, rather than fall back to it', () => {
    // Given, this is the one thing discovery may not do: negotiate a mandatory rule downwards.
    const read = (): unknown =>
      readDiscoveryDocument(
        WELL_KNOWN,
        200,
        document({ code_challenge_methods_supported: ['plain'] }),
      );

    // Then
    expect(read).toThrow(AuthError);
    expect(read).toThrow(/S256/);
  });

  it('should refuse an endpoint that is not https even when the issuer is', () => {
    // Given, the endpoint is where the credential goes, so it is checked as well as the issuer.
    const read = (): unknown =>
      readDiscoveryDocument(
        WELL_KNOWN,
        200,
        document({ token_endpoint: 'http://elsewhere.example/token' }),
      );

    // Then
    expect(read).toThrow(/https/);
  });

  it('should refuse a document with no endpoint pair a flow can be run with', () => {
    // Given
    const body = JSON.stringify({ issuer: ISSUER, userinfo_endpoint: `${ISSUER}/userinfo` });

    // When
    const read = (): unknown => readDiscoveryDocument(WELL_KNOWN, 200, body);

    // Then
    expect(read).toThrow(/no endpoint pair/);
  });
});

describe('discoverProvider', () => {
  it('should fetch and read in one call', async () => {
    // Given
    const transport = new ScriptedTransport([reply(200, document())]);

    // When
    const provider = await discoverProvider(WELL_KNOWN, transport);

    // Then
    expect(provider.flows).toHaveLength(1);
    expect(transport.sent[0]?.redirect).toBe('manual');
  });
});

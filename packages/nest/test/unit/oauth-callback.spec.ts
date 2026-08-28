import { describe, expect, it } from 'vitest';
import { base64UrlText } from '@openref/runner';
import { ReferenceService } from '../../src/reference/application/services/reference.service';
import { assetPlan, specification } from '../mocks/fixtures';
import type { ReferenceRequest } from '../../src/http/application/ports/reference-http.port';

/**
 * The OAuth2 redirect uri of SPEC 14.4, which is a route that holds nothing.
 *
 * IT IS A REDIRECT AND NOT AN EXCHANGE, and that is the property under test. A redirect uri has to
 * be one fixed path registered with the provider, and the reader was on an operation page; this
 * route puts them back there with the answer still attached, and the exchange happens in the
 * browser where the PKCE verifier is. A server taking part in the exchange would be a server
 * holding somebody's token.
 *
 * AND IT IS THE ONE ROUTE THAT COULD BE AN OPEN REDIRECTOR, because it forwards to a path an
 * authorization server echoed back. That is why most of these cases are refusals and why the
 * refusal lands on the mount's own overview rather than anywhere the state asked for.
 */

function service(basePath = '/docs'): ReferenceService {
  return new ReferenceService({
    document: specification(),
    basePath,
    assets: assetPlan(),
    highlight: false,
  });
}

function callback(query: Record<string, string>): ReferenceRequest {
  return { params: {}, headers: {}, query };
}

/** The state the runner writes: a nonce, a dot, and the return path as base64url. */
function state(returnPath: string, nonce = 'nonce-1'): string {
  return `${nonce}.${base64UrlText(returnPath)}`;
}

describe('the oauth callback route', () => {
  it('should send the reader back to the page they signed in from, with the answer attached', async () => {
    // Given
    const reference = service();

    // When
    const reply = await reference.handle(
      'oauth-callback',
      callback({ code: 'abc', state: state('/docs/get-orders-id') }),
    );

    // Then
    expect(reply.status).toBe(302);
    const location = new URL(reply.headers.location ?? '', 'https://docs.example.com');
    expect(location.pathname).toBe('/docs/get-orders-id');
    expect(location.searchParams.get('oref_oauth')).toBe('1');
    expect(location.searchParams.get('code')).toBe('abc');
  });

  it('should never store the answer, because the url it names carries an authorization code', async () => {
    // Given
    const reference = service();

    // When
    const reply = await reference.handle(
      'oauth-callback',
      callback({ code: 'abc', state: state('/docs/') }),
    );

    // Then
    expect(reply.headers['cache-control']).toBe('no-store');
  });

  it('should keep a query the page already had rather than replace it', async () => {
    // Given
    const reference = service();

    // When
    const reply = await reference.handle(
      'oauth-callback',
      callback({ code: 'abc', state: state('/docs/get-orders-id?tab=schema') }),
    );

    // Then
    const location = reply.headers.location ?? '';
    expect(location.startsWith('/docs/get-orders-id?tab=schema&')).toBe(true);
    expect(location).toContain('oref_oauth=1');
  });

  it.each([
    ['an absolute url', 'https://attacker.example/steal'],
    ['a protocol relative url', '//attacker.example/steal'],
    ['a path outside the mount', '/admin'],
    ['a backslash path some browsers read as a slash', '/\\attacker.example'],
  ])('should refuse %s in the state and go to the overview instead', async (_name, path) => {
    // Given, this route is registered with an authorization server, which is the worst place to
    // have an open redirector.
    const reference = service();

    // When
    const reply = await reference.handle(
      'oauth-callback',
      callback({ code: 'abc', state: state(path) }),
    );

    // Then
    expect(reply.headers.location?.startsWith('/docs?')).toBe(true);
  });

  /**
   * The mount with no base path, which is where the three checks above stopped containing this.
   *
   * FOUND BY THE PRE-M4 REVIEW AND DRIVEN TO THE WIRE. `/\t/evil.example/x` starts with one slash,
   * not two, and carries no backslash, so it passed every check; the under-the-mount check that
   * would have caught it is guarded by `basePath !== ''` and does not run at the root. Node's own
   * header validator admits a horizontal tab in a `Location`, and every browser deletes tab,
   * carriage return and line feed from a url before reading it, so what the reader follows is
   * `//evil.example/x`. The `\n` and `\r` spellings Node refuses itself, which is why the tab was
   * the live one and why all three are refused here rather than only the one that got through.
   */
  it.each([
    ['a tab a browser deletes', '/\t/attacker.example/x'],
    ['a line feed', '/\n/attacker.example/x'],
    ['a carriage return', '/\r/attacker.example/x'],
  ])('should refuse %s in the state at the root mount', async (_name, path) => {
    // Given a reference mounted at the root, where there is no base path to contain a return path
    const reference = service('');

    // When
    const reply = await reference.handle(
      'oauth-callback',
      callback({ code: 'abc', state: state(path) }),
    );

    // Then the reader lands on the overview rather than off site
    expect(reply.headers.location?.startsWith('/?')).toBe(true);
  });

  it('should still take an ordinary return path at the root mount', async () => {
    // Given the same root mount and a path a page really returns to
    const reference = service('');

    // When
    const reply = await reference.handle(
      'oauth-callback',
      callback({ code: 'abc', state: state('/get-orders-id') }),
    );

    // Then the guard has not made the root mount unusable
    expect(reply.headers.location?.startsWith('/get-orders-id?')).toBe(true);
  });

  it('should go to the overview when the state carries no return path at all', async () => {
    // Given
    const reference = service();

    // When
    const reply = await reference.handle(
      'oauth-callback',
      callback({ code: 'abc', state: 'just-a-nonce' }),
    );

    // Then
    expect(reply.headers.location?.startsWith('/docs?')).toBe(true);
  });

  it('should forward the error an authorization server reported rather than swallow it', async () => {
    // Given, the browser is what tells the reader, and it can only do that if the answer reaches it.
    const reference = service();

    // When
    const reply = await reference.handle(
      'oauth-callback',
      callback({ error: 'access_denied', state: state('/docs/get-orders-id') }),
    );

    // Then
    expect(reply.headers.location).toContain('error=access_denied');
  });

  it('should work at the root mount, where the overview is a bare slash', async () => {
    // Given
    const reference = service('');

    // When
    const reply = await reference.handle(
      'oauth-callback',
      callback({ code: 'abc', state: state('/get-orders-id') }),
    );

    // Then
    expect(reply.headers.location?.startsWith('/get-orders-id?')).toBe(true);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { callbackParams, OAUTH_MARKER, SIGN_IN_NOTICE_KEY } from '../../src/shared/oauth-landing';
import { redirectTargets } from '../../src/shared/oauth-console';

/**
 * Coming back from an authorization server, which happens on a page load rather than in a click.
 *
 * THE ENTRY CARRIES THE MARKER AS A LITERAL AND THIS IS WHAT KEEPS THE TWO HONEST. Importing the
 * constant there would put a module and its import glue into the first chunk of every page to save
 * repeating eleven characters, and SPEC 20 measures that chunk to the byte. The literal is checked
 * against the constant here instead, by reading the file: two spellings of one name that drift
 * apart in silence is exactly the failure the constant existed to prevent.
 */

const ENTRY = join(import.meta.dirname, '..', '..', 'src', 'browser', 'index.ts');

/** A location, said structurally, which is all these functions read. */
function location(
  search: string,
  hash = '',
  pathname = '/docs/get-orders',
): {
  search: string;
  hash: string;
  pathname: string;
  origin: string;
} {
  return { search, hash, pathname, origin: 'https://docs.example.com' };
}

describe('the marker the entry checks for', () => {
  it('should be the literal the constant spells', () => {
    // Given
    const source = readFileSync(ENTRY, 'utf8');

    // Then
    expect(source).toContain(`'${OAUTH_MARKER}=1'`);
  });

  it('should be reached through a dynamic import, so the landing is not in the first chunk', () => {
    // Given, a page load that is not a callback is every page load but one per sign in, and it
    // pays for the comparison and nothing else.
    const source = readFileSync(ENTRY, 'utf8');

    // Then
    expect(source).toContain("import('../shared/oauth-landing')");
    expect(source).not.toContain("from '../shared/oauth-landing'");
  });
});

describe('callbackParams', () => {
  it('should read an authorization code out of the query string', () => {
    // Given
    const here = location(`?${OAUTH_MARKER}=1&code=abc&state=s.cGF0aA`);

    // When
    const params = callbackParams(here);

    // Then
    expect(params).toEqual({ code: 'abc', state: 's.cGF0aA' });
  });

  it('should read an implicit token out of the fragment, which no server ever sees', () => {
    // Given, the two redirect flows answer in different halves of the url.
    const here = location(`?${OAUTH_MARKER}=1`, '#access_token=a&token_type=Bearer');

    // When
    const params = callbackParams(here);

    // Then
    expect(params).toEqual({ access_token: 'a', token_type: 'Bearer' });
  });

  it('should report nothing for a page that is not a callback', () => {
    // Given, which is every page load but one per sign in.
    const params = callbackParams(location('?tab=schema'));

    // Then
    expect(params).toBeNull();
  });
});

describe('redirectTargets', () => {
  it('should name the callback route under the mount and the page the reader was on', () => {
    // Given, a reference mounted at /docs registers /docs/_oauth/callback, and a console that
    // assumed the root would register a redirect uri no route answers.
    const targets = redirectTargets('/docs', location('?tab=schema'));

    // Then
    expect(targets).toEqual({
      redirectUri: 'https://docs.example.com/docs/_oauth/callback',
      returnPath: '/docs/get-orders?tab=schema',
    });
  });
});

describe('the key a landing leaves its outcome under', () => {
  it('should be namespaced, so a host page key is never touched', () => {
    // Given
    expect(SIGN_IN_NOTICE_KEY.startsWith('oref.')).toBe(true);
  });
});

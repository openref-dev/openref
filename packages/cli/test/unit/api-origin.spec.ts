import { describe, expect, it } from 'vitest';
import { LOOPBACK_HOSTS, parseApiOrigin } from '../../src/cli/domain/api-origin';

/**
 * `GITHUB_API_URL`, which decided where a write scoped token was delivered and was checked by
 * nothing.
 *
 * THE PRESENCE CASES COME FIRST, DELIBERATELY. A parser that refuses everything would pass every
 * refusal below and break the action on the day it ran, so the accepted spellings are asserted
 * first: the public API root, an Enterprise Server root with a path under it, and the three
 * loopback forms the fake GitHub of this suite listens on.
 */

/** Roots a token is allowed to be sent to. */
const ACCEPTED: readonly (readonly [string, string])[] = [
  ['https://api.github.com', 'https://api.github.com'],
  ['https://api.github.com/', 'https://api.github.com'],
  ['https://ghe.example.com/api/v3', 'https://ghe.example.com/api/v3'],
  ['https://ghe.example.com/api/v3//', 'https://ghe.example.com/api/v3'],
  ['http://127.0.0.1:5123', 'http://127.0.0.1:5123'],
  ['http://[::1]:5123', 'http://[::1]:5123'],
  ['http://localhost:5123', 'http://localhost:5123'],
];

/** Roots that must never receive a request, with what makes each one one. */
const REFUSED: readonly (readonly [string, string])[] = [
  ['http://evil.test', 'plain http to a host that is not this machine'],
  ['http://192.168.0.1:80', 'plain http to a private address that is still not loopback'],
  ['http://api.github.com', 'the real API root over a scheme that shows the token on the wire'],
  ['ftp://api.github.com', 'a scheme that is not http at all'],
  ['file:///etc/passwd', 'a scheme with no host in it'],
  ['javascript:alert(1)', 'a scheme that is not a transport'],
  ['api.github.com', 'a bare host with no scheme, which parses as nothing'],
  ['//api.github.com', 'a scheme relative address, which has no origin of its own'],
  ['https://', 'an https looking string that is not a URL'],
  ['https://exa mple.com', 'an https looking string with a space in the host'],
  ['https://user:pass@api.github.com', 'a second credential smuggled into the address'],
  ['', 'nothing at all'],
  ['   ', 'whitespace, which is not an address'],
];

describe('parseApiOrigin', () => {
  it.each(ACCEPTED)(
    'should accept %j and hand back a root with no trailing slash',
    (value, url) => {
      // When
      const parsed = parseApiOrigin(value);

      // Then
      expect(parsed).toEqual({ url });
    },
  );

  it.each(REFUSED)('should refuse %j, which is %s', (value) => {
    // When
    const parsed = parseApiOrigin(value);

    // Then
    expect(parsed).toHaveProperty('usageError');
    expect('url' in parsed).toBe(false);
  });

  it('should name the variable in the refusal, so the reader knows what to fix', () => {
    // Given: the message is the whole of what a maintainer sees when a run stops
    // When
    const parsed = parseApiOrigin('http://evil.test');

    // Then
    expect(parsed).toHaveProperty('usageError');
    if ('usageError' in parsed) {
      expect(parsed.usageError).toContain('GITHUB_API_URL');
      expect(parsed.usageError).toContain('evil.test');
      expect(parsed.usageError).toContain('19.11');
    }
  });

  it('should name whatever source the caller says supplied the value', () => {
    // When
    const parsed = parseApiOrigin('ftp://x.test', 'OPENREF_TEST_ROOT');

    // Then
    expect(parsed).toHaveProperty('usageError');
    if ('usageError' in parsed) expect(parsed.usageError).toContain('OPENREF_TEST_ROOT');
  });

  it('should admit http for every loopback spelling it declares and for no other', () => {
    // Given: the list is the exception, so it is read here rather than written out a second time
    // When
    const admitted = LOOPBACK_HOSTS.filter((host) => {
      const address = host === '::1' ? '[::1]' : host;
      return !('usageError' in parseApiOrigin(`http://${address}:1`));
    });

    // Then
    expect(admitted).toEqual([...LOOPBACK_HOSTS]);
    expect(parseApiOrigin('http://127.0.0.2:1')).toHaveProperty('usageError');
  });
});

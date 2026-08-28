import { describe, expect, it } from 'vitest';
import {
  MAX_NAME_LENGTH,
  MAX_OWNER_LENGTH,
  parseRepositorySlug,
  repositoryPath,
} from '../../src/cli/domain/repository-slug';

/**
 * `--repository`, which used to be concatenated into the API address as written.
 *
 * THE HOSTILE SPELLINGS BELOW ARE THE ONES A REVIEW MEASURED AGAINST A FAKE API WITH A WRITE
 * TOKEN SET, plus the encodings and cases around them. Each of them produced a token bearing
 * request outside `/repos/`; each of them is a usage error here, before anything is formed.
 */

/** Every spelling that must be refused, with what it did before the parse existed. */
const HOSTILE: readonly string[] = [
  '../../escaped',
  'a/b/../../../evil',
  '%2e%2e/%2e%2e/x',
  '%2E%2E/%2E%2E/X',
  'acme/..',
  'acme/.',
  '../x',
  'a/b/c',
  'acme',
  '',
  '/',
  'acme/',
  '/api',
  'a//b',
  'acme%2Fapi',
  'ACME%2Fapi',
  'acme/api:x',
  'https://evil.test/acme/api',
  'acme\\api',
  'acme /api',
  'acme/api?x=1',
  'acme/api#frag',
  'user@acme/api',
  '-acme/api',
  'acme-/api',
  'ac--me/api',
  'a.b/api',
  'acme/api\n',
  'acme/../api',
];

describe('parseRepositorySlug', () => {
  it('should accept an ordinary owner/name', () => {
    // When
    const parsed = parseRepositorySlug('acme/payments');

    // Then
    expect(parsed).toEqual({ owner: 'acme', name: 'payments' });
  });

  it('should accept the mixed case, dotted and underscored spellings GitHub issues', () => {
    // Given: refusing a legal repository would be a different bug of the same size
    // When / Then
    expect(parseRepositorySlug('Acme-Corp/API.v2_beta')).toEqual({
      owner: 'Acme-Corp',
      name: 'API.v2_beta',
    });
    expect(parseRepositorySlug('a/.github')).toEqual({ owner: 'a', name: '.github' });
    expect(parseRepositorySlug('a1/b-2_c.3')).toEqual({ owner: 'a1', name: 'b-2_c.3' });
  });

  it('should accept an owner and a name at their full allowed length', () => {
    // Given
    const owner = 'a'.repeat(MAX_OWNER_LENGTH);
    const name = 'b'.repeat(MAX_NAME_LENGTH);

    // When / Then
    expect(parseRepositorySlug(`${owner}/${name}`)).toEqual({ owner, name });
  });

  it('should refuse one character past either length', () => {
    // When / Then
    expect(parseRepositorySlug(`${'a'.repeat(MAX_OWNER_LENGTH + 1)}/b`)).toHaveProperty(
      'usageError',
    );
    expect(parseRepositorySlug(`a/${'b'.repeat(MAX_NAME_LENGTH + 1)}`)).toHaveProperty(
      'usageError',
    );
  });

  it.each(HOSTILE)('should refuse %j as a usage error rather than repair it', (value) => {
    // When
    const parsed = parseRepositorySlug(value);

    // Then
    expect(parsed).toHaveProperty('usageError');
    expect('owner' in parsed).toBe(false);
  });

  it('should say what it saw, so the caller can fix the value they typed', () => {
    // When
    const parsed = parseRepositorySlug('../../escaped');

    // Then
    expect(parsed).toHaveProperty('usageError');
    if ('usageError' in parsed) {
      expect(parsed.usageError).toContain('--repository');
      expect(parsed.usageError).toContain('exactly owner/name');
    }
  });

  it('should name whichever source supplied the value rather than always the flag', () => {
    // Given: the same string arrives three ways, and a message that always said --repository sent
    // a reader to edit a flag they never wrote
    // When
    const fromEnv = parseRepositorySlug('../../escaped', 'OPENREF_PR_REPOSITORY');
    const fromWorkflow = parseRepositorySlug('../../escaped', 'GITHUB_REPOSITORY');

    // Then
    expect(fromEnv).toHaveProperty('usageError');
    expect(fromWorkflow).toHaveProperty('usageError');
    if ('usageError' in fromEnv) {
      expect(fromEnv.usageError).toContain('OPENREF_PR_REPOSITORY');
      expect(fromEnv.usageError).not.toContain('--repository');
    }
    if ('usageError' in fromWorkflow)
      expect(fromWorkflow.usageError).toContain('GITHUB_REPOSITORY');
  });
});

/**
 * Whitespace, which the docstring above always claimed was refused and which the path into this
 * function repaired.
 *
 * Each entry is a character the review named, spelled by code point rather than typed, because a
 * tab and four spaces are indistinguishable in a source file and a non breaking space is
 * indistinguishable from a space.
 */
const WHITESPACE: readonly (readonly [string, string])[] = [
  ['SP', '\u0020'],
  ['TAB', '\u0009'],
  ['CR', '\u000d'],
  ['LF', '\u000a'],
  ['VT', '\u000b'],
  ['FF', '\u000c'],
  ['NBSP', '\u00a0'],
];

describe('whitespace around an otherwise legal owner/name', () => {
  it.each(WHITESPACE)('should refuse a leading %s rather than trim it', (_name, character) => {
    // When
    const parsed = parseRepositorySlug(`${character}acme/payments`);

    // Then
    expect(parsed).toHaveProperty('usageError');
    expect('owner' in parsed).toBe(false);
  });

  it.each(WHITESPACE)('should refuse a trailing %s rather than trim it', (_name, character) => {
    // When
    const parsed = parseRepositorySlug(`acme/payments${character}`);

    // Then
    expect(parsed).toHaveProperty('usageError');
    expect('owner' in parsed).toBe(false);
  });

  it.each(WHITESPACE)('should refuse %s inside the value too', (_name, character) => {
    // When / Then
    expect(parseRepositorySlug(`acme${character}corp/payments`)).toHaveProperty('usageError');
    expect(parseRepositorySlug(`acme/pay${character}ments`)).toHaveProperty('usageError');
  });

  it('should refuse a value that is nothing but whitespace', () => {
    // Given: this is not emptiness. Emptiness means an option nobody set; a space means somebody
    // set it to something that is not owner/name.
    // When / Then
    for (const [, character] of WHITESPACE) {
      expect(parseRepositorySlug(character)).toHaveProperty('usageError');
    }
  });

  it('should refuse a NUL and a delete, which are outside the allowlists rather than whitespace', () => {
    // Given: the two allowlists are the boundary and admit nothing that is not in them
    // When / Then
    expect(parseRepositorySlug('acme\u0000/payments')).toHaveProperty('usageError');
    expect(parseRepositorySlug('acme/payments\u007f')).toHaveProperty('usageError');
  });
});

describe('repositoryPath', () => {
  it('should join the two segments with the one separator they are allowed', () => {
    // When / Then
    expect(repositoryPath({ owner: 'acme', name: 'payments' })).toBe('acme/payments');
  });
});

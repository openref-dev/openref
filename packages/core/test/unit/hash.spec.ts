import { describe, expect, it } from 'vitest';
import { canonicalize, hash, hashDocument, NormalizeError, sha256Hex } from '../../src/index';
import { createDocumentFixture } from '../mocks/document.mock';

describe('hash', () => {
  it('should be sha256 over the canonical serialization', () => {
    // Given
    const value = { b: 1, a: 2 };

    // When
    const result = hash(value);

    // Then
    expect(result).toBe(sha256Hex(canonicalize(value)));
  });

  it('should ignore object key order', () => {
    // Given
    const written = { zulu: 1, alpha: 2 };
    const rewritten = { alpha: 2, zulu: 1 };

    // When
    const hashes = [hash(written), hash(rewritten)];

    // Then
    expect(hashes[0]).toBe(hashes[1]);
  });

  it('should separate values that differ only by type', () => {
    // Given
    const cases: readonly unknown[] = [1, '1', true, null, [1], { '0': 1 }];

    // When
    const hashes = cases.map((value) => hash(value));

    // Then
    expect(new Set(hashes).size).toBe(cases.length);
  });

  it('should propagate the canonicalization failure rather than hashing a guess', () => {
    // Given
    const value = { at: Number.NaN };

    // When
    const act = (): string => hash(value);

    // Then
    expect(act).toThrow(NormalizeError);
  });
});

describe('hashDocument', () => {
  it('should produce a 64 character hexadecimal digest', () => {
    // Given
    const document = createDocumentFixture();

    // When
    const digest = hashDocument(document);

    // Then
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should equal hashing the same document with a blank hash field', () => {
    // Given
    const document = createDocumentFixture();

    // When
    const results = [hashDocument(document), hash({ ...document, hash: '' })];

    // Then
    expect(results[0]).toBe(results[1]);
  });
});

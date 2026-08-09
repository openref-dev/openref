import { describe, expect, it } from 'vitest';
import { canonicalize, hash, hashDocument } from '../../src/index';
import { createDocumentFixture, createRandom, shuffleKeys } from '../mocks/document.mock';

describe('determinism of the document hash', () => {
  it('should produce one hash for 1000 shuffled variants of the same document', () => {
    // Given
    const document = createDocumentFixture();
    const random = createRandom(20260809);
    const expected = hashDocument(document);

    // When
    const hashes = new Set<string>();
    for (let variant = 0; variant < 1000; variant += 1) {
      hashes.add(hash(shuffleKeys({ ...document, hash: '' }, random)));
    }

    // Then
    expect(hashes.size).toBe(1);
    expect([...hashes]).toEqual([expected]);
  });

  it('should ignore the hash field itself, so the field stays verifiable', () => {
    // Given
    const document = createDocumentFixture();
    const stamped = { ...document, hash: 'deadbeef' };

    // When
    const hashes = [hashDocument(document), hashDocument(stamped)];

    // Then
    expect(hashes[0]).toBe(hashes[1]);
  });

  it('should hash a response map written in either key order identically', () => {
    // Given
    const ascending = { responses: { '200': 'ok', '404': 'gone', default: 'other' } };
    const descending = { responses: { '404': 'gone', default: 'other', '200': 'ok' } };

    // When
    const hashes = [hash(ascending), hash(descending)];

    // Then
    expect(hashes[0]).toBe(hashes[1]);
  });

  it('should produce a different hash for a document that actually differs', () => {
    // Given
    const document = createDocumentFixture();
    const changed = {
      ...document,
      info: { ...document.info, version: '1.4.1' },
    };

    // When
    const hashes = [hashDocument(document), hashDocument(changed)];

    // Then
    expect(hashes[0]).not.toBe(hashes[1]);
  });

  it('should notice a change buried inside a map value', () => {
    // Given
    const document = createDocumentFixture();
    const node = document.nodes.get('get-orders');
    const nodes = new Map(document.nodes);
    if (node?.kind === 'operation') {
      nodes.set('get-orders', { ...node, deprecated: true });
    }

    // When
    const hashes = [hashDocument(document), hashDocument({ ...document, nodes })];

    // Then
    expect(hashes[0]).not.toBe(hashes[1]);
  });

  it('should canonicalize a shuffled variant to byte identical text', () => {
    // Given
    const document = createDocumentFixture();
    const random = createRandom(7);

    // When
    const original = canonicalize(document);
    const shuffledText = canonicalize(shuffleKeys(document, random));

    // Then
    expect(shuffledText).toBe(original);
  });

  it('should be stable across a rebuild of the same fixture', () => {
    // Given
    const first = createDocumentFixture();
    const second = createDocumentFixture();

    // When
    const hashes = [hashDocument(first), hashDocument(second)];

    // Then
    expect(hashes[0]).toBe(hashes[1]);
  });
});

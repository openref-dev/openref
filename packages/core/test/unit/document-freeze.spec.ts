import { describe, expect, it } from 'vitest';
import { finalizeDocument, freezeDocument, hashDocument } from '../../src/index';
import { createDocumentFixture } from '../mocks/document.mock';

/**
 * A finalized document is unwritable, per SPEC 5.1 and SPEC 10.4.
 *
 * The failure this prevents is not a crash. It is a document whose hash is still correct for
 * content it no longer describes: an edit after the hash was taken moves nothing that any cache
 * keyed by that hash can see. So these cases assert the refusal at each depth the IR actually
 * has, rather than asserting that the top level object is frozen, which is the shallow answer
 * that reads as protection and is none.
 */

describe('finalizeDocument', () => {
  it('should stamp the hash the document records for itself', () => {
    // Given
    const document = { ...createDocumentFixture(), hash: '' };

    // When
    const finalized = finalizeDocument(document);

    // Then
    expect(finalized.hash).toBe(hashDocument(finalized));
  });

  it('should ignore whatever hash it was handed, so a stale one cannot survive', () => {
    // Given
    const document = { ...createDocumentFixture(), hash: 'stale' };

    // When
    const finalized = finalizeDocument(document);

    // Then
    expect(finalized.hash).not.toBe('stale');
    expect(finalized.hash).toBe(hashDocument({ ...document, hash: '' }));
  });

  it('should refuse a write to a field of the document', () => {
    // Given
    const finalized = finalizeDocument({ ...createDocumentFixture(), hash: '' });

    // When
    const write = (): void => {
      (finalized as { hash: string }).hash = 'rewritten';
    };

    // Then
    expect(write).toThrow(TypeError);
    expect(finalized.hash).not.toBe('rewritten');
  });

  it('should refuse a write nested inside the document, which is where a theme would write', () => {
    // Given
    const finalized = finalizeDocument({ ...createDocumentFixture(), hash: '' });

    // When
    const write = (): void => {
      (finalized.info as { title: string }).title = 'rewritten';
    };

    // Then
    expect(write).toThrow(TypeError);
    expect(finalized.info.title).not.toBe('rewritten');
  });

  it('should refuse a push onto an array the document holds', () => {
    // Given
    const finalized = finalizeDocument({ ...createDocumentFixture(), hash: '' });

    // When
    const write = (): void => {
      (finalized.navigation as unknown[]).push({ id: 'planted' });
    };

    // Then
    expect(write).toThrow(TypeError);
  });

  it('should refuse a set on a map the document holds, which Object.freeze does not', () => {
    // Given
    const finalized = finalizeDocument({ ...createDocumentFixture(), hash: '' });
    const before = finalized.nodes.size;

    // When
    const write = (): void => {
      (finalized.nodes as Map<string, never>).set('planted', undefined as never);
    };

    // Then
    expect(write).toThrow(/frozen/);
    expect(finalized.nodes.size).toBe(before);
  });

  it('should refuse a delete and a clear on a map the document holds', () => {
    // Given
    const finalized = finalizeDocument({ ...createDocumentFixture(), hash: '' });
    const [firstKey] = [...finalized.nodes.keys()];

    // When
    const remove = (): void => {
      (finalized.nodes as Map<string, never>).delete(firstKey ?? '');
    };
    const clear = (): void => {
      (finalized.nodes as Map<string, never>).clear();
    };

    // Then
    expect(remove).toThrow(/frozen/);
    expect(clear).toThrow(/frozen/);
    expect(finalized.nodes.size).toBeGreaterThan(0);
  });

  it('should refuse a write to a node reached through the map', () => {
    // Given
    const finalized = finalizeDocument({ ...createDocumentFixture(), hash: '' });
    const [node] = [...finalized.nodes.values()];

    // When
    const write = (): void => {
      (node as unknown as { id: string }).id = 'rewritten';
    };

    // Then
    expect(node).toBeDefined();
    expect(write).toThrow(TypeError);
  });

  it('should be safe to finalize twice over shared collections, which the runtime pass does', () => {
    // Given, the runtime pass spreads the normalized document, so `schemas` and `webhooks` are
    // the same Map objects reaching a second finalize.
    const once = finalizeDocument({ ...createDocumentFixture(), hash: '' });

    // When
    const twice = (): unknown => finalizeDocument({ ...once, hash: '' });

    // Then
    expect(twice).not.toThrow();
  });

  it('should leave the hash unchanged by the freeze itself', () => {
    // Given
    const document = { ...createDocumentFixture(), hash: '' };
    const before = hashDocument(document);

    // When
    const finalized = finalizeDocument(document);

    // Then
    expect(finalized.hash).toBe(before);
  });
});

describe('freezeDocument', () => {
  it('should return the same object rather than a copy, because a copy is the cost SPEC 6.2 refused', () => {
    // Given
    const document = { ...createDocumentFixture(), hash: '' };

    // When
    const frozen = freezeDocument(document);

    // Then
    expect(frozen).toBe(document);
  });

  it('should terminate on a value that holds itself', () => {
    // Given, the IR carries references as ids rather than as object cycles, so this is a guard
    // against a producer that has not been written yet rather than a shape in the IR today.
    const looping: Record<string, unknown> = { id: 'loop' };
    looping.self = looping;
    const document = {
      ...createDocumentFixture(),
      hash: '',
      extensions: { 'x-loop': looping as never },
    };

    // When
    const frozen = (): unknown => freezeDocument(document);

    // Then
    expect(frozen).not.toThrow();
    expect(Object.isFrozen(looping)).toBe(true);
  });
});

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NormalizeError, UsageError } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { loadSpecDocument } from '../../src/cli/infrastructure/adapters/spec-document.adapter';

const MOCKS = fileURLToPath(new URL('../mocks/', import.meta.url));

describe('loadSpecDocument', () => {
  it('should normalize a real spec file into a document', async () => {
    // Given
    const path = resolve(MOCKS, 'mini-spec.json');

    // When
    const loaded = await loadSpecDocument(path);

    // Then
    expect(loaded.document.info.title).toBe('Mini');
    expect(loaded.document.nodes.size).toBe(1);
  });

  it('should resolve close as a no-op', async () => {
    // Given
    const loaded = await loadSpecDocument(resolve(MOCKS, 'mini-spec.json'));

    // When
    const closing = loaded.close();

    // Then
    await expect(closing).resolves.toBeUndefined();
  });

  it('should throw UsageError when the file does not exist', async () => {
    // Given
    const path = resolve(MOCKS, 'does-not-exist.json');

    // When
    const loading = loadSpecDocument(path);

    // Then
    await expect(loading).rejects.toBeInstanceOf(UsageError);
  });

  it('should throw NormalizeError when the file does not parse', async () => {
    // Given
    const path = resolve(MOCKS, 'malformed-spec.json');

    // When
    const loading = loadSpecDocument(path);

    // Then
    await expect(loading).rejects.toBeInstanceOf(NormalizeError);
  });
});

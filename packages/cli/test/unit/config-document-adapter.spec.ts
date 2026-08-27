import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { loadConfigDocument } from '../../src/cli/infrastructure/adapters/config-document.adapter';

const MOCKS = fileURLToPath(new URL('../mocks/', import.meta.url));

describe('loadConfigDocument', () => {
  it('should resolve "spec" against the config file\'s own directory and load it', async () => {
    // Given
    const path = resolve(MOCKS, 'cli-config.json');

    // When
    const loaded = await loadConfigDocument(path);

    // Then
    expect(loaded.document.info.title).toBe('Mini');
  });

  it('should throw UsageError when the config file does not exist', async () => {
    // Given
    const path = resolve(MOCKS, 'does-not-exist.json');

    // When
    const loading = loadConfigDocument(path);

    // Then
    await expect(loading).rejects.toBeInstanceOf(UsageError);
  });

  it('should throw UsageError when the config file is not valid JSON', async () => {
    // Given
    const path = resolve(MOCKS, 'malformed-spec.json');

    // When
    const loading = loadConfigDocument(path);

    // Then
    await expect(loading).rejects.toBeInstanceOf(UsageError);
  });

  it('should throw UsageError when the config names no "spec"', async () => {
    // Given
    const path = resolve(MOCKS, 'cli-config-no-spec.json');

    // When
    const loading = loadConfigDocument(path);

    // Then
    await expect(loading).rejects.toBeInstanceOf(UsageError);
  });
});

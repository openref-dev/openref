import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApplicationBootError, ShutdownTimeoutError } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { loadFromNestApplication } from '../../src/cli/infrastructure/adapters/nest-application.adapter';

const FIXTURES = fileURLToPath(new URL('../mocks/from-nest/', import.meta.url));

describe('loadFromNestApplication', () => {
  it('should extract the document a named "createApp" export mounts', async () => {
    // Given
    const entry = resolve(FIXTURES, 'succeeds.mjs');

    // When
    const loaded = await loadFromNestApplication(entry);

    // Then
    expect(loaded.document.info.title).toBe('Fixture');
  });

  it('should fall back to a default export when there is no "createApp"', async () => {
    // Given
    const entry = resolve(FIXTURES, 'default-export.mjs');

    // When
    const loaded = await loadFromNestApplication(entry);

    // Then
    expect(loaded.document.info.title).toBe('DefaultExport');
  });

  it('should close the application once extraction is done', async () => {
    // Given
    const loaded = await loadFromNestApplication(resolve(FIXTURES, 'succeeds.mjs'));

    // When
    const closing = loaded.close();

    // Then
    await expect(closing).resolves.toBeUndefined();
  });

  it('should report the boot error rather than an empty document when the factory throws', async () => {
    // Given
    const entry = resolve(FIXTURES, 'boot-throws.mjs');

    // When
    const loading = loadFromNestApplication(entry);

    // Then
    await expect(loading).rejects.toBeInstanceOf(ApplicationBootError);
    await expect(loading).rejects.toThrow(/database unreachable/);
  });

  it('should report a boot error when the entry exports no usable factory', async () => {
    // Given
    const entry = resolve(FIXTURES, 'no-export.mjs');

    // When
    const loading = loadFromNestApplication(entry);

    // Then
    await expect(loading).rejects.toBeInstanceOf(ApplicationBootError);
    await expect(loading).rejects.toThrow(/exports neither/);
  });

  it('should report a boot error when the factory does not return a NestJS application', async () => {
    // Given
    const entry = resolve(FIXTURES, 'no-get-method.mjs');

    // When
    const loading = loadFromNestApplication(entry);

    // Then
    await expect(loading).rejects.toBeInstanceOf(ApplicationBootError);
    await expect(loading).rejects.toThrow(/did not return a NestJS application/);
  });

  it('should report a boot error when the application has no document mounted', async () => {
    // Given
    const entry = resolve(FIXTURES, 'no-document-mounted.mjs');

    // When
    const loading = loadFromNestApplication(entry);

    // Then
    await expect(loading).rejects.toBeInstanceOf(ApplicationBootError);
    await expect(loading).rejects.toThrow(/no document mounted/);
  });

  it('should report a boot error when the entry cannot be loaded at all', async () => {
    // Given
    const entry = resolve(FIXTURES, 'does-not-exist.mjs');

    // When
    const loading = loadFromNestApplication(entry);

    // Then
    await expect(loading).rejects.toBeInstanceOf(ApplicationBootError);
    await expect(loading).rejects.toThrow(/could not load/);
  });

  it('should force close and report it when the application does not close within its timeout', async () => {
    // Given
    const loaded = await loadFromNestApplication(resolve(FIXTURES, 'hangs-on-close.mjs'), 20);

    // When
    const closing = loaded.close();

    // Then
    await expect(closing).rejects.toBeInstanceOf(ShutdownTimeoutError);
    await expect(closing).rejects.toThrow(/did not close within 20ms/);
  });

  it('should not hold the process open once a fast close has already won the race', async () => {
    // Given
    const loaded = await loadFromNestApplication(resolve(FIXTURES, 'succeeds.mjs'), 20);
    const started = Date.now();

    // When
    await loaded.close();

    // Then
    expect(Date.now() - started).toBeLessThan(20);
  });
});

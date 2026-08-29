import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode, FederationError, InvalidOptionsError } from '@openref/core';
import { FileCacheAdapter, MemoryCacheAdapter, readCacheRecord } from '../../src/index';
import type { FederationCacheRecord } from '../../src/index';

/**
 * The cache drivers and the record reader: what a revived record must be, and what happens to
 * bytes that are not one.
 */

const RECORD: FederationCacheRecord = {
  url: 'https://billing.internal/openapi.json',
  fetchedAt: '2026-08-28T10:00:00.000Z',
  body: '{"openapi":"3.1.0","info":{"title":"Billing","version":"1"},"paths":{}}',
};

describe('readCacheRecord', () => {
  it('should accept a complete record', () => {
    // Given / When
    const record = readCacheRecord({ ...RECORD });

    // Then
    expect(record).toEqual(RECORD);
  });

  it.each([
    ['not an object', 'text'],
    ['an array', []],
    ['a record with no url', { fetchedAt: RECORD.fetchedAt, body: RECORD.body }],
    ['a record whose fetchedAt is a number', { ...RECORD, fetchedAt: 5 }],
    ['a record with no body', { url: RECORD.url, fetchedAt: RECORD.fetchedAt }],
  ])('should refuse %s with FED_CACHE_INVALID', (_name, value) => {
    // Given / When
    let caught: unknown;
    try {
      readCacheRecord(value);
    } catch (cause) {
      caught = cause;
    }

    // Then
    expect(caught).toBeInstanceOf(FederationError);
    expect((caught as FederationError).code).toBe(ErrorCode.FED_CACHE_INVALID);
  });
});

describe('MemoryCacheAdapter', () => {
  it('should return a saved record for the same remote and URL', async () => {
    // Given
    const driver = new MemoryCacheAdapter();
    await driver.save('billing', RECORD);

    // When
    const loaded = await driver.load('billing', RECORD.url);

    // Then
    expect(loaded).toEqual(RECORD);
  });

  it('should answer nothing for an unknown remote and for a repointed URL', async () => {
    // Given
    const driver = new MemoryCacheAdapter();
    await driver.save('billing', RECORD);

    // When / Then
    expect(await driver.load('orders', RECORD.url)).toBeUndefined();
    expect(
      await driver.load('billing', 'https://billing.moved.internal/openapi.json'),
    ).toBeUndefined();
  });
});

describe('FileCacheAdapter', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'openref-cache-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('should load exactly what was saved, through the disk', async () => {
    // Given
    const driver = new FileCacheAdapter({ directory });
    await driver.save('billing', RECORD);

    // When: a second adapter over the same directory, which is what a new process is
    const loaded = await new FileCacheAdapter({ directory }).load('billing', RECORD.url);

    // Then
    expect(loaded).toEqual(RECORD);
  });

  it('should leave no temporary file beside a completed save', async () => {
    // Given
    const driver = new FileCacheAdapter({ directory });

    // When
    await driver.save('billing', RECORD);

    // Then
    expect(await readdir(directory)).toEqual(['billing.json']);
  });

  it('should answer nothing when there is no file and when the URL moved', async () => {
    // Given
    const driver = new FileCacheAdapter({ directory });
    await driver.save('billing', RECORD);

    // When / Then
    expect(await driver.load('orders', RECORD.url)).toBeUndefined();
    expect(await driver.load('billing', 'https://elsewhere.internal/x')).toBeUndefined();
  });

  it('should refuse a file that is not JSON, by name, rather than treat it as absent', async () => {
    // Given: the file exists and holds something a fetch never wrote
    await writeFile(join(directory, 'billing.json'), 'not json', 'utf8');
    const driver = new FileCacheAdapter({ directory });

    // When
    let caught: unknown;
    try {
      await driver.load('billing', RECORD.url);
    } catch (cause) {
      caught = cause;
    }

    // Then
    expect(caught).toBeInstanceOf(FederationError);
    expect((caught as FederationError).code).toBe(ErrorCode.FED_CACHE_INVALID);
  });

  it('should refuse a JSON file that is not a record', async () => {
    // Given
    await writeFile(join(directory, 'billing.json'), JSON.stringify({ url: 5 }), 'utf8');
    const driver = new FileCacheAdapter({ directory });

    // When / Then
    await expect(driver.load('billing', RECORD.url)).rejects.toMatchObject({
      code: ErrorCode.FED_CACHE_INVALID,
    });
  });

  it('should refuse a remote id outside the service alphabet before touching a path', async () => {
    // Given
    const driver = new FileCacheAdapter({ directory });

    // When
    let caught: unknown;
    try {
      await driver.load('../escape', RECORD.url);
    } catch (cause) {
      caught = cause;
    }

    // Then: refused as options, and nothing outside the directory was ever addressed
    expect(caught).toBeInstanceOf(InvalidOptionsError);
    await expect(driver.save('../escape', RECORD)).rejects.toBeInstanceOf(InvalidOptionsError);
    expect(await readdir(directory)).toEqual([]);
  });
});

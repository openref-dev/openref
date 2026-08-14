import { describe, expect, it } from 'vitest';
import { createNavigationStore } from '../../src/page/api/nav-context';
import { readNavigationPayload } from '../../src/page/domain/nav-source';
import type { NavEntryModel } from '../../src/page/domain/nav-entry';

const HASH = 'a1b2c3';

function entry(id: string): NavEntryModel {
  return {
    id,
    label: id,
    kind: 'node',
    nodeId: id,
    schemaId: null,
    deprecated: false,
    driftCount: 0,
    hint: '',
    childCount: 0,
    children: [],
  };
}

describe('readNavigationPayload', () => {
  it('should return the entries of a payload about this document', () => {
    // Given
    const payload = { documentHash: HASH, navigation: [entry('a')] };

    // When
    const entries = readNavigationPayload(payload, HASH);

    // Then
    expect(entries).toHaveLength(1);
  });

  it('should refuse a payload about another document', () => {
    // Given a hash addressed url can still answer with the wrong thing, through a proxy that
    // rewrites or a cache that outlived a deployment
    const payload = { documentHash: 'other', navigation: [entry('a')] };

    // When
    // Then
    expect(() => readNavigationPayload(payload, HASH)).toThrow(/other/);
  });

  it('should refuse a payload with no navigation in it', () => {
    // Given
    // When
    // Then
    expect(() => readNavigationPayload({ documentHash: HASH }, HASH)).toThrow(/no navigation/);
    expect(() => readNavigationPayload(null, HASH)).toThrow(/not an object/);
  });
});

describe('createNavigationStore', () => {
  it('should serve the slice until the rest is loaded, then the rest', async () => {
    // Given
    const whole = [entry('a'), entry('b')];
    const store = createNavigationStore({
      entries: [entry('a')],
      complete: false,
      loader: () => Promise.resolve(whole),
    });

    // When
    expect(store.entries.value).toHaveLength(1);
    const loaded = await store.load();

    // Then
    expect(loaded).toBe(true);
    expect(store.entries.value).toHaveLength(2);
    expect(store.complete.value).toBe(true);
  });

  it('should fetch once however many callers ask at once', async () => {
    // Given, because the sidebar and the palette ask the same question and the payload is the
    // whole navigation
    let calls = 0;
    const store = createNavigationStore({
      entries: [],
      complete: false,
      loader: () => {
        calls += 1;
        return Promise.resolve([entry('a')]);
      },
    });

    // When
    await Promise.all([store.load(), store.load(), store.load()]);
    await store.load();

    // Then
    expect(calls).toBe(1);
  });

  it('should keep the page working and say so when the fetch fails', async () => {
    // Given
    const store = createNavigationStore({
      entries: [entry('a')],
      complete: false,
      loader: () => Promise.reject(new Error('offline')),
    });

    // When
    const loaded = await store.load();

    // Then the slice is still there, which is enough to read this page
    expect(loaded).toBe(false);
    expect(store.entries.value).toHaveLength(1);
    expect(store.failed.value).toBe(true);
    expect(store.complete.value).toBe(false);
  });

  it('should try again after a failure, since the next attempt may be on a working network', async () => {
    // Given
    let attempts = 0;
    const store = createNavigationStore({
      entries: [],
      complete: false,
      loader: () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error('offline'))
          : Promise.resolve([entry('a')]);
      },
    });

    // When
    await store.load();
    const second = await store.load();

    // Then
    expect(second).toBe(true);
    expect(attempts).toBe(2);
    expect(store.failed.value).toBe(false);
  });

  it('should ask for nothing when the page shipped everything', async () => {
    // Given
    let calls = 0;
    const store = createNavigationStore({
      entries: [entry('a')],
      complete: true,
      loader: () => {
        calls += 1;
        return Promise.resolve([]);
      },
    });

    // When
    // Then
    expect(await store.load()).toBe(true);
    expect(calls).toBe(0);
  });

  it('should report that it cannot complete when no loader was supplied', async () => {
    // Given a server render, where fetching is not merely unavailable but wrong
    const store = createNavigationStore({ entries: [entry('a')], complete: false });

    // When
    // Then
    expect(await store.load()).toBe(false);
    expect(store.failed.value).toBe(false);
  });
});

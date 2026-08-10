import { describe, expect, it } from 'vitest';
import {
  createMemoryRenderCache,
  DEFAULT_MEMORY_CACHE_ENTRIES,
} from '../../src/cache/infrastructure/adapters/memory-render-cache.adapter';
import type { RenderedPage } from '../../src/cache/application/ports/render-cache.port';

function page(id: string): RenderedPage {
  return {
    documentHash: 'h',
    nodeId: id,
    schemaId: null,
    title: id,
    appHtml: `<div>${id}</div>`,
    stateJson: '{}',
  };
}

describe('createMemoryRenderCache', () => {
  it('should report a miss for a key it was never given', async () => {
    // Given
    const cache = createMemoryRenderCache();

    // When
    const result = await cache.get('absent');

    // Then
    expect(result).toBeUndefined();
    expect(cache.stats()).toMatchObject({ hits: 0, misses: 1, entries: 0 });
  });

  it('should return what it stored and count the hit', async () => {
    // Given
    const cache = createMemoryRenderCache();
    await cache.set('a', page('a'));

    // When
    const result = await cache.get('a');

    // Then
    expect(result).toEqual(page('a'));
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 0, entries: 1 });
  });

  it('should evict the least recently used entry when it is full', async () => {
    // Given
    const cache = createMemoryRenderCache({ maxEntries: 2 });
    await cache.set('a', page('a'));
    await cache.set('b', page('b'));

    // When
    await cache.get('a');
    await cache.set('c', page('c'));

    // Then
    expect(await cache.get('b')).toBeUndefined();
    expect(await cache.get('a')).toEqual(page('a'));
    expect(cache.stats().evictions).toBe(1);
  });

  it('should overwrite rather than duplicate a key it already holds', async () => {
    // Given
    const cache = createMemoryRenderCache({ maxEntries: 2 });

    // When
    await cache.set('a', page('a'));
    await cache.set('a', page('a2'));

    // Then
    expect(await cache.get('a')).toEqual(page('a2'));
    expect(cache.stats().entries).toBe(1);
  });

  it('should hold at least one entry however small the bound is asked to be', async () => {
    // Given
    const cache = createMemoryRenderCache({ maxEntries: 0 });

    // When
    await cache.set('a', page('a'));

    // Then
    expect(await cache.get('a')).toEqual(page('a'));
  });

  it('should drop everything on clear', async () => {
    // Given
    const cache = createMemoryRenderCache();
    await cache.set('a', page('a'));

    // When
    await cache.clear();

    // Then
    expect(await cache.get('a')).toBeUndefined();
    expect(cache.stats().entries).toBe(0);
  });

  it('should default to a bound rather than growing without one', async () => {
    // Given
    const cache = createMemoryRenderCache();

    // When
    for (let index = 0; index <= DEFAULT_MEMORY_CACHE_ENTRIES; index += 1) {
      await cache.set(String(index), page(String(index)));
    }

    // Then
    expect(cache.stats().entries).toBe(DEFAULT_MEMORY_CACHE_ENTRIES);
    expect(cache.stats().evictions).toBe(1);
  });
});

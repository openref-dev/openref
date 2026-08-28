import { describe, expect, it, vi } from 'vitest';
import { createSearchStore } from '../../src/page/api/search-context';
import type { SearchIndexPort } from '../../src/page/domain/search-source';

/**
 * The store the palette keeps its index in.
 *
 * The navigation store's three properties, held for the same reasons: one fetch however many
 * callers ask, a failure that leaves the page working, and a state a reader can be told about
 * while the payload is in flight. What differs is the consequence of failing. A sidebar that
 * cannot complete is a sidebar showing a slice; a search index that cannot be loaded is a
 * palette matching navigation rows, which is what it did before the index reached it at all.
 */

/** An index that says which document it is about and finds nothing, which is all that is read. */
function port(documentHash = 'sha256:one'): SearchIndexPort {
  return { documentHash, search: () => [] };
}

describe('createSearchStore', () => {
  it('should report itself unavailable, and fetch nothing, with no loader wired in', async () => {
    // Given the build that supplies no port, which is every build before T042
    const store = createSearchStore({ documentHash: 'sha256:one' });

    // When
    const loaded = await store.load();

    // Then
    expect(loaded).toBe(false);
    expect(store.available.value).toBe(false);
    expect(store.failed.value).toBe(false);
  });

  it('should load once however many times the palette is opened', async () => {
    // Given
    const loader = vi.fn(() => Promise.resolve(port()));
    const store = createSearchStore({ documentHash: 'sha256:one', loader });

    // When two opens race and a third follows the first
    await Promise.all([store.load(), store.load()]);
    await store.load();

    // Then
    expect(loader).toHaveBeenCalledTimes(1);
    expect(store.available.value).toBe(true);
    expect(store.pending.value).toBe(false);
  });

  it('should fail open and say so when the index cannot be fetched', async () => {
    // Given a network that is not there
    const store = createSearchStore({
      documentHash: 'sha256:one',
      loader: () => Promise.reject(new Error('offline')),
    });

    // When
    const loaded = await store.load();

    // Then nothing is thrown into the page, and the palette can tell the reader what it searched
    expect(loaded).toBe(false);
    expect(store.failed.value).toBe(true);
    expect(store.available.value).toBe(false);
    expect(store.pending.value).toBe(false);
  });

  it('should try again on a later open, because the first attempt may have been made offline', async () => {
    // Given a loader that fails once and then works
    const loader = vi
      .fn<() => Promise<SearchIndexPort>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(port());
    const store = createSearchStore({ documentHash: 'sha256:one', loader });

    // When
    await store.load();
    await store.load();

    // Then
    expect(loader).toHaveBeenCalledTimes(2);
    expect(store.available.value).toBe(true);
    expect(store.failed.value).toBe(false);
  });

  it('should refuse an index about another document rather than searching a stale one', async () => {
    // Given a served index that is about something else
    const store = createSearchStore({
      documentHash: 'sha256:new',
      loader: () => Promise.resolve(port('sha256:old')),
    });

    // When
    const loaded = await store.load();

    // Then the refusal is a failed load rather than an exception, so the palette keeps working
    expect(loaded).toBe(false);
    expect(store.available.value).toBe(false);
    expect(store.failed.value).toBe(true);
  });

  it('should be pending while the load is in flight, which is what the palette says', async () => {
    // Given a loader that has not answered yet
    let settle: (value: SearchIndexPort) => void = () => undefined;
    const store = createSearchStore({
      documentHash: 'sha256:one',
      loader: () => new Promise<SearchIndexPort>((resolve) => (settle = resolve)),
    });

    // When
    const inFlight = store.load();

    // Then, and the state is asserted able to change, which is the next two lines
    expect(store.pending.value).toBe(true);
    settle(port());
    await inFlight;
    expect(store.pending.value).toBe(false);
    expect(store.available.value).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { searchIndexHref, SEARCH_INDEX_SEGMENT } from '../../src/page/domain/links';
import { readSearchIndex, type SearchIndexPort } from '../../src/page/domain/search-source';

/**
 * The address of the full text index and the refusal that guards what comes back from it.
 *
 * `_navigation` is addressed by document hash and `readNavigationPayload` checks the payload all
 * the same. `_search-index` is one address per mount, per SPEC 13.3, so a deployment that
 * changes the document leaves the url alone: a cache, a proxy or a host that mounted two
 * references can answer it with an index of another document, and a palette that searched it
 * would offer a reader operations that are not in the reference they are reading.
 */

/** A port that indexes nothing and says which document it is about, which is all that is read. */
function port(documentHash: string): SearchIndexPort {
  return { documentHash, search: () => [] };
}

describe('searchIndexHref', () => {
  it('should address the mount point and nothing else, so no host name can enter', () => {
    // Given a reference mounted under a path

    // When
    const href = searchIndexHref('/docs');

    // Then
    expect(href).toBe('/docs/_search-index');
    expect(href.startsWith('/')).toBe(true);
    expect(href).not.toMatch(/^[a-z][a-z0-9+.-]*:/i);
  });

  it('should address the root when the reference is mounted at it', () => {
    // Given a reference at the root

    // When
    const href = searchIndexHref();

    // Then
    expect(href).toBe(`/${SEARCH_INDEX_SEGMENT}`);
  });
});

describe('readSearchIndex', () => {
  it('should return the index when it is about the document the page is about', () => {
    // Given
    const index = port('sha256:one');

    // When
    const read = readSearchIndex(index, 'sha256:one');

    // Then
    expect(read).toBe(index);
  });

  it('should refuse an index about another document, naming both', () => {
    // Given an index a cache answered with after the document changed
    const index = port('sha256:old');

    // When, Then, and the message names both so the reason is in the log rather than guessed at
    expect(() => readSearchIndex(index, 'sha256:new')).toThrow(/sha256:old/);
    expect(() => readSearchIndex(index, 'sha256:new')).toThrow(/sha256:new/);
  });
});

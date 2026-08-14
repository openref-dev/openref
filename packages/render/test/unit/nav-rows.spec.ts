import { describe, expect, it } from 'vitest';
import {
  chunkAt,
  chunkOfActive,
  chunkRows,
  chunkWindow,
  flattenNavigation,
  NAV_CHUNK_ROWS,
  NAV_CHUNK_WINDOW,
  NAV_MAX_ROWS,
} from '../../src/page/domain/nav-rows';
import type { NavEntryModel } from '../../src/page/domain/page-model';

function entry(id: string, children: NavEntryModel[] = [], nodeId?: string): NavEntryModel {
  return {
    id,
    label: id,
    kind: children.length > 0 ? 'group' : 'node',
    nodeId: nodeId ?? null,
    schemaId: null,
    deprecated: false,
    driftCount: 0,
    hint: '',
    method: '',
    childCount: children.length,
    children,
  };
}

describe('flattenNavigation', () => {
  it('should put a parent before its children and record the depth', () => {
    // Given
    const entries = [entry('a', [entry('b', [entry('c')])]), entry('d')];

    // When
    const rows = flattenNavigation(entries);

    // Then
    expect(rows.map((row) => row.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(rows.map((row) => row.level)).toEqual([1, 2, 3, 1]);
  });
});

describe('chunkRows', () => {
  it('should cut the rows into groups of the chunk size, the last one short', () => {
    // Given
    const rows = flattenNavigation(
      Array.from({ length: NAV_CHUNK_ROWS + 3 }, (_, index) => entry(`n${String(index)}`)),
    );

    // When
    const chunks = chunkRows(rows);

    // Then
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(NAV_CHUNK_ROWS);
    expect(chunks[1]).toHaveLength(3);
  });

  it('should produce one empty chunk for a navigation with nothing in it', () => {
    // Given, a component that rendered no chunk at all would have nothing to attach the scroll
    // handler to and no height to reserve.
    const chunks = chunkRows([]);

    // Then
    expect(chunks).toEqual([[]]);
  });
});

describe('chunkAt', () => {
  it('should read the chunk in view off the scroll fraction', () => {
    // Given, a container scrolled to the middle of ten chunks.
    const position = { scrollTop: 500, scrollHeight: 1200, clientHeight: 200 };

    // When
    const at = chunkAt(position, 11);

    // Then
    expect(at).toBe(5);
  });

  it('should answer the first chunk when there is nothing to scroll', () => {
    // Given, a sidebar shorter than its container. Dividing by the scrollable height here would
    // be a division by zero and the window would land on NaN.
    const position = { scrollTop: 0, scrollHeight: 200, clientHeight: 200 };

    // When
    const at = chunkAt(position, 3);

    // Then
    expect(at).toBe(0);
  });

  it('should clamp a scroll position past the end', () => {
    // Given, an elastic scroll on a trackpad reports a scrollTop past the maximum.
    const position = { scrollTop: 5000, scrollHeight: 1200, clientHeight: 200 };

    // When
    const at = chunkAt(position, 4);

    // Then
    expect(at).toBe(3);
  });
});

describe('chunkWindow', () => {
  it('should render the chunk in view and one on each side', () => {
    // Given
    const window = chunkWindow(5, 10);

    // Then
    expect(window).toEqual([4, 5, 6]);
  });

  it('should not run past either end', () => {
    // Given
    expect(chunkWindow(0, 10)).toEqual([0, 1]);
    expect(chunkWindow(9, 10)).toEqual([8, 9]);
  });

  it('should keep the document under the ceiling SPEC 11 sets', () => {
    // Given, the ceiling is a consequence of the two constants rather than a number checked
    // somewhere else, so this is where the two are compared with the spec figure.
    const rows = NAV_CHUNK_ROWS * (NAV_CHUNK_WINDOW * 2 + 1);

    // Then
    expect(rows).toBe(NAV_MAX_ROWS);
    expect(NAV_MAX_ROWS).toBeLessThanOrEqual(60);
  });
});

describe('chunkOfActive', () => {
  it('should open the window on the chunk holding the page own entry', () => {
    // Given, a reader arriving at an operation should see it in the sidebar rather than at the
    // top of a list of two thousand.
    const rows = flattenNavigation(
      Array.from({ length: 100 }, (_, index) =>
        entry(`n${String(index)}`, [], `node-${String(index)}`),
      ),
    );

    // When
    const at = chunkOfActive(rows, 'node-45', null);

    // Then
    expect(at).toBe(Math.floor(45 / NAV_CHUNK_ROWS));
  });

  it('should open at the top when nothing on the page is in the navigation', () => {
    // Given, the overview, which is a page with no entry of its own.
    const rows = flattenNavigation([entry('a', [], 'node-1')]);

    // When
    const at = chunkOfActive(rows, null, null);

    // Then
    expect(at).toBe(0);
  });
});

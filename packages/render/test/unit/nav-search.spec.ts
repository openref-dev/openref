import { describe, expect, it } from 'vitest';
import { flattenNavigation, type NavRow } from '../../src/page/domain/nav-rows';
import { NAV_HIT_LIMIT, searchNavigation } from '../../src/page/domain/nav-search';
import type { NavEntryModel } from '../../src/page/domain/page-model';

function entry(overrides: Partial<NavEntryModel> & { id: string }): NavEntryModel {
  return {
    label: overrides.id,
    kind: 'node',
    nodeId: overrides.id,
    schemaId: null,
    deprecated: false,
    driftCount: 0,
    hint: '',
    childCount: overrides.children?.length ?? 0,
    children: [],
    ...overrides,
  };
}

function rows(...entries: NavEntryModel[]): NavRow[] {
  return flattenNavigation(entries);
}

describe('searchNavigation', () => {
  it('should return nothing for a blank query', () => {
    // Given, an empty palette shows a prompt rather than every entry in the document.
    const found = searchNavigation(rows(entry({ id: 'a' })), '   ');

    // Then
    expect(found).toEqual([]);
  });

  it('should match the path even when the label is a summary', () => {
    // Given, this is the whole reason a hint is carried: a document whose authors wrote
    // summaries has no path anywhere in its labels.
    const list = rows(entry({ id: 'get-orders', label: 'List orders', hint: 'GET /orders' }));

    // When
    const found = searchNavigation(list, '/orders');

    // Then
    expect(found.map((hit) => hit.row.id)).toEqual(['get-orders']);
  });

  it('should rank a label match above a hint match', () => {
    // Given
    const list = rows(
      entry({ id: 'by-hint', label: 'Something else', hint: 'GET /orders' }),
      entry({ id: 'by-label', label: 'Orders overview', hint: 'GET /x' }),
    );

    // When
    const found = searchNavigation(list, 'orders');

    // Then
    expect(found.map((hit) => hit.row.id)).toEqual(['by-label', 'by-hint']);
  });

  it('should rank a prefix above the start of a later word above a substring', () => {
    // Given
    const list = rows(
      entry({ id: 'substring', label: 'unordered' }),
      entry({ id: 'word', label: 'List order' }),
      entry({ id: 'prefix', label: 'order list' }),
    );

    // When
    const found = searchNavigation(list, 'order');

    // Then
    expect(found.map((hit) => hit.row.id)).toEqual(['prefix', 'word', 'substring']);
  });

  it('should never return a group, which has no page to go to', () => {
    // Given, a palette entry that navigates nowhere is worse than one that is missing.
    const list = rows(
      entry({ id: 'orders-group', kind: 'group', nodeId: null, label: 'Orders' }),
      entry({ id: 'orders-node', label: 'Orders list' }),
    );

    // When
    const found = searchNavigation(list, 'orders');

    // Then
    expect(found.map((hit) => hit.row.id)).toEqual(['orders-node']);
  });

  it('should find a schema, which has a page of its own', () => {
    // Given
    const list = rows(
      entry({ id: 'Order', kind: 'schema', nodeId: null, schemaId: 'Order', label: 'Order' }),
    );

    // When
    const found = searchNavigation(list, 'ord');

    // Then
    expect(found.map((hit) => hit.row.schemaId)).toEqual(['Order']);
  });

  it('should keep document order among equal scores', () => {
    // Given, a stable list is what makes the same keystroke select the same result twice.
    const list = rows(
      entry({ id: 'a', label: 'order a' }),
      entry({ id: 'b', label: 'order b' }),
      entry({ id: 'c', label: 'order c' }),
    );

    // When
    const found = searchNavigation(list, 'order');

    // Then
    expect(found.map((hit) => hit.row.id)).toEqual(['a', 'b', 'c']);
  });

  it('should stop at the limit', () => {
    // Given
    const list = rows(
      ...Array.from({ length: NAV_HIT_LIMIT + 5 }, (_, index) =>
        entry({ id: `order-${String(index)}`, label: `order ${String(index)}` }),
      ),
    );

    // When
    const found = searchNavigation(list, 'order');

    // Then
    expect(found).toHaveLength(NAV_HIT_LIMIT);
  });

  it('should ignore case on both sides', () => {
    // Given
    const list = rows(entry({ id: 'a', label: 'List Orders', hint: 'GET /Orders' }));

    // When
    const found = searchNavigation(list, 'ORDERS');

    // Then
    expect(found).toHaveLength(1);
  });
});

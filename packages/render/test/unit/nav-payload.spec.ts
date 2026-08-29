import { describe, expect, it } from 'vitest';
import { ancestorsOfActive, sliceNavigation } from '../../src/page/domain/nav-payload';
import { buildNavigation } from '../../src/page/domain/page-model';
import type { NavEntryModel } from '../../src/page/domain/nav-entry';
import { largeDocument, smallDocument } from '../mocks/documents';

function entry(id: string, children: NavEntryModel[] = [], nodeId?: string): NavEntryModel {
  return {
    id,
    label: id,
    kind: children.length > 0 ? 'group' : 'node',
    nodeId: nodeId ?? null,
    schemaId: null,
    serviceId: null,
    deprecated: false,
    driftCount: 0,
    hint: '',
    method: '',
    sse: false,
    childCount: children.length,
    children,
  };
}

describe('ancestorsOfActive', () => {
  it('should name every group between the root and the active entry', () => {
    // Given
    const entries = [entry('a', [entry('b', [entry('c', [], 'node-c')])]), entry('d')];

    // When
    const path = ancestorsOfActive(entries, 'node-c', null);

    // Then
    expect(path).toEqual(['a', 'b']);
  });

  it('should name nothing when the page is about nothing in the navigation', () => {
    // Given, which is the overview page and also a node the navigation does not list
    const entries = [entry('a', [entry('b', [], 'node-b')])];

    // When
    // Then
    expect(ancestorsOfActive(entries, null, null)).toEqual([]);
    expect(ancestorsOfActive(entries, 'node-missing', null)).toEqual([]);
  });

  it('should find a schema page the same way it finds a node page', () => {
    // Given, since the Schemas group is a group like any other
    const schema: NavEntryModel = { ...entry('s'), schemaId: 'Order' };
    const entries = [entry('schemas', [schema])];

    // When
    // Then
    expect(ancestorsOfActive(entries, null, 'Order')).toEqual(['schemas']);
  });
});

describe('sliceNavigation', () => {
  it('should ship the group holding the page and close every other one', () => {
    // Given
    const entries = [
      entry('open', [entry('here', [], 'node-here'), entry('beside', [], 'node-beside')]),
      entry('closed', [entry('elsewhere', [], 'node-elsewhere')]),
    ];

    // When
    const slice = sliceNavigation(entries, 'node-here', null);

    // Then the reader sees the entry and its neighbours without asking for anything
    expect(slice.entries[0]?.children.map((child) => child.id)).toEqual(['here', 'beside']);

    // And the other group is a header that says how much is behind it
    expect(slice.entries[1]?.children).toEqual([]);
    expect(slice.entries[1]?.childCount).toBe(1);
  });

  it('should report what it left behind rather than leaving it to be inferred', () => {
    // Given
    const entries = [entry('a', [entry('one'), entry('two')]), entry('b', [entry('three')])];

    // When
    const slice = sliceNavigation(entries, null, null);

    // Then
    expect(slice.shipped).toBe(2);
    expect(slice.total).toBe(5);
    expect(slice.complete).toBe(false);
  });

  it('should call itself complete when there was nothing to leave behind', () => {
    // Given a flat navigation, which a document with no tags produces
    const entries = [entry('one', [], 'node-one'), entry('two', [], 'node-two')];

    // When
    const slice = sliceNavigation(entries, 'node-one', null);

    // Then nothing can be fetched and nothing needs to be
    expect(slice.complete).toBe(true);
    expect(slice.entries).toEqual(entries);
  });

  it('should keep the whole navigation reachable from the counts it ships', () => {
    // Given, because a closed group and an empty group are the same shape without the count,
    // and the sidebar would then offer to open a group with nothing in it
    const document = smallDocument();

    // When
    const slice = sliceNavigation(buildNavigation(document), null, null);

    // Then
    const closed = slice.entries.filter((navEntry) => navEntry.childCount > 0);
    expect(closed.length).toBeGreaterThan(0);
    expect(closed.every((navEntry) => navEntry.children.length === 0)).toBe(true);
  });

  it('should take a thousand node document to a fraction of its navigation', () => {
    // Given the measurement this whole change came from: 1022 rows in the state of every page
    const document = largeDocument(1000);
    const navigation = buildNavigation(document);
    const nodeId = [...document.nodes.keys()][500] ?? '';

    // When
    const slice = sliceNavigation(navigation, nodeId, null);

    // Then, one group and the headers of the rest
    expect(slice.total).toBeGreaterThan(1000);
    expect(slice.shipped).toBeLessThan(100);

    // And the bytes, which is the quantity the budget is about
    expect(JSON.stringify(slice.entries).length).toBeLessThan(
      JSON.stringify(navigation).length / 10,
    );
  });
});

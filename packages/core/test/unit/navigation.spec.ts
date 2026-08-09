import { describe, expect, it } from 'vitest';
import type { IRNavNode, IRNode, IROperation, IRSchema } from '../../src/index';
import { buildNavigation } from '../../src/index';

function operation(id: string, tags: readonly string[], summary?: string): IROperation {
  const node: { -readonly [Key in keyof IROperation]: IROperation[Key] } = {
    kind: 'operation',
    id,
    method: 'get',
    path: `/${id}`,
    tags,
    deprecated: false,
    parameters: [],
    responses: [],
    security: [],
    servers: [],
  };
  if (summary !== undefined) node.summary = summary;
  return node;
}

function ids(navigation: readonly IRNavNode[]): string[] {
  return navigation.flatMap((entry) => [entry.id, ...ids(entry.children)]);
}

describe('buildNavigation', () => {
  it('should group nodes under their first tag in tag declaration order', () => {
    // Given
    const nodes: IRNode[] = [operation('a', ['second']), operation('b', ['first'])];

    // When
    const navigation = buildNavigation({
      tags: [{ name: 'first' }, { name: 'second' }],
      nodes,
    });

    // Then
    expect(navigation.map((entry) => entry.id)).toEqual(['group-first', 'group-second']);
    expect(navigation[0]?.children.map((child) => child.nodeId)).toEqual(['b']);
  });

  it('should place a node under its first tag only, so it appears once', () => {
    // Given
    const nodes: IRNode[] = [operation('a', ['one', 'two'])];

    // When
    const navigation = buildNavigation({ tags: [{ name: 'one' }, { name: 'two' }], nodes });

    // Then
    expect(ids(navigation).filter((id) => id === 'nav-a')).toHaveLength(1);
  });

  it('should append an undeclared tag when it is first met rather than dropping the node', () => {
    // Given
    const nodes: IRNode[] = [operation('a', ['declared']), operation('b', ['surprise'])];

    // When
    const navigation = buildNavigation({ tags: [{ name: 'declared' }], nodes });

    // Then
    expect(navigation.map((entry) => entry.id)).toEqual(['group-declared', 'group-surprise']);
  });

  it('should collect untagged nodes into a group of their own, placed last', () => {
    // Given
    const nodes: IRNode[] = [operation('a', ['tagged']), operation('b', [])];

    // When
    const navigation = buildNavigation({ tags: [{ name: 'tagged' }], nodes });

    // Then
    expect(navigation.map((entry) => entry.id)).toEqual(['group-tagged', 'group-untagged']);
  });

  it('should nest a tag under its declared parent', () => {
    // Given
    const nodes: IRNode[] = [operation('a', ['child'])];

    // When
    const navigation = buildNavigation({
      tags: [{ name: 'parent' }, { name: 'child', parent: 'parent' }],
      nodes,
    });

    // Then
    expect(navigation.map((entry) => entry.id)).toEqual(['group-parent']);
    expect(navigation[0]?.children.map((child) => child.id)).toEqual(['group-child']);
  });

  it('should keep a tag at the top level when its parent does not exist', () => {
    // Given
    const nodes: IRNode[] = [operation('a', ['orphan'])];

    // When
    const navigation = buildNavigation({
      tags: [{ name: 'orphan', parent: 'nowhere' }],
      nodes,
    });

    // Then
    expect(navigation.map((entry) => entry.id)).toEqual(['group-orphan']);
  });

  it('should keep both tags at the top level when the parent chain is a cycle', () => {
    // Given
    const nodes: IRNode[] = [operation('a', ['left']), operation('b', ['right'])];

    // When
    const navigation = buildNavigation({
      tags: [
        { name: 'left', parent: 'right' },
        { name: 'right', parent: 'left' },
      ],
      nodes,
    });

    // Then
    expect(navigation.map((entry) => entry.id)).toEqual(['group-left', 'group-right']);
  });

  it('should keep a tag that declares itself as its own parent at the top level', () => {
    // Given
    const nodes: IRNode[] = [operation('a', ['self'])];

    // When
    const navigation = buildNavigation({ tags: [{ name: 'self', parent: 'self' }], nodes });

    // Then
    expect(navigation.map((entry) => entry.id)).toEqual(['group-self']);
  });

  it('should drop a declared tag that holds nothing', () => {
    // Given
    const nodes: IRNode[] = [operation('a', ['used'])];

    // When
    const navigation = buildNavigation({
      tags: [{ name: 'used' }, { name: 'unused' }],
      nodes,
    });

    // Then
    expect(navigation.map((entry) => entry.id)).toEqual(['group-used']);
  });

  it('should use a tag summary as the group label when there is one', () => {
    // Given
    const nodes: IRNode[] = [operation('a', ['orders'])];

    // When
    const navigation = buildNavigation({
      tags: [{ name: 'orders', summary: 'Order management' }],
      nodes,
    });

    // Then
    expect(navigation[0]?.label).toBe('Order management');
  });

  it('should label a node with its summary and fall back to method and path', () => {
    // Given
    const nodes: IRNode[] = [operation('a', ['t'], 'List things'), operation('b', ['t'])];

    // When
    const navigation = buildNavigation({ tags: [{ name: 't' }], nodes });

    // Then
    expect(navigation[0]?.children.map((child) => child.label)).toEqual(['List things', 'GET /b']);
  });

  it('should append a schemas group when there are named schemas', () => {
    // Given
    const schemas: IRSchema[] = [
      { id: 'Order', name: 'Order', dialect: 'json-schema-2020-12' },
      { id: 'Problem', name: 'Problem', dialect: 'json-schema-2020-12' },
    ];

    // When
    const navigation = buildNavigation({ tags: [], nodes: [operation('a', [])], schemas });

    // Then
    const group = navigation.at(-1);
    expect(group?.id).toBe('group-schemas');
    expect(group?.children.map((child) => child.schemaId)).toEqual(['Order', 'Problem']);
    expect(group?.children.every((child) => child.kind === 'schema')).toBe(true);
  });

  it('should mark a deprecated node', () => {
    // Given
    const deprecated: IRNode = { ...operation('a', ['t']), deprecated: true };

    // When
    const navigation = buildNavigation({ tags: [{ name: 't' }], nodes: [deprecated] });

    // Then
    expect(navigation[0]?.children[0]?.deprecated).toBe(true);
  });

  it('should label a channel by its title, then its address, then its id', () => {
    // Given
    const base = {
      kind: 'channel' as const,
      tags: ['events'],
      deprecated: false,
      servers: [],
      operations: [],
      messages: [],
    };
    const nodes: IRNode[] = [
      { ...base, id: 'titled', title: 'Order created' },
      { ...base, id: 'addressed', address: 'order.updated' },
      { ...base, id: 'bare' },
    ];

    // When
    const navigation = buildNavigation({ tags: [{ name: 'events' }], nodes });

    // Then
    expect(navigation[0]?.children.map((child) => child.label)).toEqual([
      'Order created',
      'order.updated',
      'bare',
    ]);
  });

  it('should return nothing for a document with no nodes and no schemas', () => {
    // Given
    const nodes: IRNode[] = [];

    // When
    const navigation = buildNavigation({ tags: [{ name: 'declared' }], nodes });

    // Then
    expect(navigation).toEqual([]);
  });
});

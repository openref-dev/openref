import { describe, expect, it } from 'vitest';
import { createDocState, materializeNode, resolveSchemaSlot } from '../../src/index';
import { simpleDocument } from '../mocks/documents';

describe('createDocState', () => {
  it('should produce instances that share no state, so two references can be mounted at once', () => {
    // Given
    const document = simpleDocument();

    // When
    const first = createDocState({ document });
    const second = createDocState({ document });
    first.activeNodeId.value = 'get-orders';
    first.query.value = 'orders';
    first.view.value = 'request';
    first.expandedPaths.value = new Set(['Order']);

    // Then
    expect(second.activeNodeId.value).toBeUndefined();
    expect(second.query.value).toBe('');
    expect(second.view.value).toBe('both');
    expect([...second.expandedPaths.value]).toEqual([]);
  });

  it('should start from the options it was given', () => {
    // Given
    const document = simpleDocument();

    // When
    const state = createDocState({ document, activeNodeId: 'get-orders', view: 'response' });

    // Then
    expect(state.activeNodeId.value).toBe('get-orders');
    expect(state.view.value).toBe('response');
    expect(state.document.value.info.title).toBe('Orders API');
  });

  it('should materialize a node only when it is asked for', () => {
    // Given
    const state = createDocState({ document: simpleDocument() });

    // When
    const before = state.isMaterialized('get-orders');
    state.nodeView('get-orders');

    // Then
    expect(before).toBe(false);
    expect(state.isMaterialized('get-orders')).toBe(true);
    expect(state.isMaterialized('post-orders')).toBe(false);
  });

  it('should return the same materialized view on a second call rather than deriving it twice', () => {
    // Given
    const state = createDocState({ document: simpleDocument() });

    // When
    const first = state.nodeView('get-orders');
    const second = state.nodeView('get-orders');

    // Then
    expect(first).toBeDefined();
    expect(second).toBe(first);
  });

  it('should return undefined for an id no node carries', () => {
    // Given
    const state = createDocState({ document: simpleDocument() });

    // When
    const view = state.nodeView('nothing-here');

    // Then
    expect(view).toBeUndefined();
    expect(state.isMaterialized('nothing-here')).toBe(false);
  });

  it('should follow the active node id through the computed view', () => {
    // Given
    const state = createDocState({ document: simpleDocument() });

    // When
    state.activeNodeId.value = 'post-orders';

    // Then
    expect(state.activeNode.value?.id).toBe('post-orders');
  });

  it('should drop every cached view when the document is replaced', () => {
    // Given
    const state = createDocState({ document: simpleDocument() });
    state.nodeView('get-orders');

    // When
    state.setDocument(simpleDocument());

    // Then
    expect(state.isMaterialized('get-orders')).toBe(false);
  });

  it('should drop every cached view when invalidated directly', () => {
    // Given
    const state = createDocState({ document: simpleDocument() });
    state.nodeView('get-orders');

    // When
    state.invalidate();

    // Then
    expect(state.isMaterialized('get-orders')).toBe(false);
  });
});

describe('materializeNode', () => {
  it('should group parameters by location and drop the locations with none', () => {
    // Given
    const document = simpleDocument();
    const node = document.nodes.get('get-orders');

    // When
    const view = materializeNode(node!, document);

    // Then
    expect(view.kind).toBe('operation');
    if (view.kind !== 'operation') throw new Error('expected an operation');
    expect([...view.parameters.keys()]).toEqual(['query', 'header']);
    expect(view.parameters.get('query')?.[0]?.name).toBe('limit');
  });

  it('should resolve a security requirement to the scheme the document declared', () => {
    // Given
    const document = simpleDocument();
    const node = document.nodes.get('get-orders');

    // When
    const view = materializeNode(node!, document);

    // Then
    if (view.kind !== 'operation') throw new Error('expected an operation');
    expect(view.security).toHaveLength(1);
    expect(view.security[0]?.scheme?.scheme).toBe('bearer');
  });

  it('should title an operation by its summary, falling back to method and path', () => {
    // Given
    const document = simpleDocument();

    // When
    const titled = materializeNode(document.nodes.get('get-orders')!, document);

    // Then
    expect(titled.title).toBe('List orders');
    expect(titled.deprecated).toBe(false);
    expect(materializeNode(document.nodes.get('get-health')!, document).deprecated).toBe(true);
  });

  it('should collect every schema slot the operation uses', () => {
    // Given
    const document = simpleDocument();

    // When
    const view = materializeNode(document.nodes.get('post-orders')!, document);

    // Then
    expect(view.schemaSlots).toHaveLength(1);
    expect(view.schemaSlots[0]).toEqual({ kind: 'named', schemaId: 'Order' });
  });
});

describe('resolveSchemaSlot', () => {
  it('should resolve a named slot through the schema map', () => {
    // Given
    const document = simpleDocument();

    // When
    const schema = resolveSchemaSlot({ kind: 'named', schemaId: 'Order' }, document.schemas);

    // Then
    expect(schema?.id).toBe('Order');
  });

  it('should hand back the schema an inline slot already carries', () => {
    // Given
    const inline = {
      kind: 'inline',
      schema: { id: 'x', dialect: 'json-schema-2020-12', normalized: { type: 'string' } },
    } as const;

    // When
    const schema = resolveSchemaSlot(inline, new Map());

    // Then
    expect(schema).toBe(inline.schema);
  });
});

import { describe, expect, it } from 'vitest';
import type {
  IRChannel,
  IRConfidence,
  IRDocument,
  IRFact,
  IRNode,
  IROperation,
} from '../../src/index';
import { createDocumentFixture } from '../mocks/document.mock';

/**
 * The IR shape is checked at compile time by these helpers and at run time by the assertions.
 *
 * `describeNode` compiles only while `IRNode` has exactly the two members it handles: adding a
 * third without updating call sites fails the build under `noImplicitReturns`.
 */
function describeNode(node: IRNode): string {
  switch (node.kind) {
    case 'operation':
      return `${node.method.toUpperCase()} ${node.path}`;
    case 'channel':
      return `${node.protocol ?? 'unknown'} ${node.address ?? node.id}`;
  }
}

describe('IRNode', () => {
  it('should discriminate an operation from a channel by kind', () => {
    // Given
    const document = createDocumentFixture();
    const nodes = [...document.nodes.values()];

    // When
    const described = nodes.map((node) => describeNode(node));

    // Then
    expect(described).toEqual(['GET /orders', 'kafka order.created']);
  });

  it('should narrow to the operation members after a kind check', () => {
    // Given
    const document = createDocumentFixture();
    const node = document.nodes.get('get-orders');

    // When
    const statusCodes = node?.kind === 'operation' ? node.responses.map((r) => r.statusCode) : [];

    // Then
    expect(statusCodes).toEqual(['200', '404', 'default']);
  });

  it('should narrow to the channel members after a kind check', () => {
    // Given
    const document = createDocumentFixture();
    const node = document.nodes.get('channel-order-created');

    // When
    const directions = node?.kind === 'channel' ? node.operations.map((o) => o.direction) : [];

    // Then
    expect(directions).toEqual(['send']);
  });
});

describe('IRDocument', () => {
  it('should declare the event and runtime fields from M0 even while they are unpopulated', () => {
    // Given
    const document: IRDocument = {
      id: 'empty',
      kind: 'http',
      hash: '',
      info: { title: 'Empty', version: '0.0.0' },
      servers: [],
      navigation: [],
      nodes: new Map<string, IRNode>(),
      schemas: new Map(),
      security: [],
      relationships: [],
      webhooks: new Map<string, IRNode>(),
    };

    // When
    const declared = {
      relationships: document.relationships,
      webhooks: [...document.webhooks.keys()],
      runtime: document.runtime,
      health: document.health,
    };

    // Then
    expect(declared).toEqual({
      relationships: [],
      webhooks: [],
      runtime: undefined,
      health: undefined,
    });
  });

  it('should keep nodes and schemas as maps keyed by id', () => {
    // Given
    const document = createDocumentFixture();

    // When
    const keys = [[...document.nodes.keys()], [...document.schemas.keys()]];

    // Then
    expect(keys).toEqual([
      ['get-orders', 'channel-order-created'],
      ['Order', 'Problem'],
    ]);
  });
});

describe('IRFact', () => {
  it('should require a confidence level and a collector alongside every value', () => {
    // Given
    const fact: IRFact<readonly string[]> = {
      value: ['orders:read'],
      confidence: 'declared',
      collector: 'scopesCollector',
    };

    // When
    const levels: readonly IRConfidence[] = ['declared', 'derived', 'inferred'];

    // Then
    expect(levels).toContain(fact.confidence);
    expect(fact.collector).toBe('scopesCollector');
  });
});

describe('the node unions', () => {
  it('should type an operation and a channel as assignable to IRNode', () => {
    // Given
    const operation: IROperation = {
      kind: 'operation',
      id: 'get-root',
      method: 'get',
      path: '/',
      tags: [],
      deprecated: false,
      parameters: [],
      responses: [],
      security: [],
      servers: [],
    };
    const channel: IRChannel = {
      kind: 'channel',
      id: 'channel-root',
      tags: [],
      deprecated: false,
      servers: [],
      operations: [],
      messages: [],
    };

    // When
    const nodes: readonly IRNode[] = [operation, channel];

    // Then
    expect(nodes.map((node) => node.kind)).toEqual(['operation', 'channel']);
  });
});

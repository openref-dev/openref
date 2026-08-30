import { describe, expect, it } from 'vitest';
import { AgentSurfaceService, agentTools, JSONRPC_ERROR, toolCallText } from '../../src/index';
import { channelDocument, documentWithFacts, orderDocument } from '../mocks/documents';

/** One surface over the order document with MCP switched on. */
function surface(): AgentSurfaceService {
  return new AgentSurfaceService({
    document: orderDocument(),
    basePath: '/docs',
    agent: { mcp: true },
  });
}

describe('what the MCP endpoint does with a body it cannot use', () => {
  it('should refuse a JSON scalar, which parses and is not a request', () => {
    // Given, `JSON.parse` succeeds on this, so a reader that only caught a parse failure would
    // go on to read `method` off a number
    const service = surface();

    // When
    const reply = service.mcp('42');

    // Then
    const parsed = JSON.parse(reply.body) as { error?: { code: number; message: string } };
    expect(parsed.error?.code).toBe(JSONRPC_ERROR.invalidRequest);
    expect(parsed.error?.message).toContain('is an object');
  });

  it('should refuse a body of whitespace exactly as it refuses an absent one', () => {
    // Given, both are a request that carries nothing to answer
    const service = surface();

    // When
    const blank = service.mcp('   ');
    const absent = service.mcp(undefined);

    // Then
    expect(blank).toEqual(absent);
    expect(blank.status).toBe(400);
  });

  it('should answer a parse failure under a null id rather than inventing one', () => {
    // Given, the id could not be read, and answering under a forged one would be a reply the
    // caller matches to a call it never made
    const service = surface();

    // When
    const parsed = JSON.parse(service.mcp('{ not json').body) as { id: unknown };

    // Then
    expect(parsed.id).toBeNull();
  });

  it('should answer ping with an empty result', () => {
    // Given, MCP's own liveness call
    const service = surface();

    // When
    const reply = service.mcp(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping' }));

    // Then
    expect(JSON.parse(reply.body)).toEqual({ jsonrpc: '2.0', id: 9, result: {} });
  });

  it('should refuse a resources/read that names no uri', () => {
    // Given
    const service = surface();

    // When
    const reply = service.mcp(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: {} }),
    );

    // Then
    const parsed = JSON.parse(reply.body) as { error?: { code: number } };
    expect(parsed.error?.code).toBe(JSONRPC_ERROR.invalidParams);
  });
});

describe('the tool text', () => {
  it('should carry the description and the deprecation when the document wrote them', () => {
    // Given an operation carrying both, which the fixture's GET does not
    const document = documentWithFacts();
    const node = document.nodes.get('get-orders');
    if (node?.kind !== 'operation') throw new Error('the fixture moved');
    const annotated = { ...node, description: 'Everything about orders.', deprecated: true };

    // When
    const text = toolCallText(annotated, document, '/docs');

    // Then
    expect(text).toContain('Description: Everything about orders.');
    expect(text).toContain('Deprecated: yes');
  });

  it('should build a name from a node id that carries characters MCP does not allow', () => {
    // Given, a name is derived from the node id because SPEC 5.4 guarantees that one is unique,
    // and a replaced character keeps two ids two names rather than collapsing them
    const document = documentWithFacts();
    const node = document.nodes.get('get-orders');
    if (node?.kind !== 'operation') throw new Error('the fixture moved');
    const odd = { ...node, id: 'get-orders/{id}' };
    const nodes = new Map(document.nodes);
    nodes.set(odd.id, odd);
    nodes.delete('get-orders');

    // When
    const tools = agentTools({ ...document, nodes }, '/docs');

    // Then
    expect(tools.map((tool) => tool.name)).toContain('get-orders__id_');
  });

  it('should build no tool at all for a document made only of channels', () => {
    // Given, per SPEC 18 a channel is never a tool
    const document = channelDocument();

    // When
    const tools = agentTools(document, '/docs');

    // Then
    expect(tools).toEqual([]);
  });
});

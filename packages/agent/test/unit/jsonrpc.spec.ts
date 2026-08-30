import { describe, expect, it } from 'vitest';
import {
  JSONRPC_ERROR,
  JSONRPC_VERSION,
  jsonRpcError,
  jsonRpcResult,
  readJsonRpc,
} from '../../src/index';

describe('readJsonRpc', () => {
  it('should read a well formed request with its params', () => {
    // Given
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'get-orders' },
    });

    // When
    const read = readJsonRpc(body);

    // Then
    expect(read).toEqual({
      ok: true,
      request: { method: 'tools/call', id: 7, params: { name: 'get-orders' } },
    });
  });

  it('should report a notification as a request with no id', () => {
    // Given, per JSON-RPC a message with no id expects no answer at all, and MCP sends exactly
    // one of these after the handshake
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });

    // When
    const read = readJsonRpc(body);

    // Then
    expect(read.ok).toBe(true);
    expect(read.ok ? read.request.id : 'unread').toBeUndefined();
  });

  it('should refuse a body that is not JSON, with the parse code', () => {
    // Given
    const body = '{ not json';

    // When
    const read = readJsonRpc(body);

    // Then
    expect(read).toEqual({
      ok: false,
      code: JSONRPC_ERROR.parse,
      message: 'the request body is not JSON',
    });
  });

  it('should refuse a batch by name rather than answering its first element', () => {
    // Given, answering one of several and dropping the rest is a server that looks like it
    // worked, which is worse than one that says it does not do this
    const body = JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }]);

    // When
    const read = readJsonRpc(body);

    // Then
    expect(read.ok).toBe(false);
    expect(read.ok ? '' : read.message).toContain('not a batch');
  });

  it('should refuse a message carrying the wrong protocol version and keep its id', () => {
    // Given
    const body = JSON.stringify({ jsonrpc: '1.0', id: 'abc', method: 'ping' });

    // When
    const read = readJsonRpc(body);

    // Then the refusal is answerable under the id the caller sent, so it is not read as a reply
    // to some other call
    expect(read).toEqual({
      ok: false,
      code: JSONRPC_ERROR.invalidRequest,
      message: `a JSON-RPC request carries jsonrpc "${JSONRPC_VERSION}"`,
      id: 'abc',
    });
  });

  it('should refuse a message with no method', () => {
    // Given
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1 });

    // When
    const read = readJsonRpc(body);

    // Then
    expect(read.ok).toBe(false);
    expect(read.ok ? '' : read.message).toContain('names a method');
  });

  it('should not take an id that is neither a string nor a finite number', () => {
    // Given, a null id is what this endpoint answers with when it could not read the request at
    // all, so accepting one as a request id would make a reply and a parse failure look alike
    const bodies = [
      JSON.stringify({ jsonrpc: '2.0', id: null, method: 'ping' }),
      JSON.stringify({ jsonrpc: '2.0', id: { a: 1 }, method: 'ping' }),
    ];

    // When
    const reads = bodies.map((body) => readJsonRpc(body));

    // Then both are read as notifications rather than as calls under a forged id
    expect(reads.map((read) => (read.ok ? read.request.id : 'unread'))).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('should default params to an empty object rather than to whatever was there', () => {
    // Given an array of positional params, which this endpoint's methods do not take
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: [1, 2] });

    // When
    const read = readJsonRpc(body);

    // Then, reading positional params as named ones would invent a name nobody sent
    expect(read.ok ? read.request.params : 'unread').toEqual({});
  });
});

describe('the response builders', () => {
  it('should carry the version on a result and on an error alike', () => {
    // Given, When
    const result = jsonRpcResult(1, { ok: true });
    const failure = jsonRpcError(null, JSONRPC_ERROR.methodNotFound, 'no such method');

    // Then
    expect(result).toEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    expect(failure).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32601, message: 'no such method' },
    });
  });
});

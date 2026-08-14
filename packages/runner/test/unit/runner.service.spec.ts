import { InvalidOptionsError } from '@openref/core';
import { describe, expect, it, vi } from 'vitest';
import { createRunner, type IHttpTransport, type RequestPlan } from '../../src/index';
import { API_KEY_QUERY, BEARER, operation } from '../mocks/operations';

/** A transport that records the plan and answers with a fixed response. */
function recordingTransport(): IHttpTransport & { readonly plans: RequestPlan[] } {
  const plans: RequestPlan[] = [];

  return {
    plans,
    send: (plan) => {
      plans.push(plan);
      return Promise.resolve({
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'application/json']],
        body: '{"ok":true}',
      });
    },
  };
}

describe('RequestRunner', () => {
  it('should send the plan it built and report what came back', async () => {
    // Given
    const transport = recordingTransport();
    const runner = createRunner({ visibility: 'internal', storage: 'memory', transport });

    // When
    const result = await runner.send({
      operation: operation(),
      serverUrl: 'https://api.example.com',
      values: { 'path:id': { kind: 'primitive', value: '42' } },
    });

    // Then
    expect(transport.plans[0]?.url).toBe('https://api.example.com/orders/42');
    expect(result.status).toBe(200);
    expect(result.body).toBe('{"ok":true}');
    expect(result.headers).toEqual([{ name: 'content-type', value: 'application/json' }]);
  });

  it('should apply the credential it holds rather than one passed to send', async () => {
    // Given, a credential is never a member of the send call, so nothing above the runner
    // holds one.
    const transport = recordingTransport();
    const runner = createRunner({ visibility: 'internal', storage: 'memory', transport });
    runner.setCredential('bearerAuth', 'secret-token');

    // When
    await runner.send({
      operation: operation({ security: [BEARER] }),
      serverUrl: 'https://api.example.com',
      values: { 'path:id': { kind: 'primitive', value: '1' } },
    });

    // Then
    expect(transport.plans[0]?.headers).toEqual({ Authorization: 'Bearer secret-token' });
  });

  it('should keep the credential out of the result it returns', async () => {
    // Given
    const transport = recordingTransport();
    const runner = createRunner({ visibility: 'internal', storage: 'memory', transport });
    runner.setCredential('apiKeyQuery', 'secret-token');

    // When
    const result = await runner.send({
      operation: operation({ security: [API_KEY_QUERY] }),
      serverUrl: 'https://api.example.com',
      values: { 'path:id': { kind: 'primitive', value: '1' } },
    });

    // Then
    expect(transport.plans[0]?.url).toContain('secret-token');
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  it('should measure the duration from the clock it was given', async () => {
    // Given
    const now = vi.fn<() => number>();
    now.mockReturnValueOnce(1_000).mockReturnValueOnce(1_042);
    const runner = createRunner({
      visibility: 'internal',
      storage: 'memory',
      transport: recordingTransport(),
      now,
    });

    // When
    const result = await runner.send({
      operation: operation(),
      serverUrl: 'https://api.example.com',
      values: { 'path:id': { kind: 'primitive', value: '1' } },
    });

    // Then
    expect(result.durationMs).toBe(42);
  });

  it('should refuse an operation whose document declares no server', async () => {
    // Given
    const runner = createRunner({
      visibility: 'internal',
      storage: 'memory',
      transport: recordingTransport(),
    });

    // When
    const send = runner.send({
      operation: operation({ servers: [] }),
      serverUrl: '',
      values: { 'path:id': { kind: 'primitive', value: '1' } },
    });

    // Then
    await expect(send).rejects.toBeInstanceOf(InvalidOptionsError);
  });

  it('should store a prefilled credential when visibility is not public', () => {
    // Given
    const runner = createRunner({
      visibility: 'internal',
      storage: 'memory',
      credentials: { bearerAuth: 'from-config' },
    });

    // When
    const actual = runner.credential('bearerAuth');

    // Then
    expect(actual).toBe('from-config');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, RemoteUnavailableError } from '@openref/core';
import { FetchRemoteAdapter } from '../../src/index';
import type { RemoteFetchLike, RemoteResponseLike } from '../../src/index';

/**
 * The real fetcher, against a structural `fetch`: what it sends, what it refuses, and the size
 * ceiling that stops a hostile body before it is held.
 */

function response(overrides: Partial<RemoteResponseLike> = {}): RemoteResponseLike {
  return {
    status: 200,
    headers: { get: () => null },
    body: null,
    text: () => Promise.resolve('{"openapi":"3.1.0"}'),
    ...overrides,
  };
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

describe('FetchRemoteAdapter', () => {
  it('should send a GET with no ambient credentials and the caller its signal', async () => {
    // Given
    const seen: { url?: string; init?: Parameters<RemoteFetchLike>[1] } = {};
    const abort = signal();
    const adapter = new FetchRemoteAdapter({
      fetch: (url, init) => {
        seen.url = url;
        seen.init = init;
        return Promise.resolve(response());
      },
    });

    // When
    const source = await adapter.fetch({
      url: 'https://remote.internal/openapi.json',
      signal: abort,
    });

    // Then
    expect(source).toEqual({ status: 200, body: '{"openapi":"3.1.0"}' });
    expect(seen.url).toBe('https://remote.internal/openapi.json');
    expect(seen.init?.method).toBe('GET');
    expect(seen.init?.credentials).toBe('omit');
    expect(seen.init?.redirect).toBe('follow');
    expect(seen.init?.signal).toBe(abort);
    expect(seen.init?.headers.accept).toContain('application/json');
  });

  it('should return a non-success status without reading its body, because an error page is not a document', async () => {
    // Given
    const text = vi.fn(() => Promise.resolve('<html>gateway error</html>'));
    const adapter = new FetchRemoteAdapter({
      fetch: () => Promise.resolve(response({ status: 503, text })),
    });

    // When
    const source = await adapter.fetch({ url: 'https://remote.internal/x', signal: signal() });

    // Then
    expect(source).toEqual({ status: 503, body: '' });
    expect(text).not.toHaveBeenCalled();
  });

  it('should wrap a network failure as an unreachable remote naming the URL', async () => {
    // Given
    const adapter = new FetchRemoteAdapter({
      fetch: () => Promise.reject(new Error('connect ECONNREFUSED')),
    });

    // When
    let caught: unknown;
    try {
      await adapter.fetch({ url: 'https://remote.internal/x', signal: signal() });
    } catch (cause) {
      caught = cause;
    }

    // Then
    expect(caught).toBeInstanceOf(RemoteUnavailableError);
    expect((caught as RemoteUnavailableError).code).toBe(ErrorCode.FED_REMOTE_UNAVAILABLE);
    expect((caught as RemoteUnavailableError).context).toEqual({
      url: 'https://remote.internal/x',
    });
  });

  it('should pass a project error thrown through the abort reason back unchanged', async () => {
    // Given: the lifecycle's own timeout error arrives as the rejection, as fetch does on abort
    const reason = new RemoteUnavailableError('did not answer', ErrorCode.FED_REMOTE_UNAVAILABLE);
    const adapter = new FetchRemoteAdapter({ fetch: () => Promise.reject(reason) });

    // When
    let caught: unknown;
    try {
      await adapter.fetch({ url: 'https://remote.internal/x', signal: signal() });
    } catch (cause) {
      caught = cause;
    }

    // Then: the very same error, so the recorded failure names the timeout, not a wrapper
    expect(caught).toBe(reason);
  });

  it('should refuse a declared Content-Length over the ceiling before reading a byte', async () => {
    // Given
    const text = vi.fn(() => Promise.resolve('never'));
    const adapter = new FetchRemoteAdapter({
      maxBodyBytes: 1024,
      fetch: () =>
        Promise.resolve(
          response({
            headers: { get: (name) => (name === 'content-length' ? '2048' : null) },
            text,
          }),
        ),
    });

    // When
    let caught: unknown;
    try {
      await adapter.fetch({ url: 'https://remote.internal/x', signal: signal() });
    } catch (cause) {
      caught = cause;
    }

    // Then
    expect(caught).toBeInstanceOf(RemoteUnavailableError);
    expect((caught as RemoteUnavailableError).message).toContain('larger than the 1024 bytes');
    expect(text).not.toHaveBeenCalled();
  });

  it('should measure the text() fallback in bytes, refusing a multibyte body under the ceiling in code units', async () => {
    // Given: 512 three-byte characters, so the body is under the 1024 byte ceiling in UTF-16
    // code units and over it in bytes; a comparison of `length` against the ceiling, which is
    // what this pins the absence of, would have accepted it
    const body = '€'.repeat(512);
    expect(body.length).toBeLessThanOrEqual(1024);
    expect(new TextEncoder().encode(body).length).toBeGreaterThan(1024);
    const adapter = new FetchRemoteAdapter({
      maxBodyBytes: 1024,
      fetch: () => Promise.resolve(response({ body: null, text: () => Promise.resolve(body) })),
    });

    // When
    let caught: unknown;
    try {
      await adapter.fetch({ url: 'https://remote.internal/x', signal: signal() });
    } catch (cause) {
      caught = cause;
    }

    // Then
    expect(caught).toBeInstanceOf(RemoteUnavailableError);
    expect((caught as RemoteUnavailableError).code).toBe(ErrorCode.FED_REMOTE_UNAVAILABLE);
    expect((caught as RemoteUnavailableError).message).toContain('larger than the 1024 bytes');
  });

  it('should stop a stream at the ceiling rather than buffer whatever arrives', async () => {
    // Given: a body that streams chunks forever and declares nothing
    const cancel = vi.fn(() => Promise.resolve());
    const chunk = new TextEncoder().encode('x'.repeat(512));
    const adapter = new FetchRemoteAdapter({
      maxBodyBytes: 1024,
      fetch: () =>
        Promise.resolve(
          response({
            body: {
              getReader: () => ({
                read: () => Promise.resolve({ done: false, value: chunk }),
                cancel,
              }),
            },
          }),
        ),
    });

    // When
    let caught: unknown;
    try {
      await adapter.fetch({ url: 'https://remote.internal/x', signal: signal() });
    } catch (cause) {
      caught = cause;
    }

    // Then: refused at the limit, and the stream was cancelled rather than abandoned
    expect(caught).toBeInstanceOf(RemoteUnavailableError);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('should read a streamed body to the end when it stays under the ceiling', async () => {
    // Given
    const chunks = [new TextEncoder().encode('{"openapi":'), new TextEncoder().encode('"3.1.0"}')];
    let index = 0;
    const adapter = new FetchRemoteAdapter({
      fetch: () =>
        Promise.resolve(
          response({
            body: {
              getReader: () => ({
                read: () => {
                  const value = chunks[index];
                  index += 1;
                  return Promise.resolve(
                    value === undefined ? { done: true } : { done: false, value },
                  );
                },
                cancel: () => Promise.resolve(),
              }),
            },
          }),
        ),
    });

    // When
    const source = await adapter.fetch({ url: 'https://remote.internal/x', signal: signal() });

    // Then
    expect(source.body).toBe('{"openapi":"3.1.0"}');
  });

  it('should refuse to fetch at all when no fetch implementation exists', async () => {
    // Given: a runtime with no global fetch
    vi.stubGlobal('fetch', undefined);
    try {
      const adapter = new FetchRemoteAdapter();

      // When
      let caught: unknown;
      try {
        await adapter.fetch({ url: 'https://remote.internal/x', signal: signal() });
      } catch (cause) {
        caught = cause;
      }

      // Then
      expect(caught).toBeInstanceOf(RemoteUnavailableError);
      expect((caught as RemoteUnavailableError).message).toContain('no fetch implementation');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

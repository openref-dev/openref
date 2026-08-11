import { ErrorCode, RunnerError } from '@openref/core';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  FetchHttpTransport,
  type FetchLike,
  type FetchResponseLike,
  type ResponseStreamLike,
} from '../../src/index';
import type { RequestPlan } from '../../src/index';

/**
 * The try-it console against a server that is hostile rather than merely broken, per T016.
 *
 * A server does not have to answer wrongly to take the page down. It can answer slowly for
 * ever, or answer with more bytes than a browser tab can hold, and before this pass both of
 * those were a hang rather than a refusal: the send carried no cancellation, and the body was
 * read with `text()`, which buffers whatever arrives.
 */

const PLAN: RequestPlan = {
  method: 'GET',
  url: 'https://api.example.com/orders',
  headers: {},
  body: null,
};

interface FakeHeaders {
  forEach(callback: (value: string, key: string) => void): void;
  get(name: string): string | null;
}

function headersOf(entries: Readonly<Record<string, string>> = {}): FakeHeaders {
  return {
    forEach(callback): void {
      for (const [key, value] of Object.entries(entries)) callback(value, key);
    },
    get(name): string | null {
      return entries[name.toLowerCase()] ?? null;
    },
  };
}

/** A `fetch` that honours the abort signal, which is the whole contract a real one keeps. */
function neverAnswers(): FetchLike {
  return (_url, init) =>
    new Promise((_resolve, reject) => {
      const signal = init.signal as Partial<{
        addEventListener: (name: string, listener: () => void) => void;
      }>;

      signal.addEventListener?.('abort', () => {
        const error = new Error('the operation was aborted');
        error.name = 'TimeoutError';
        reject(error);
      });
    });
}

function answersWith(response: Partial<FetchResponseLike>): FetchLike {
  const answer: FetchResponseLike = {
    status: 200,
    statusText: 'OK',
    headers: headersOf(),
    text: () => Promise.resolve(''),
    ...response,
  };

  return () => Promise.resolve(answer);
}

/** A body that never ends, delivered a chunk at a time, as a hostile stream would be. */
function endlessStream(chunkBytes: number): ResponseStreamLike {
  const chunk = new Uint8Array(chunkBytes).fill(0x61);
  return {
    getReader() {
      return {
        read: () => Promise.resolve({ done: false, value: chunk }),
        cancel: () => Promise.resolve(),
      };
    },
  };
}

describe('try-it against a server that never answers', () => {
  it('should refuse with a timeout rather than wait for ever', async () => {
    // Given, one millisecond so the test does not wait for the real default.
    const transport = new FetchHttpTransport({ fetch: neverAnswers(), timeoutMs: 1 });

    // When
    const send = transport.send(PLAN);

    // Then
    await expect(send).rejects.toBeInstanceOf(RunnerError);
    await expect(send).rejects.toMatchObject({ code: ErrorCode.RUN_TIMEOUT });
  });

  it('should carry a cancellation signal into the transport at all', async () => {
    // Given, this is the wiring the finding was about: the send used to pass none, so a real
    // fetch had nothing to abort on.
    let seen: unknown;
    const transport = new FetchHttpTransport({
      fetch: (_url, init) => {
        seen = init.signal;
        return Promise.resolve({
          status: 200,
          statusText: 'OK',
          headers: headersOf(),
          text: () => Promise.resolve('{}'),
        } as FetchResponseLike);
      },
      timeoutMs: 5_000,
    });

    // When
    await transport.send(PLAN);

    // Then
    expect(seen).toBeDefined();
  });

  it('should default to a limit rather than to no limit', () => {
    // Given, a default of none is what the finding was.
    // When
    const timeout = DEFAULT_TIMEOUT_MS;

    // Then
    expect(timeout).toBeGreaterThan(0);
    expect(Number.isFinite(timeout)).toBe(true);
  });
});

describe('try-it against a server that answers with more than the console can hold', () => {
  it('should refuse a declared Content-Length past the limit before reading a byte', async () => {
    // Given, ten gigabytes, announced.
    let read = false;
    const transport = new FetchHttpTransport({
      fetch: answersWith({
        headers: headersOf({ 'content-length': String(10 * 1024 * 1024 * 1024) }),
        text: () => {
          read = true;
          return Promise.resolve('');
        },
      }),
      maxResponseBytes: 1024,
    });

    // When
    const send = transport.send(PLAN);

    // Then
    await expect(send).rejects.toMatchObject({ code: ErrorCode.RUN_RESPONSE_TOO_LARGE });
    expect(read).toBe(false);
  });

  it('should stop a body that declares no length at the limit', async () => {
    // Given, a stream that never ends, which is what a hostile server sends when it does not
    // want to tell you how much is coming.
    const transport = new FetchHttpTransport({
      fetch: answersWith({ body: endlessStream(64 * 1024) }),
      maxResponseBytes: 256 * 1024,
    });

    // When
    const send = transport.send(PLAN);

    // Then
    await expect(send).rejects.toMatchObject({ code: ErrorCode.RUN_RESPONSE_TOO_LARGE });
  });

  it('should read a body that fits, through the stream, unchanged', async () => {
    // Given
    const payload = '{"orders":[1,2,3]}';
    const bytes = new TextEncoder().encode(payload);
    let delivered = false;
    const transport = new FetchHttpTransport({
      fetch: answersWith({
        body: {
          getReader() {
            return {
              read: () => {
                if (delivered) return Promise.resolve({ done: true });
                delivered = true;
                return Promise.resolve({ done: false, value: bytes });
              },
              cancel: () => Promise.resolve(),
            };
          },
        },
      }),
    });

    // When
    const result = await transport.send(PLAN);

    // Then
    expect(result.body).toBe(payload);
  });

  it('should refuse an oversized body even from a transport that exposes no stream', async () => {
    // Given, the fallback path, which can only refuse after the fact and is a fallback for
    // exactly that reason.
    const transport = new FetchHttpTransport({
      fetch: answersWith({ text: () => Promise.resolve('x'.repeat(4096)) }),
      maxResponseBytes: 1024,
    });

    // When
    const send = transport.send(PLAN);

    // Then
    await expect(send).rejects.toMatchObject({ code: ErrorCode.RUN_RESPONSE_TOO_LARGE });
  });

  it('should default to a size the panel could actually render', () => {
    // Given, the body is put into the page, so the ceiling is what can be shown.
    // When
    const limit = DEFAULT_MAX_RESPONSE_BYTES;

    // Then
    expect(limit).toBeGreaterThan(0);
    expect(Number.isFinite(limit)).toBe(true);
  });
});

describe('try-it against a server that breaks the response mid flight', () => {
  it('should report a stream that fails as a runner error, not as a foreign one', async () => {
    // Given, invalid chunked encoding reaches the reader as a rejected read.
    const transport = new FetchHttpTransport({
      fetch: answersWith({
        body: {
          getReader() {
            return {
              read: () => Promise.reject(new TypeError('terminated')),
              cancel: () => Promise.resolve(),
            };
          },
        },
      }),
    });

    // When
    const send = transport.send(PLAN);

    // Then
    await expect(send).rejects.toBeInstanceOf(RunnerError);
    await expect(send).rejects.toMatchObject({ code: ErrorCode.RUN_STREAM_FAILED });
  });

  it('should report a connection that never opened as unreachable rather than as a timeout', async () => {
    // Given, the two are different answers and a reader acts on them differently.
    const transport = new FetchHttpTransport({
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });

    // When
    const send = transport.send(PLAN);

    // Then
    await expect(send).rejects.toMatchObject({ code: ErrorCode.RUN_NOT_AVAILABLE });
  });
});

/**
 * The declared transport type against the runtime's own `fetch`, per T016 finding F11.
 *
 * FOUND BY THE TYPE CHECKER AND NOT BY A TEST, which is why the pin is here now. The cancellation
 * and body limits above arrived with `signal?: unknown` and `getReader(): ...` on the declared
 * transport, and both read as accommodating. A parameter position is contravariant, so both were
 * the opposite: the browser's own `fetch` stopped satisfying `FetchLike`, and the integration
 * suite that hands the console a real `fetch` stopped compiling. The unit suite went on passing,
 * because every test in it supplies a stub built to the declared shape rather than a real one.
 */
describe('the declared transport type', () => {
  it('should accept the runtime fetch, which is the only implementation a host actually has', () => {
    // Given, and the assignment IS the assertion. There is no cast on it, so `pnpm lint` fails
    // the moment `FetchLike` describes something the runtime's `fetch` is not.
    const transport: FetchLike = fetch;

    // When
    const built = new FetchHttpTransport({ fetch: transport });

    // Then, so the test cannot pass vacuously on a runtime that has no fetch to assign
    expect(transport).toBeTypeOf('function');
    expect(built).toBeInstanceOf(FetchHttpTransport);
  });
});

import { ErrorCode, OpenRefError } from '@openref/core';
import { describe, expect, it } from 'vitest';
import {
  checkStreamItem,
  createRunner,
  ElementTooLargeError,
  runStream,
  StreamDecoder,
  type IStreamTransport,
  type RequestPlan,
  type StreamElement,
  type StreamEnd,
  type StreamOpenResult,
} from '../../src/index';
import { operation } from '../mocks/operations';

/**
 * Streaming, per SPEC 14.6: the decoder, the bounded check, and every way a stream ends.
 *
 * THE CASE THAT DECIDES THE FEATURE IS THE INVALID ELEMENT. Dropping it is the easy
 * implementation and the wrong one, because a server sending the wrong thing would then be
 * indistinguishable from a server sending less, and telling those apart is the whole reason a
 * documentation console validates anything at all.
 *
 * THE OTHER THREE ARE ABOUT NOT HANGING. A stream that never terminates, a Stop that stops the
 * reading rather than the request, and an element with no separator in it are three ways to
 * leave a reader watching a page that will never change, and all three are bounded here.
 */

/** A transport that yields the chunks it was given, and records the abort. */
class ScriptedStream implements IStreamTransport {
  public aborted = false;
  public opened = 0;

  constructor(
    private readonly chunks: readonly string[],
    private readonly status = 200,
    private readonly body = '',
  ) {}

  open(_plan: RequestPlan, signal: AbortSignal): Promise<StreamOpenResult> {
    this.opened += 1;
    signal.addEventListener('abort', () => {
      this.aborted = true;
    });

    const chunks = this.chunks;
    const status = this.status;
    const body = this.body;

    async function* produce(): AsyncGenerator<string> {
      if (status < 200 || status > 299) {
        yield body;
        return;
      }

      await Promise.resolve();

      for (const chunk of chunks) {
        // THE ABORT IS OBSERVED BETWEEN CHUNKS, which is what a real reader does: the platform
        // rejects the pending read rather than the loop noticing a flag.
        if (signal.aborted) throw new Error('aborted');
        yield chunk;
        await Promise.resolve();
      }
    }

    return Promise.resolve({
      status: this.status,
      statusText: 'OK',
      headers: [['content-type', 'text/event-stream']] as const,
      chunks: produce(),
    });
  }
}

/** A transport that opens and then says nothing at all, until it is aborted. */
class SilentStream implements IStreamTransport {
  public aborted = false;

  open(_plan: RequestPlan, signal: AbortSignal): Promise<StreamOpenResult> {
    async function* produce(): AsyncGenerator<string> {
      await new Promise<void>((resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
        // Nothing resolves this. A server that opens a stream and stops is exactly this shape.
        void resolve;
      });
      yield '';
    }

    signal.addEventListener('abort', () => {
      this.aborted = true;
    });

    return Promise.resolve({
      status: 200,
      statusText: 'OK',
      headers: [],
      chunks: produce(),
    });
  }
}

const PLAN: RequestPlan = {
  method: 'GET',
  url: 'https://api.example.com/events',
  headers: {},
  body: null,
};

/**
 * Runs a stream to its end and collects everything it reported.
 *
 * @param transport - What produces the chunks
 * @param options - Format, terminator, schema and limits
 * @returns The elements and the ending
 */
async function collect(
  transport: IStreamTransport,
  options: Parameters<typeof runStream>[1],
): Promise<{ elements: StreamElement[]; end: StreamEnd }> {
  const elements: StreamElement[] = [];
  const handle = runStream(
    PLAN,
    options,
    { onElement: (element) => elements.push(element) },
    {
      transport,
    },
  );

  return { elements, end: await handle.done };
}

describe('StreamDecoder', () => {
  it('should join a data field split across three chunks into one element', () => {
    // Given
    const decoder = new StreamDecoder('sse');

    // When
    const first = decoder.push('data: {"id"');
    const second = decoder.push(':1,"name":"a"}');
    const third = decoder.push('\n\n');

    // Then
    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(third).toEqual([{ data: '{"id":1,"name":"a"}' }]);
  });

  it('should not dispatch on a carriage return that ends a chunk, because the next chunk decides what it was', () => {
    // Given
    const decoder = new StreamDecoder('sse');
    decoder.push('data: one\n');

    // When
    const held = decoder.push('\r');
    const dispatched = decoder.push('\ndata: two\n\n');

    // Then
    expect(held).toEqual([]);
    expect(dispatched).toEqual([{ data: 'one' }, { data: 'two' }]);
  });

  it('should treat a comment line as a keepalive rather than as an element', () => {
    // Given
    const decoder = new StreamDecoder('sse');

    // When
    const frames = decoder.push(': ping\n\ndata: real\n\n');

    // Then
    expect(frames).toEqual([{ data: 'real' }]);
  });

  it('should join multiple data fields of one event with a newline and carry the event name', () => {
    // Given
    const decoder = new StreamDecoder('sse');

    // When
    const frames = decoder.push('event: tick\ndata: one\ndata: two\nid: 7\n\n');

    // Then
    expect(frames).toEqual([{ data: 'one\ntwo', event: 'tick', id: '7' }]);
  });

  it('should report the last NDJSON line when the server closes without a final newline', () => {
    // Given
    const decoder = new StreamDecoder('ndjson');
    decoder.push('{"a":1}\n{"a":2}');

    // When
    const trailing = decoder.flush();

    // Then
    expect(trailing).toEqual([{ data: '{"a":2}' }]);
  });

  it('should refuse an element longer than the limit rather than buffering it', () => {
    // Given
    const decoder = new StreamDecoder('ndjson', 32);

    // When
    const push = (): unknown => decoder.push('x'.repeat(64));

    // Then
    expect(push).toThrow(ElementTooLargeError);

    // And it obeys the error rule the rest of this project follows, which it did not until `T065`:
    // it is the only error class any of the three published runtime packages exports, so the one
    // that reached a consumer was the one that carried neither `OpenRefError` nor a code.
    let thrown: unknown;
    try {
      push();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OpenRefError);
    expect((thrown as ElementTooLargeError).code).toBe(ErrorCode.RUN_STREAM_FAILED);
    expect((thrown as ElementTooLargeError).limit).toBe(32);
    expect((thrown as ElementTooLargeError).context).toEqual({ limit: 32 });
  });
});

describe('checkStreamItem', () => {
  it('should report an element that is not JSON while the document declares an item schema', () => {
    // Given
    const data = 'not json at all';

    // When
    const problem = checkStreamItem(data, { type: 'object' });

    // Then
    expect(problem).toContain('not JSON');
  });

  it('should report a required property the element does not carry', () => {
    // Given
    const data = '{"name":"a"}';

    // When
    const problem = checkStreamItem(data, { type: 'object', required: ['id'] });

    // Then
    expect(problem).toContain('id');
  });

  it('should report a declared property whose type the element contradicts', () => {
    // Given
    const data = '{"id":"seven"}';

    // When
    const problem = checkStreamItem(data, {
      type: 'object',
      properties: { id: { type: 'integer' } },
    });

    // Then
    expect(problem).toContain('id');
    expect(problem).toContain('integer');
  });

  it('should accept an integer where a number is declared, and refuse the reverse', () => {
    // Given
    const schema = { type: 'integer' } as const;

    // When
    const asNumber = checkStreamItem('1', { type: 'number' });
    const asInteger = checkStreamItem('1.5', schema);

    // Then
    expect(asNumber).toBeNull();
    expect(asInteger).toContain('integer');
  });

  it('should say nothing at all when the document declares no item schema', () => {
    // Given
    const data = 'whatever the server felt like';

    // When
    const problem = checkStreamItem(data, undefined);

    // Then
    expect(problem).toBeNull();
  });
});

describe('runStream', () => {
  it('should mark an invalid element mid stream and go on delivering the ones after it', async () => {
    // Given
    const transport = new ScriptedStream([
      'data: {"id":1}\n\n',
      'data: {"id":"two"}\n\n',
      'data: {"id":3}\n\n',
    ]);

    // When
    const { elements, end } = await collect(transport, {
      format: 'sse',
      itemSchema: { type: 'object', properties: { id: { type: 'integer' } } },
    });

    // Then
    expect(elements.map((element) => element.seq)).toEqual([1, 2, 3]);
    expect(elements[1]?.problem).toContain('id');
    expect(elements[0]?.problem).toBeUndefined();
    expect(elements[2]?.problem).toBeUndefined();
    expect(end).toEqual({ reason: 'complete', received: 3, invalid: 1 });
  });

  it('should end on the terminator without showing it as an element, and close the request', async () => {
    // Given
    const transport = new ScriptedStream([
      'data: {"id":1}\n\n',
      'data: [DONE]\n\n',
      'data: {"id":2}\n\n',
    ]);

    // When
    const { elements, end } = await collect(transport, { format: 'sse', terminator: '[DONE]' });

    // Then
    expect(elements).toHaveLength(1);
    expect(end.reason).toBe('terminator');
    expect(transport.aborted).toBe(true);
  });

  it('should abort the underlying request when stopped, rather than stopping the reading', async () => {
    // Given
    const chunks = Array.from({ length: 1000 }, (_, index) => `data: {"id":${String(index)}}\n\n`);
    const transport = new ScriptedStream(chunks);
    const elements: StreamElement[] = [];
    const handle = runStream(
      PLAN,
      { format: 'sse' },
      {
        onElement: (element) => {
          elements.push(element);
          if (element.seq === 5) handle.stop();
        },
      },
      { transport },
    );

    // When
    const end = await handle.done;

    // Then
    expect(end.reason).toBe('stopped');
    expect(transport.aborted).toBe(true);
    expect(elements.length).toBeLessThan(chunks.length);
  });

  it('should bound a stream that never terminates by the idle timeout rather than running forever', async () => {
    // Given
    const transport = new SilentStream();
    // A HOLDER RATHER THAN A BARE LOCAL, because the compiler narrows a local assigned only inside
    // a callback to `never` at the call below, and the callback is the whole point of the case.
    const timer: { fire: (() => void) | null } = { fire: null };

    // When
    const handle = runStream(
      PLAN,
      { format: 'sse', idleTimeoutMs: 60_000 },
      { onElement: () => undefined },
      {
        transport,
        setTimer: (callback) => {
          timer.fire = callback;

          return 1;
        },
        clearTimer: () => undefined,
      },
    );
    await Promise.resolve();
    timer.fire?.();
    const end = await handle.done;

    // Then
    expect(end.reason).toBe('timeout');
    expect(end.message).toContain('60000');
    expect(transport.aborted).toBe(true);
  });

  it('should deliver ten thousand elements while the decoder holds none of them', async () => {
    // Given
    const chunks = Array.from({ length: 10_000 }, (_, index) => `{"id":${String(index)}}\n`);
    const transport = new ScriptedStream(chunks);
    let last = 0;
    let held = 0;

    // When
    const handle = runStream(
      PLAN,
      { format: 'ndjson' },
      {
        onElement: (element) => {
          last = element.seq;
          // The service keeps nothing: whatever is retained is retained by the caller, which is
          // the bounded window of SPEC 14.6 and lives in `@openref/vue`.
          held = Math.max(held, element.data.length);
        },
      },
      { transport },
    );
    const end = await handle.done;

    // Then
    expect(last).toBe(10_000);
    expect(end).toEqual({ reason: 'complete', received: 10_000, invalid: 0 });
    expect(held).toBeLessThan(64);
  });

  it('should report a refusal with the status and the body the server explained it with', async () => {
    // Given
    const transport = new ScriptedStream([], 503, '{"error":"the feed is down"}');

    // When
    const { elements, end } = await collect(transport, { format: 'sse' });

    // Then
    expect(elements).toEqual([]);
    expect(end.reason).toBe('refused');
    expect(end.message).toContain('503');
    expect(end.message).toContain('the feed is down');
  });

  it('should fail with a message rather than hang when one element never ends', async () => {
    // Given
    const transport = new ScriptedStream(['x'.repeat(64), 'y'.repeat(64)]);

    // When
    const { end } = await collect(transport, { format: 'ndjson', maxElementChars: 32 });

    // Then
    expect(end.reason).toBe('failed');
    expect(end.message).toContain('32');
    expect(transport.aborted).toBe(true);
  });
});

describe('RequestRunner.stream', () => {
  it('should refuse an operation the application never said streams, rather than guessing a format', () => {
    // Given
    const transport: IStreamTransport = {
      open: () =>
        Promise.resolve({
          status: 200,
          statusText: 'OK',
          headers: [],
          chunks: (async function* (): AsyncGenerator<string> {
            await Promise.resolve();
            yield '';
          })(),
        }),
    };
    const runner = createRunner({
      visibility: 'public',
      storage: 'memory',
      streamTransport: transport,
    });

    // When
    const open = (): unknown =>
      runner.stream(
        { operation: operation(), serverUrl: 'https://api.example.com', values: {} },
        { onElement: () => undefined },
      );

    // Then
    expect(open).toThrow('not declared as a stream');
  });

  it('should refuse to open a stream on a runner built with no stream transport', () => {
    // Given
    const runner = createRunner({ visibility: 'public', storage: 'memory' });

    // When
    const open = (): unknown =>
      runner.stream(
        {
          operation: { ...operation(), stream: { format: 'sse' } },
          serverUrl: 'https://api.example.com',
          values: {},
        },
        { onElement: () => undefined },
      );

    // Then
    expect(open).toThrow('without a stream transport');
  });

  it('should send the same request a send would, with the credentials this runner holds', async () => {
    // Given
    let seen: RequestPlan | null = null;
    const transport: IStreamTransport = {
      open(plan) {
        seen = plan;

        async function* produce(): AsyncGenerator<string> {
          await Promise.resolve();
          yield 'data: {"id":1}\n\n';
        }

        return Promise.resolve({ status: 200, statusText: 'OK', headers: [], chunks: produce() });
      },
    };
    const runner = createRunner({
      visibility: 'public',
      storage: 'memory',
      streamTransport: transport,
    });
    runner.setCredential('bearerAuth', 'token-1');

    // When
    const handle = runner.stream(
      {
        operation: operation({
          security: [{ id: 'bearerAuth', type: 'http', scheme: 'bearer' }],
          stream: { format: 'sse' },
        }),
        serverUrl: 'https://api.example.com',
        values: { 'path:id': { kind: 'primitive', value: '42' } },
      },
      { onElement: () => undefined },
    );
    const end = await handle.done;

    // Then
    expect(end.received).toBe(1);
    expect(seen).not.toBeNull();
    expect((seen as unknown as RequestPlan).url).toBe('https://api.example.com/orders/42');
    expect((seen as unknown as RequestPlan).headers.Authorization).toBe('Bearer token-1');
  });
});

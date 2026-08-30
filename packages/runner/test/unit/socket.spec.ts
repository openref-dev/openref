/**
 * The socket client of SPEC 14.7: the handshake, the log, the checking and the attempt budget.
 *
 * NOTHING HERE OPENS A SOCKET, and nothing here could. The transport is a double that records what
 * it was handed and hands back the callbacks, so every case drives the state machine from the
 * outside and no case waits on a network, a timer or a browser. That is the security rule of SPEC
 * 19 read for a test suite: zero external requests, and here zero requests at all.
 */

import { AuthError, ErrorCode, RunnerError } from '@openref/core';
import { describe, expect, it, vi } from 'vitest';
import {
  buildHandshake,
  checkSocketMessage,
  createSocketClient,
  createSocketLog,
  DEFAULT_SOCKET_LOG_WINDOW,
  DEFAULT_SOCKET_RECONNECT_ATTEMPTS,
  NativeWebSocketTransport,
  openSocket,
  SocketIoTransport,
  type ISocketTransport,
  type SocketHandshake,
  type SocketIoFactory,
  type SocketIoTransportOptions,
  type SocketSessionState,
  type SocketTransportHandlers,
  type WebSocketLike,
} from '../../src/index';

/** A transport that opens nothing and keeps what it was handed. */
interface Recorded {
  readonly transport: ISocketTransport;
  readonly opened: SocketHandshake[];
  readonly sent: string[];
  /** The handlers of the most recent open. */
  handlers(): SocketTransportHandlers;
  readonly closes: number;
}

function recordingTransport(): Recorded {
  const opened: SocketHandshake[] = [];
  const sent: string[] = [];
  let last: SocketTransportHandlers | undefined;
  const state = { closes: 0 };

  return {
    opened,
    sent,
    get closes(): number {
      return state.closes;
    },
    handlers: (): SocketTransportHandlers => {
      if (last === undefined) throw new Error('nothing was opened');

      return last;
    },
    transport: {
      open: (handshake, handlers) => {
        opened.push(handshake);
        last = handlers;

        return {
          send: (data) => {
            sent.push(data);
          },
          close: () => {
            state.closes += 1;
            handlers.onClose({ code: 1000, reason: '', clean: true });
          },
        };
      },
    },
  };
}

/** Timers that never fire by themselves, so a backoff is a value rather than a wait. */
function manualTimers(): {
  readonly setTimer: (callback: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
  readonly delays: number[];
  run(): void;
  readonly pending: number;
} {
  const queue: (() => void)[] = [];
  const delays: number[] = [];

  return {
    delays,
    get pending(): number {
      return queue.length;
    },
    setTimer: (callback, ms) => {
      delays.push(ms);
      queue.push(callback);

      return queue.length;
    },
    clearTimer: (handle) => {
      const index = (handle as number) - 1;
      if (index >= 0 && index < queue.length) queue[index] = (): void => undefined;
    },
    run: () => {
      const next = queue.shift();
      next?.();
    },
  };
}

describe('buildHandshake', () => {
  it('should refuse a value for a scheme that needs a handshake header rather than sending a broken request', () => {
    // Given, the scheme SPEC 14.7 points at the server bridge, with a value the reader supplied
    const schemes = [{ id: 'bearerAuth', type: 'http', scheme: 'bearer' }];

    // When
    const refuse = (): SocketHandshake =>
      buildHandshake({
        address: 'wss://example.test/events',
        transport: 'native',
        schemes,
        credentials: { bearerAuth: 'a-token' },
      });

    // Then, the limitation is named and the bridge is pointed at
    expect(refuse).toThrow(AuthError);
    expect(refuse).toThrow('bearerAuth');
    expect(refuse).toThrow('a native WebSocket cannot set one');
    expect(refuse).toThrow('server bridge');
  });

  it('should carry the cause and the scheme in the refusal context, so a console can draw it', () => {
    // Given
    let caught: AuthError | undefined;

    // When
    try {
      buildHandshake({
        address: 'wss://example.test/events',
        transport: 'native',
        schemes: [{ id: 'mtls', type: 'mutualTLS' }],
        credentials: { mtls: 'anything' },
      });
    } catch (cause) {
      caught = cause as AuthError;
    }

    // Then
    expect(caught?.code).toBe(ErrorCode.RUN_AUTH_FAILED);
    expect(caught?.context).toEqual({
      schemeId: 'mtls',
      type: 'mutualTLS',
      cause: 'transport-certificate',
    });
  });

  it('should pass over a blocked scheme the reader supplied no value for, per the T028 rule', () => {
    // Given, a channel that declares a bearer scheme and a reader who filled nothing in. Opening
    // it and reading whatever the server answers is a legitimate thing to try.
    const schemes = [{ id: 'bearerAuth', type: 'http', scheme: 'bearer' }];

    // When
    const handshake = buildHandshake({
      address: 'wss://example.test/events',
      transport: 'native',
      schemes,
      credentials: {},
    });

    // Then
    expect(handshake.url).toBe('wss://example.test/events');
    expect(handshake.auth).toEqual({});
  });

  it('should put a query key in the address, which is the one place a native socket has', () => {
    // Given
    const schemes = [{ id: 'apiKey', type: 'apiKey', in: 'query', name: 'token' }];

    // When
    const handshake = buildHandshake({
      address: 'wss://example.test/events?tenant=acme',
      transport: 'native',
      schemes,
      credentials: { apiKey: 'a b&c' },
    });

    // Then, the address keeps the query it had and the value is encoded
    expect(handshake.url).toBe('wss://example.test/events?tenant=acme&token=a%20b%26c');
    expect(handshake.auth).toEqual({});
  });

  it('should put a query key in the Socket.IO auth payload as well as in the address', () => {
    // Given, SPEC 14.7: `auth` is what a Socket.IO server reads and the query is what a proxy in
    // front of it sees, so a client that sent one of the two would work against half the
    // deployments.
    const schemes = [{ id: 'apiKey', type: 'apiKey', in: 'query', name: 'token' }];

    // When
    const handshake = buildHandshake({
      address: 'wss://example.test/socket.io',
      transport: 'socket.io',
      schemes,
      credentials: { apiKey: 'secret' },
    });

    // Then
    expect(handshake.kind).toBe('socket.io');
    expect(handshake.auth).toEqual({ token: 'secret' });
    expect(handshake.url).toBe('wss://example.test/socket.io?token=secret');
  });

  it('should refuse a query key whose parameter the document never named', () => {
    // Given
    const schemes = [{ id: 'apiKey', type: 'apiKey', in: 'query' }];

    // When
    const refuse = (): SocketHandshake =>
      buildHandshake({
        address: 'wss://example.test/events',
        transport: 'native',
        schemes,
        credentials: { apiKey: 'secret' },
      });

    // Then
    expect(refuse).toThrow(AuthError);
    expect(refuse).toThrow('names no parameter');
  });

  it('should place nothing for a cookie key, because the browser sends it without being asked', () => {
    // Given
    const schemes = [{ id: 'session', type: 'apiKey', in: 'cookie', name: 'sid' }];

    // When
    const handshake = buildHandshake({
      address: 'wss://example.test/events',
      transport: 'native',
      schemes,
      credentials: { session: 'ignored-here' },
    });

    // Then
    expect(handshake.url).toBe('wss://example.test/events');
    expect(handshake.auth).toEqual({});
  });
});

describe('checkSocketMessage', () => {
  it('should reach no verdict when the channel declares no message', () => {
    // Given, a channel that says nothing about what it carries

    // When
    const verdict = checkSocketMessage('{"id":1}', []);

    // Then, a message checked against nothing is not a message that passed
    expect(verdict).toEqual({});
  });

  it('should name the one declared message a payload failed', () => {
    // Given
    const schemas = [{ name: 'OrderPlaced', schema: { type: 'object', required: ['orderId'] } }];

    // When
    const verdict = checkSocketMessage('{"total":1}', schemas);

    // Then
    expect(verdict.matched).toBeUndefined();
    expect(verdict.problem).toContain('OrderPlaced');
    expect(verdict.problem).toContain('orderId');
  });

  it('should name which of several declared messages a payload is', () => {
    // Given
    const schemas = [
      { name: 'OrderPlaced', schema: { type: 'object', required: ['orderId'] } },
      { name: 'OrderCancelled', schema: { type: 'object', required: ['reason'] } },
    ];

    // When
    const verdict = checkSocketMessage('{"reason":"stock"}', schemas);

    // Then
    expect(verdict).toEqual({ matched: 'OrderCancelled' });
  });

  it('should count rather than accuse when a payload matches none of several', () => {
    // Given, naming one of them would send a reader to whichever happened to be first
    const schemas = [
      { name: 'OrderPlaced', schema: { type: 'object', required: ['orderId'] } },
      { name: 'OrderCancelled', schema: { type: 'object', required: ['reason'] } },
    ];

    // When
    const verdict = checkSocketMessage('{"unrelated":true}', schemas);

    // Then
    expect(verdict.matched).toBeUndefined();
    expect(verdict.problem).toBe(
      'this message matches none of the 2 messages the channel declares',
    );
  });
});

describe('createSocketLog', () => {
  it('should keep a window and count everything a session of ten thousand messages carried', () => {
    // Given
    const log = createSocketLog();

    // When
    for (let index = 0; index < 10_000; index += 1) {
      log.append({ direction: 'received', data: `{"n":${String(index)}}` });
    }
    const state = log.state();

    // Then, memory is the window and the totals are the session's
    expect(state.entries).toHaveLength(DEFAULT_SOCKET_LOG_WINDOW);
    expect(state.received).toBe(10_000);
    expect(state.dropped).toBe(10_000 - DEFAULT_SOCKET_LOG_WINDOW);
    expect(state.entries[0]?.seq).toBe(10_000 - DEFAULT_SOCKET_LOG_WINDOW + 1);
    expect(state.entries.at(-1)?.seq).toBe(10_000);
  });

  it('should count a marked entry as invalid and keep it in the window', () => {
    // Given
    const log = createSocketLog(2);

    // When
    log.append({ direction: 'received', data: 'a', problem: 'nothing declares this' });
    log.append({ direction: 'sent', data: 'b' });
    const state = log.state();

    // Then
    expect(state.invalid).toBe(1);
    expect(state.sent).toBe(1);
    expect(state.received).toBe(1);
    expect(state.entries.map((entry) => entry.data)).toEqual(['a', 'b']);
  });
});

describe('openSocket', () => {
  it('should refuse a blocked credential before it opens anything at all', () => {
    // Given, a transport that would record any open, so absence is proved against a subject that
    // records presence
    const recorded = recordingTransport();

    // When
    const refuse = (): unknown =>
      openSocket(
        {
          address: 'wss://example.test/events',
          transport: 'native',
          schemes: [{ id: 'bearerAuth', type: 'http', scheme: 'bearer' }],
          credentials: { bearerAuth: 'a-token' },
        },
        {},
        { transport: recorded.transport },
      );

    // Then
    expect(refuse).toThrow(AuthError);
    expect(recorded.opened).toHaveLength(0);
  });

  it('should open exactly one connection when nothing is blocked, which is what proves the case above', () => {
    // Given
    const recorded = recordingTransport();

    // When
    const session = openSocket(
      { address: 'wss://example.test/events', transport: 'native' },
      {},
      { transport: recorded.transport },
    );

    // Then
    expect(recorded.opened).toHaveLength(1);
    expect(session.state().status).toBe('connecting');
  });

  it('should mark a message that matches nothing and go on delivering', () => {
    // Given
    const recorded = recordingTransport();
    const session = openSocket(
      {
        address: 'wss://example.test/events',
        transport: 'native',
        messages: [{ name: 'Tick', schema: { type: 'object', required: ['at'] } }],
      },
      {},
      { transport: recorded.transport },
    );
    recorded.handlers().onOpen();

    // When
    recorded.handlers().onMessage('{"at":1}');
    recorded.handlers().onMessage('{"nothing":true}');
    recorded.handlers().onMessage('{"at":2}');
    const state = session.state();

    // Then, the session is still open, the failure is marked, and the traffic after it arrived
    expect(state.status).toBe('open');
    expect(state.log.received).toBe(3);
    expect(state.log.invalid).toBe(1);
    expect(state.log.entries[0]?.matched).toBe('Tick');
    expect(state.log.entries[1]?.problem).toContain('Tick');
    expect(state.log.entries[2]?.matched).toBe('Tick');
  });

  it('should file a frame it could not read as one rather than as a payload that failed a schema', () => {
    // Given a channel that declares one message, so the validator has a name to blame
    const recorded = recordingTransport();
    const session = openSocket(
      {
        address: 'wss://example.test/events',
        transport: 'native',
        messages: [{ name: 'Tick', schema: { type: 'object', required: ['at'] } }],
      },
      {},
      { transport: recorded.transport },
    );
    recorded.handlers().onOpen();

    // When a text message arrives that really does fail the schema, and then a frame that is not
    // text at all, which is what a server sending binary on a text channel produces
    recorded.handlers().onMessage('{"nothing":true}');
    recorded.handlers().onUnreadableFrame('the server sent a frame that is not text');
    const state = session.state();

    // Then the two are told apart. Before `T059` the binary frame went down the message path
    // carrying a sentence this package wrote, so a reader was told it did not match `Tick`, which
    // is a true statement about that sentence and a false one about what the server sent.
    expect(state.log.invalid).toBe(1);
    expect(state.log.unreadable).toBe(1);
    expect(state.log.entries[0]?.problem).toContain('Tick');
    expect(state.log.entries[1]?.problem).toBe('the server sent a frame that is not text');
    expect(state.log.entries[1]?.problem).not.toContain('Tick');
    expect(state.log.entries[1]?.unreadable).toBe(true);
    expect(state.status).toBe('open');
  });

  it('should log what it sends as well as what it receives', () => {
    // Given
    const recorded = recordingTransport();
    const session = openSocket(
      { address: 'wss://example.test/events', transport: 'native' },
      {},
      { transport: recorded.transport },
    );
    recorded.handlers().onOpen();

    // When
    session.send('{"subscribe":"orders"}');

    // Then
    expect(recorded.sent).toEqual(['{"subscribe":"orders"}']);
    expect(session.state().log.entries).toEqual([
      { seq: 1, direction: 'sent', data: '{"subscribe":"orders"}' },
    ]);
  });

  it('should refuse a send on a session that is not open rather than dropping the message', () => {
    // Given
    const recorded = recordingTransport();
    const session = openSocket(
      { address: 'wss://example.test/events', transport: 'native' },
      {},
      { transport: recorded.transport },
    );

    // When
    const send = (): void => {
      session.send('too early');
    };

    // Then
    expect(send).toThrow(RunnerError);
    expect(send).toThrow('connecting rather than open');
    expect(recorded.sent).toHaveLength(0);
  });

  it('should stop reconnecting on a refusing server after its budget, with the delays doubling to the ceiling', async () => {
    // Given, a server that never keeps a connection: every open closes without a handshake
    const recorded = recordingTransport();
    const timers = manualTimers();
    const session = openSocket(
      {
        address: 'wss://example.test/events',
        transport: 'native',
        maxReconnectAttempts: 4,
        reconnectDelayMs: 100,
      },
      {},
      { transport: recorded.transport, setTimer: timers.setTimer, clearTimer: timers.clearTimer },
    );

    // When, every attempt is refused and every scheduled reconnection is let through
    for (let round = 0; round < 5; round += 1) {
      recorded.handlers().onError('refused');
      recorded.handlers().onClose({ code: 0, reason: '', clean: false });
      timers.run();
    }
    const ended = await session.closed;

    // Then, five opens for one attempt plus four reconnections, and nothing left armed
    expect(recorded.opened).toHaveLength(5);
    expect(ended.status).toBe('refused');
    expect(ended.attempts).toBe(5);
    expect(ended.message).toContain('No connection was kept after 5 attempts');
    expect(timers.delays).toEqual([100, 200, 400, 800]);
    expect(timers.pending).toBe(0);
  });

  it('should hold the backoff at the ceiling once doubling reaches it, rather than growing for ever', async () => {
    // Given a budget past the ceiling: SPEC 14.7 caps the multiplier at 8x, so the sequence has a
    // flat tail and the committed four attempt case stops one step before the clamp ever fires
    const recorded = recordingTransport();
    const timers = manualTimers();
    const session = openSocket(
      {
        address: 'wss://example.test/events',
        transport: 'native',
        maxReconnectAttempts: 6,
        reconnectDelayMs: 100,
      },
      {},
      { transport: recorded.transport, setTimer: timers.setTimer, clearTimer: timers.clearTimer },
    );

    // When every attempt is refused
    for (let round = 0; round < 7; round += 1) {
      recorded.handlers().onClose({ code: 0, reason: '', clean: false });
      timers.run();
    }
    const ended = await session.closed;

    // Then the fifth and sixth delays are the fourth, which is the clamp having fired: 2^4 and
    // 2^5 are 16 and 32, and both read 8
    expect(timers.delays).toEqual([100, 200, 400, 800, 800, 800]);
    expect(ended.status).toBe('refused');
    expect(recorded.opened).toHaveLength(7);
  });

  it('should hold a ten thousand message session to its window, driven through the session itself', () => {
    // Given the clause of T055, exercised on the path a reader is on rather than on the log alone:
    // the transport, the check and the publishing all run ten thousand times here
    const recorded = recordingTransport();
    const states: SocketSessionState[] = [];
    const session = openSocket(
      { address: 'wss://example.test/events', transport: 'native' },
      { onState: (state) => states.push(state) },
      { transport: recorded.transport },
    );
    recorded.handlers().onOpen();

    // When
    for (let index = 0; index < 10_000; index += 1) {
      recorded.handlers().onMessage(`{"n":${String(index)}}`);
    }
    const state = session.state();

    // Then memory is the window, the totals are the session's, and it is still open
    expect(state.status).toBe('open');
    expect(state.log.entries).toHaveLength(DEFAULT_SOCKET_LOG_WINDOW);
    expect(state.log.received).toBe(10_000);
    expect(state.log.dropped).toBe(10_000 - DEFAULT_SOCKET_LOG_WINDOW);
    expect(state.log.entries[0]?.data).toBe('{"n":9500}');
    expect(state.log.entries.at(-1)?.data).toBe('{"n":9999}');
    // And the published states are not a growing pile of windows either: each is the window as it
    // was, and the last one is what a page would be drawing
    expect(states.at(-1)?.log.entries).toHaveLength(DEFAULT_SOCKET_LOG_WINDOW);
  });

  it('should not restore the budget when a connection opens, so an accept and close server is still bounded', async () => {
    // Given, the design the obvious one loops forever against: a server that accepts every
    // connection and immediately closes it
    const recorded = recordingTransport();
    const timers = manualTimers();
    const session = openSocket(
      {
        address: 'wss://example.test/events',
        transport: 'native',
        maxReconnectAttempts: 2,
        reconnectDelayMs: 10,
      },
      {},
      { transport: recorded.transport, setTimer: timers.setTimer, clearTimer: timers.clearTimer },
    );

    // When
    for (let round = 0; round < 3; round += 1) {
      recorded.handlers().onOpen();
      recorded.handlers().onClose({ code: 1006, reason: 'gone', clean: false });
      timers.run();
    }
    const ended = await session.closed;

    // Then
    expect(recorded.opened).toHaveLength(3);
    expect(ended.status).toBe('refused');
    expect(timers.pending).toBe(0);
  });

  it('should not say no connection was kept when every connection was kept and then closed', async () => {
    // Given a server that opens, delivers and closes cleanly on every attempt, which is the shape
    // a blind review probed: the bound is right and the first wording was false of it
    const recorded = recordingTransport();
    const timers = manualTimers();
    const session = openSocket(
      {
        address: 'wss://example.test/events',
        transport: 'native',
        maxReconnectAttempts: 1,
        reconnectDelayMs: 10,
      },
      {},
      { transport: recorded.transport, setTimer: timers.setTimer, clearTimer: timers.clearTimer },
    );

    // When each of the two connections opens, delivers one message and is closed by the server
    for (let round = 0; round < 2; round += 1) {
      recorded.handlers().onOpen();
      recorded.handlers().onMessage(`{"round":${String(round)}}`);
      recorded.handlers().onClose({ code: 1000, reason: '', clean: true });
      timers.run();
    }
    const ended = await session.closed;

    // Then the bound held and the sentence is about what happened
    expect(ended.status).toBe('refused');
    expect(ended.attempts).toBe(2);
    expect(ended.log.received).toBe(2);
    expect(ended.message).toContain(
      'The server closed each of the 2 connections this session opened, which delivered 2 messages in all, so the budget is spent.',
    );
    expect(ended.message).not.toContain('No connection was kept');
  });

  it('should count one delivered message in the singular, since a reader reads the sentence', () => {
    // Given a session that delivers one message across two connections, driven through a real
    // reconnection rather than by calling a close twice, which the port forbids
    const recorded = recordingTransport();
    const timers = manualTimers();
    const session = openSocket(
      {
        address: 'wss://example.test/events',
        transport: 'native',
        maxReconnectAttempts: 1,
        reconnectDelayMs: 10,
      },
      {},
      { transport: recorded.transport, setTimer: timers.setTimer, clearTimer: timers.clearTimer },
    );

    // When the first connection carries the one message and the second carries none
    recorded.handlers().onOpen();
    recorded.handlers().onMessage('{"one":true}');
    recorded.handlers().onClose({ code: 1000, reason: '', clean: true });
    timers.run();
    recorded.handlers().onOpen();
    recorded.handlers().onClose({ code: 1000, reason: '', clean: true });

    // Then
    expect(recorded.opened).toHaveLength(2);
    expect(session.state().message).toContain('delivered 1 message in all');
    expect(session.state().message).not.toContain('1 messages');
  });

  it('should never reconnect when the budget is zero, and say only why the server closed', async () => {
    // Given
    const recorded = recordingTransport();
    const timers = manualTimers();
    const session = openSocket(
      {
        address: 'wss://example.test/events',
        transport: 'native',
        maxReconnectAttempts: 0,
      },
      {},
      { transport: recorded.transport, setTimer: timers.setTimer, clearTimer: timers.clearTimer },
    );

    // When
    recorded.handlers().onClose({ code: 1011, reason: 'boom', clean: true });
    const ended = await session.closed;

    // Then
    expect(recorded.opened).toHaveLength(1);
    expect(ended.status).toBe('refused');
    expect(ended.message).toBe('The server closed the socket with code 1011: boom.');
    expect(timers.delays).toEqual([]);
  });

  it('should default the budget to the figure SPEC 14.7 records', () => {
    // Given, the default is a number this suite reads rather than repeats

    // When
    const budget = DEFAULT_SOCKET_RECONNECT_ATTEMPTS;

    // Then
    expect(budget).toBe(3);
  });

  it('should end a session the page closed as closed rather than as refused', async () => {
    // Given
    const recorded = recordingTransport();
    const session = openSocket(
      { address: 'wss://example.test/events', transport: 'native' },
      {},
      { transport: recorded.transport },
    );
    recorded.handlers().onOpen();

    // When
    session.close();
    const ended = await session.closed;

    // Then
    expect(ended.status).toBe('closed');
    expect(recorded.closes).toBe(1);
    expect(ended.message).toBe('the session was closed from this page');
  });

  it('should cancel a pending reconnection when the page closes the session', async () => {
    // Given, a session waiting on a backoff timer, which has no connection to ask
    const recorded = recordingTransport();
    const timers = manualTimers();
    const session = openSocket(
      { address: 'wss://example.test/events', transport: 'native', reconnectDelayMs: 5 },
      {},
      { transport: recorded.transport, setTimer: timers.setTimer, clearTimer: timers.clearTimer },
    );
    recorded.handlers().onClose({ code: 1006, reason: '', clean: false });
    expect(timers.delays).toHaveLength(1);

    // When
    session.close();
    timers.run();
    const ended = await session.closed;

    // Then, the cleared timer fired into nothing and no second connection was opened
    expect(ended.status).toBe('closed');
    expect(recorded.opened).toHaveLength(1);
  });

  it('should publish a state on every message, so a page that mirrors it sees each one', () => {
    // Given
    const recorded = recordingTransport();
    const seen: SocketSessionState[] = [];
    openSocket(
      { address: 'wss://example.test/events', transport: 'native' },
      { onState: (state) => seen.push(state) },
      { transport: recorded.transport },
    );

    // When
    recorded.handlers().onOpen();
    recorded.handlers().onMessage('one');
    recorded.handlers().onMessage('two');

    // Then, connecting, open, and one per message
    expect(seen.map((state) => state.status)).toEqual(['connecting', 'open', 'open', 'open']);
    expect(seen.at(-1)?.log.received).toBe(2);
  });
});

describe('createSocketClient', () => {
  it('should bind the transport and its defaults, so a host composes them once', () => {
    // Given, the composition point a page is handed: window size and attempt budget are the
    // host's decision and the address is the reader's
    const recorded = recordingTransport();
    const timers = manualTimers();
    const client = createSocketClient(
      { transport: recorded.transport, setTimer: timers.setTimer, clearTimer: timers.clearTimer },
      { windowSize: 2, maxReconnectAttempts: 0 },
    );

    // When
    const session = client.open({ address: 'wss://example.test/events', transport: 'native' }, {});
    recorded.handlers().onOpen();
    recorded.handlers().onMessage('a');
    recorded.handlers().onMessage('b');
    recorded.handlers().onMessage('c');

    // Then the host's window applies to a session that never mentioned one
    expect(recorded.opened).toHaveLength(1);
    expect(session.state().log.entries.map((entry) => entry.data)).toEqual(['b', 'c']);
    expect(session.state().log.dropped).toBe(1);
  });

  it('should let one session override a default the host set', () => {
    // Given
    const recorded = recordingTransport();
    const client = createSocketClient({ transport: recorded.transport }, { windowSize: 1 });

    // When
    const session = client.open(
      { address: 'wss://example.test/events', transport: 'native', windowSize: 3 },
      {},
    );
    recorded.handlers().onOpen();
    recorded.handlers().onMessage('a');
    recorded.handlers().onMessage('b');

    // Then
    expect(session.state().log.entries).toHaveLength(2);
    expect(session.state().log.dropped).toBe(0);
  });

  it('should refuse a blocked credential through the client too, before it opens anything', () => {
    // Given
    const recorded = recordingTransport();
    const client = createSocketClient({ transport: recorded.transport });

    // When
    const refuse = (): unknown =>
      client.open(
        {
          address: 'wss://example.test/events',
          transport: 'native',
          schemes: [{ id: 'bearerAuth', type: 'http', scheme: 'bearer' }],
          credentials: { bearerAuth: 'a-token' },
        },
        {},
      );

    // Then
    expect(refuse).toThrow(AuthError);
    expect(recorded.opened).toHaveLength(0);
  });
});

describe('NativeWebSocketTransport', () => {
  /** A socket double with the four handlers a browser sets. */
  function fakeSocket(): WebSocketLike & { sent: string[]; closed: number } {
    return {
      sent: [],
      closed: 0,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send(data: string) {
        this.sent.push(data);
      },
      close() {
        this.closed += 1;
      },
    };
  }

  it('should refuse an auth payload rather than connecting without it', () => {
    // Given, a handshake planned for Socket.IO handed to the native transport
    const socket = fakeSocket();
    const transport = new NativeWebSocketTransport({ create: () => socket });

    // When
    const open = (): unknown =>
      transport.open(
        { kind: 'socket.io', url: 'wss://example.test', protocols: [], auth: { token: 'secret' } },
        {
          onOpen: vi.fn(),
          onMessage: vi.fn(),
          onUnreadableFrame: vi.fn(),
          onClose: vi.fn(),
          onError: vi.fn(),
        },
      );

    // Then, no socket is constructed and the reader is told which route is left
    expect(open).toThrow(RunnerError);
    expect(open).toThrow('cannot send an auth payload');
    expect(open).toThrow('server bridge');
  });

  it('should hand the url and the subprotocols to the constructor and nothing else', () => {
    // Given
    const socket = fakeSocket();
    const create = vi.fn(() => socket);
    const transport = new NativeWebSocketTransport({ create });

    // When
    transport.open(
      { kind: 'native', url: 'wss://example.test/events?t=1', protocols: ['ocpp1.6'], auth: {} },
      {
        onOpen: vi.fn(),
        onMessage: vi.fn(),
        onUnreadableFrame: vi.fn(),
        onClose: vi.fn(),
        onError: vi.fn(),
      },
    );

    // Then
    expect(create).toHaveBeenCalledWith('wss://example.test/events?t=1', ['ocpp1.6']);
  });

  it('should report a binary frame on its own path rather than as a message that failed a schema', () => {
    // Given
    const socket = fakeSocket();
    const transport = new NativeWebSocketTransport({ create: () => socket });
    const onMessage = vi.fn();
    const onUnreadableFrame = vi.fn();
    transport.open(
      { kind: 'native', url: 'wss://example.test', protocols: [], auth: {} },
      { onOpen: vi.fn(), onMessage, onUnreadableFrame, onClose: vi.fn(), onError: vi.fn() },
    );

    // When
    socket.onmessage?.({ data: { byteLength: 4 } });

    // Then the frame goes nowhere near the validator, per SPEC 14.7 as `T059` wrote it.
    expect(onMessage).not.toHaveBeenCalled();
    expect(onUnreadableFrame).toHaveBeenCalledWith(
      'the server sent a frame that is not text, and this console reads text frames only',
    );
  });

  it('should report one close per open even when the browser fires the error first', () => {
    // Given
    const socket = fakeSocket();
    const transport = new NativeWebSocketTransport({ create: () => socket });
    const onClose = vi.fn();
    const onError = vi.fn();
    transport.open(
      { kind: 'native', url: 'wss://example.test', protocols: [], auth: {} },
      { onOpen: vi.fn(), onMessage: vi.fn(), onUnreadableFrame: vi.fn(), onClose, onError },
    );

    // When
    socket.onerror?.({});
    socket.onclose?.({ code: 1006, reason: '', wasClean: false });
    socket.onclose?.({ code: 1006, reason: '', wasClean: false });

    // Then
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith({ code: 1006, reason: '', clean: false });
  });

  it('should construct the page own WebSocket when no factory was given', () => {
    // Given, a stand in for the global so that the default path is exercised without a network:
    // this suite makes no request of any kind, per SPEC 19.
    const socket = fakeSocket();
    const constructed: (readonly unknown[])[] = [];
    vi.stubGlobal(
      'WebSocket',
      function (this: unknown, url: string, protocols?: readonly string[]) {
        constructed.push([url, protocols]);

        return socket;
      },
    );

    // When
    new NativeWebSocketTransport().open(
      { kind: 'native', url: 'wss://example.test/events', protocols: ['v1'], auth: {} },
      {
        onOpen: vi.fn(),
        onMessage: vi.fn(),
        onUnreadableFrame: vi.fn(),
        onClose: vi.fn(),
        onError: vi.fn(),
      },
    );

    // Then
    expect(constructed).toEqual([['wss://example.test/events', ['v1']]]);
    vi.unstubAllGlobals();
  });

  it('should refuse to open in a runtime that carries no WebSocket rather than looking connected', () => {
    // Given, the global asserted present before it is taken away, so the refusal is proved
    // against a subject that was there
    expect(typeof (globalThis as { WebSocket?: unknown }).WebSocket).toBe('function');
    vi.stubGlobal('WebSocket', undefined);
    const transport = new NativeWebSocketTransport();

    // When
    const open = (): unknown =>
      transport.open(
        { kind: 'native', url: 'wss://example.test', protocols: [], auth: {} },
        {
          onOpen: vi.fn(),
          onMessage: vi.fn(),
          onUnreadableFrame: vi.fn(),
          onClose: vi.fn(),
          onError: vi.fn(),
        },
      );

    // Then
    expect(open).toThrow(RunnerError);
    expect(open).toThrow('carries no WebSocket');
    vi.unstubAllGlobals();
  });
});

describe('SocketIoTransport', () => {
  /** A Socket.IO client double that keeps its listeners. */
  function fakeClient(): {
    readonly listeners: Map<string, (...args: readonly unknown[]) => void>;
    readonly emitted: (readonly unknown[])[];
    disconnects: number;
    on(event: string, listener: (...args: readonly unknown[]) => void): unknown;
    emit(event: string, ...args: readonly unknown[]): unknown;
    disconnect(): unknown;
  } {
    const listeners = new Map<string, (...args: readonly unknown[]) => void>();
    const emitted: (readonly unknown[])[] = [];

    return {
      listeners,
      emitted,
      disconnects: 0,
      on(event, listener) {
        listeners.set(event, listener);

        return this;
      },
      emit(event, ...args) {
        emitted.push([event, ...args]);

        return this;
      },
      disconnect() {
        this.disconnects += 1;

        return this;
      },
    };
  }

  it('should hand the auth payload to the client and switch its own reconnection off', () => {
    // Given
    const client = fakeClient();
    const create = vi.fn(() => client);
    const transport = new SocketIoTransport({ create });

    // When
    transport.open(
      {
        kind: 'socket.io',
        url: 'wss://example.test/socket.io?token=secret',
        protocols: [],
        auth: { token: 'secret' },
      },
      {
        onOpen: vi.fn(),
        onMessage: vi.fn(),
        onUnreadableFrame: vi.fn(),
        onClose: vi.fn(),
        onError: vi.fn(),
      },
    );

    // Then, the session owns the attempt budget, so the client may not run one underneath it
    expect(create).toHaveBeenCalledWith('wss://example.test/socket.io?token=secret', {
      auth: { token: 'secret' },
      reconnection: false,
      transports: ['websocket'],
    });
  });

  it('should refuse a missing io function by name, rather than dying on a bare TypeError later', () => {
    // Given the mistake a JavaScript caller makes and a host whose dynamic import of
    // socket.io-client resolved to a module without the export they expected
    const missing = (): unknown => new SocketIoTransport({} as unknown as SocketIoTransportOptions);
    const wrong = (): unknown =>
      new SocketIoTransport({ create: 'io' as unknown as SocketIoFactory });

    // Then both are named refusals with a code and a sentence pointing at what to hand in
    expect(missing).toThrow(RunnerError);
    expect(missing).toThrow('built with no io function');
    expect(missing).toThrow('socket.io-client');
    expect(wrong).toThrow(RunnerError);
  });

  it('should carry the not available code and what it was given on that refusal', () => {
    // Given
    let caught: RunnerError | undefined;

    // When
    try {
      new SocketIoTransport({ create: 42 as unknown as SocketIoFactory });
    } catch (cause) {
      caught = cause as RunnerError;
    }

    // Then
    expect(caught?.code).toBe(ErrorCode.RUN_NOT_AVAILABLE);
    expect(caught?.context).toEqual({ given: 'number' });
  });

  it('should construct without complaint when a real factory is handed in, which is what makes the two above the callers fault', () => {
    // Given the control: the same constructor with the argument it asks for
    const build = (): unknown => new SocketIoTransport({ create: () => fakeClient() });

    // Then
    expect(build).not.toThrow();
  });

  it('should refuse a handshake planned for a native socket, whose credentials went elsewhere', () => {
    // Given
    const transport = new SocketIoTransport({ create: () => fakeClient() });

    // When
    const open = (): unknown =>
      transport.open(
        { kind: 'native', url: 'wss://example.test', protocols: [], auth: {} },
        {
          onOpen: vi.fn(),
          onMessage: vi.fn(),
          onUnreadableFrame: vi.fn(),
          onClose: vi.fn(),
          onError: vi.fn(),
        },
      );

    // Then
    expect(open).toThrow(RunnerError);
    expect(open).toThrow('built for a native socket');
  });

  it('should follow a connect error with a close, because the port owes one close per open', () => {
    // Given, the client's own behaviour is to emit no `disconnect` after `connect_error`, so a
    // session driven by closes alone would wait for ever
    const client = fakeClient();
    const transport = new SocketIoTransport({ create: () => client });
    const onClose = vi.fn();
    const onError = vi.fn();
    transport.open(
      { kind: 'socket.io', url: 'wss://example.test', protocols: [], auth: {} },
      { onOpen: vi.fn(), onMessage: vi.fn(), onUnreadableFrame: vi.fn(), onClose, onError },
    );

    // When
    client.listeners.get('connect_error')?.(new Error('xhr poll error'));

    // Then
    expect(onError).toHaveBeenCalledWith('xhr poll error');
    expect(onClose).toHaveBeenCalledWith({ code: 0, reason: 'xhr poll error', clean: false });
  });

  it('should read the closing handshake reasons as clean and everything else as not', () => {
    // Given
    const first = fakeClient();
    const second = fakeClient();
    const transport = new SocketIoTransport({ create: () => first });
    const clean = vi.fn();
    const abrupt = vi.fn();
    transport.open(
      { kind: 'socket.io', url: 'wss://example.test', protocols: [], auth: {} },
      {
        onOpen: vi.fn(),
        onMessage: vi.fn(),
        onUnreadableFrame: vi.fn(),
        onClose: clean,
        onError: vi.fn(),
      },
    );
    new SocketIoTransport({ create: () => second }).open(
      { kind: 'socket.io', url: 'wss://example.test', protocols: [], auth: {} },
      {
        onOpen: vi.fn(),
        onMessage: vi.fn(),
        onUnreadableFrame: vi.fn(),
        onClose: abrupt,
        onError: vi.fn(),
      },
    );

    // When
    first.listeners.get('disconnect')?.('io server disconnect');
    second.listeners.get('disconnect')?.('transport close');

    // Then
    expect(clean).toHaveBeenCalledWith({
      code: 1000,
      reason: 'io server disconnect',
      clean: true,
    });
    expect(abrupt).toHaveBeenCalledWith({ code: 1006, reason: 'transport close', clean: false });
  });

  it('should carry messages on one named event, in both directions', () => {
    // Given
    const client = fakeClient();
    const transport = new SocketIoTransport({ create: () => client, event: 'order' });
    const onMessage = vi.fn();
    const connection = transport.open(
      { kind: 'socket.io', url: 'wss://example.test', protocols: [], auth: {} },
      {
        onOpen: vi.fn(),
        onMessage,
        onUnreadableFrame: vi.fn(),
        onClose: vi.fn(),
        onError: vi.fn(),
      },
    );

    // When
    connection.send('{"id":1}');
    client.listeners.get('order')?.({ id: 2 });

    // Then, a payload that is not text is serialized once, here
    expect(client.emitted).toEqual([['order', '{"id":1}']]);
    expect(onMessage).toHaveBeenCalledWith('{"id":2}');
  });
});

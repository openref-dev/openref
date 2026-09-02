/**
 * `useSocket`, the composable `T008` declared and `T055` filled, per SPEC 14.7.
 *
 * THE TWO HALVES ARE TESTED SEPARATELY BECAUSE THEY HAVE DIFFERENT PREREQUISITES. `blocked` is a
 * fact about the document and is asserted with no port at all, because that is the state every
 * page this repository ships is in and the statement still has to be true there. Everything else
 * needs a client, and the client here is a double: this package cannot see `@openref/runner`, and
 * the point of the port is that it does not have to.
 */

import { ErrorCode, RunnerError } from '@openref/core';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { describe, expect, it } from 'vitest';
import { normalizeAsyncApiDocument, parseSpecification } from '@openref/core';
import { createDocState, provideDocState, provideSocket, useSocket } from '../../src/index';
import type {
  DocState,
  ISocketPort,
  SocketLogEntryView,
  SocketOpenInput,
  SocketSessionHandlersView,
  SocketSessionStateView,
  SocketSessionView,
  UseSocket,
} from '../../src/index';

/**
 * An events document whose channel requires three schemes: one a browser can present at a
 * handshake and two it cannot, one of each kind SPEC 14.7 sends to different places.
 */
function securedEventsDocument(): ReturnType<typeof normalizeAsyncApiDocument> {
  return normalizeAsyncApiDocument(
    parseSpecification(`
asyncapi: 3.1.0
info:
  title: Orders events
  version: '1.0.0'
servers:
  broker:
    host: ws.example.com
    protocol: ws
    security:
      - $ref: '#/components/securitySchemes/bearerAuth'
      - $ref: '#/components/securitySchemes/queryKey'
channels:
  created:
    address: orders.created
    title: Orders created
    servers:
      - $ref: '#/servers/broker'
    messages:
      OrderCreated:
        title: Order created
        payload:
          type: object
          required:
            - id
          properties:
            id:
              type: string
operations:
  publishOrderCreated:
    action: send
    channel:
      $ref: '#/channels/created'
    security:
      - $ref: '#/components/securitySchemes/sasl'
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
    queryKey:
      type: httpApiKey
      in: query
      name: token
    sasl:
      type: scramSha256
`),
  );
}

/** A session double that records what it was asked and publishes what it is told to. */
interface FakeSession extends SocketSessionView {
  readonly sent: string[];
  publish(state: SocketSessionStateView): void;
  readonly closes: number;
}

/** A port double, plus what the last `open` was handed. */
interface FakePort {
  readonly port: ISocketPort;
  readonly opened: SocketOpenInput[];
  session(): FakeSession;
}

function fakePort(refuse?: Error): FakePort {
  const opened: SocketOpenInput[] = [];
  let last: FakeSession | undefined;

  return {
    opened,
    session: (): FakeSession => {
      if (last === undefined) throw new Error('nothing was opened');

      return last;
    },
    port: {
      open: (input: SocketOpenInput, handlers: SocketSessionHandlersView): SocketSessionView => {
        opened.push(input);
        if (refuse !== undefined) throw refuse;

        const sent: string[] = [];
        const counters = { closes: 0 };
        let state: SocketSessionStateView = {
          status: 'connecting',
          log: { entries: [], sent: 0, received: 0, invalid: 0, unreadable: 0, dropped: 0 },
          attempts: 1,
        };

        const session: FakeSession = {
          sent,
          get closes(): number {
            return counters.closes;
          },
          state: () => state,
          send: (data) => {
            sent.push(data);
          },
          close: () => {
            counters.closes += 1;
          },
          closed: Promise.resolve(state),
          publish: (next) => {
            state = next;
            handlers.onState?.(next);
          },
        };

        last = session;

        return session;
      },
    },
  };
}

/** Runs a composable under a state, and optionally under a socket client. */
async function withSocket(
  state: DocState,
  body: () => UseSocket,
  port?: ISocketPort,
): Promise<UseSocket> {
  let captured: { value: UseSocket } | undefined;

  const child = defineComponent({
    name: 'Child',
    setup() {
      captured = { value: body() };

      return () => h('div');
    },
  });

  const parent = defineComponent({
    name: 'Parent',
    setup() {
      provideDocState(state);
      if (port !== undefined) provideSocket(port);

      return () => h(child);
    },
  });

  await renderToString(createSSRApp(parent));

  if (captured === undefined) throw new Error('the child setup never ran');

  return captured.value;
}

/** A published state carrying one log entry, so a mirror can be asserted. */
function stateWith(entries: readonly SocketLogEntryView[]): SocketSessionStateView {
  return {
    status: 'open',
    log: {
      entries,
      sent: entries.filter((entry) => entry.direction === 'sent').length,
      received: entries.filter((entry) => entry.direction === 'received').length,
      invalid: entries.filter((entry) => entry.problem !== undefined && entry.unreadable !== true)
        .length,
      unreadable: entries.filter((entry) => entry.unreadable === true).length,
      dropped: 0,
    },
    attempts: 1,
  };
}

describe('useSocket', () => {
  it('should name what a browser cannot present with no client and no connection at all', async () => {
    // Given, the state a page this repository ships is in: a document and no socket client
    const state = createDocState({ document: securedEventsDocument() });

    // When
    const socket = await withSocket(state, () => useSocket('channel-orders-created'));

    // Then, the statement is available without a port, and the presentable scheme is not in it
    expect(socket.available.value).toBe(false);
    expect(socket.blocked.value).toEqual([
      { schemeId: 'bearerAuth', type: 'http', cause: 'handshake-header' },
      { schemeId: 'sasl', type: 'scramSha256', cause: 'connection-credential' },
    ]);
  });

  it('should read the server requirement and the operation requirement, which are two positions', async () => {
    // Given, SPEC 8.2: what connecting costs and what performing costs are separate lists
    const state = createDocState({ document: securedEventsDocument() });

    // When
    const socket = await withSocket(state, () => useSocket('channel-orders-created'));

    // Then, the server contributed the first and the operation the second
    expect(socket.blocked.value.map((block) => block.schemeId)).toEqual(['bearerAuth', 'sasl']);
  });

  it('should say nothing about a node that is not a channel', async () => {
    // Given
    const state = createDocState({ document: securedEventsDocument() });

    // When
    const socket = await withSocket(state, () => useSocket('no-such-node'));

    // Then
    expect(socket.blocked.value).toEqual([]);
    expect(socket.available.value).toBe(false);
  });

  it('should report available once a client is provided and the node is a channel', async () => {
    // Given
    const state = createDocState({ document: securedEventsDocument() });
    const fake = fakePort();

    // When
    const socket = await withSocket(state, () => useSocket('channel-orders-created'), fake.port);

    // Then
    expect(socket.available.value).toBe(true);
    expect(socket.status.value).toBe('idle');
  });

  it('should hand the channel own schemes to the client, so the refusal can be about them', async () => {
    // Given
    const state = createDocState({ document: securedEventsDocument() });
    const fake = fakePort();
    const socket = await withSocket(state, () => useSocket('channel-orders-created'), fake.port);

    // When
    await socket.connect({
      address: 'wss://ws.example.com/orders',
      transport: 'native',
      credentials: { queryKey: 'a-token' },
    });

    // Then
    expect(fake.opened[0]?.schemes).toEqual([
      { id: 'bearerAuth', type: 'http', scheme: 'bearer' },
      { id: 'queryKey', type: 'httpApiKey', in: 'query', name: 'token' },
      { id: 'sasl', type: 'scramSha256' },
    ]);
    expect(fake.opened[0]?.credentials).toEqual({ queryKey: 'a-token' });
  });

  it('should mirror the state the session publishes rather than keeping a second copy', async () => {
    // Given
    const state = createDocState({ document: securedEventsDocument() });
    const fake = fakePort();
    const socket = await withSocket(state, () => useSocket('channel-orders-created'), fake.port);
    await socket.connect({ address: 'wss://ws.example.com/orders', transport: 'native' });

    // When
    fake.session().publish(
      stateWith([
        { seq: 1, direction: 'received', data: '{"id":"1"}', matched: 'OrderCreated' },
        { seq: 2, direction: 'received', data: '{}', problem: 'nothing declares this' },
      ]),
    );

    // Then
    expect(socket.status.value).toBe('open');
    expect(socket.log.value.received).toBe(2);
    expect(socket.log.value.invalid).toBe(1);
    expect(socket.log.value.entries[1]?.problem).toBe('nothing declares this');
  });

  it('should let a theme read the unreadable counter the runner splits out, per T065', async () => {
    // Given, the split `T059` made in the runner: a frame that was never read is not a schema
    // mismatch, and until `T065` the view type had no member for it, so a consumer could read
    // neither the counter nor which entry it was about.
    const state = createDocState({ document: securedEventsDocument() });
    const fake = fakePort();
    const socket = await withSocket(state, () => useSocket('channel-orders-created'), fake.port);
    await socket.connect({ address: 'wss://ws.example.com/orders', transport: 'native' });

    // When
    fake.session().publish(
      stateWith([
        { seq: 1, direction: 'received', data: '{"id":"1"}', matched: 'OrderCreated' },
        { seq: 2, direction: 'received', data: '{}', problem: 'nothing declares this' },
        {
          seq: 3,
          direction: 'received',
          data: '[binary frame]',
          problem: 'the frame is not text',
          unreadable: true,
        },
      ]),
    );

    // Then, the two counters are exclusive and both reach the theme, and the entry says which.
    expect(socket.log.value.received).toBe(3);
    expect(socket.log.value.invalid).toBe(1);
    expect(socket.log.value.unreadable).toBe(1);
    expect(socket.log.value.entries[2]?.unreadable).toBe(true);
    expect(socket.log.value.entries[1]?.unreadable).toBeUndefined();
  });

  it('should report the counter as zero before any session is opened', async () => {
    // Given, the empty log a page holds before a connection, which is the other place the member
    // had to arrive or a consumer would read `undefined` on a page that has not connected.
    const state = createDocState({ document: securedEventsDocument() });
    const fake = fakePort();

    // When
    const socket = await withSocket(state, () => useSocket('channel-orders-created'), fake.port);

    // Then
    expect(socket.log.value.unreadable).toBe(0);
    expect(socket.log.value.invalid).toBe(0);
  });

  it('should keep the refusal sentence when the client refuses a credential no handshake carries', async () => {
    // Given, what the runner throws before it opens anything
    const state = createDocState({ document: securedEventsDocument() });
    const fake = fakePort(
      new RunnerError(
        "security scheme 'bearerAuth' holds a value that cannot reach a socket handshake",
        ErrorCode.RUN_AUTH_FAILED,
      ),
    );
    const socket = await withSocket(state, () => useSocket('channel-orders-created'), fake.port);

    // When
    const refusal = await socket
      .connect({
        address: 'wss://ws.example.com/orders',
        transport: 'native',
        credentials: { bearerAuth: 'a-token' },
      })
      .then(
        () => undefined,
        (cause: unknown) => cause,
      );

    // Then, the sentence reaches a theme and the error still reaches a caller
    expect((refusal as RunnerError).code).toBe(ErrorCode.RUN_AUTH_FAILED);
    expect(socket.message.value).toContain('bearerAuth');
    expect(socket.status.value).toBe('idle');
  });

  it('should send on the open session and mirror what that did to the log', async () => {
    // Given
    const state = createDocState({ document: securedEventsDocument() });
    const fake = fakePort();
    const socket = await withSocket(state, () => useSocket('channel-orders-created'), fake.port);
    await socket.connect({ address: 'wss://ws.example.com/orders', transport: 'native' });

    // When
    socket.send('{"subscribe":"orders.created"}');

    // Then
    expect(fake.session().sent).toEqual(['{"subscribe":"orders.created"}']);
  });

  it('should refuse a send with no session open rather than dropping the message', async () => {
    // Given
    const state = createDocState({ document: securedEventsDocument() });
    const fake = fakePort();
    const socket = await withSocket(state, () => useSocket('channel-orders-created'), fake.port);

    // When
    const send = (): void => {
      socket.send('too early');
    };

    // Then
    expect(send).toThrow(RunnerError);
    expect(send).toThrow('no socket session is open');
  });

  it('should close the previous session before opening another, so two are never live at once', async () => {
    // Given
    const state = createDocState({ document: securedEventsDocument() });
    const fake = fakePort();
    const socket = await withSocket(state, () => useSocket('channel-orders-created'), fake.port);
    await socket.connect({ address: 'wss://ws.example.com/orders', transport: 'native' });
    const first = fake.session();

    // When
    await socket.connect({ address: 'wss://ws.example.com/orders', transport: 'native' });

    // Then
    expect(first.closes).toBe(1);
    expect(fake.opened).toHaveLength(2);
  });

  it('should close nothing and throw nothing when there is no session to close', async () => {
    // Given
    const state = createDocState({ document: securedEventsDocument() });
    const fake = fakePort();
    const socket = await withSocket(state, () => useSocket('channel-orders-created'), fake.port);

    // When
    const close = (): void => {
      socket.close();
    };

    // Then
    expect(close).not.toThrow();
  });
});

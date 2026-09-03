/**
 * Socket.IO, through a factory the host hands over, never through a dependency of this package.
 *
 * WHY THE FACTORY IS AN ARGUMENT. `socket.io-client` is a runtime a host either already ships or
 * does not, and a bundled package that imported it would put a second copy of it in every page
 * that has a Socket.IO gateway and a hard dependency in every page that has not. So the shape is
 * the one `credentials.ts` uses for storage: the adapter names what it touches, and whoever
 * composes the runner hands in `io`.
 *
 * WHAT SPEC 14.7 SAYS THIS TRANSPORT ADDS is the `auth` payload, which is the reason it is here at
 * all: it is the one browser mechanism that carries a credential at connection time without a
 * request header. The query is carried too, because a proxy in front of a Socket.IO server sees
 * the query and not the payload.
 *
 * MESSAGES ARE ONE NAMED EVENT AND THAT IS A DECISION. Socket.IO's own model is an event name plus
 * arguments, and a console that listened to everything would need a vocabulary the document does
 * not give it: AsyncAPI names the messages of a channel, not the Socket.IO event they ride on. So
 * one event name is configured, defaulting to `message`, and a payload that is not text is
 * serialized once here rather than in three places downstream.
 */

import { RunnerError } from '@openref/core';
import type {
  ISocketTransport,
  SocketConnection,
  SocketHandshake,
  SocketTransportHandlers,
} from '../../application/ports/socket-transport.port';

/** The part of a Socket.IO client this adapter uses. */
export interface SocketIoLike {
  on(event: string, listener: (...args: readonly unknown[]) => void): unknown;
  emit(event: string, ...args: readonly unknown[]): unknown;
  disconnect(): unknown;
}

/** The browser supported options SPEC 14.7 admits, and nothing that only exists on a server. */
export interface SocketIoOptions {
  /** The `auth` payload, which is the mechanism this transport is chosen for. */
  readonly auth: Readonly<Record<string, string>>;
  /** Whether the client reconnects by itself. Always false: the session owns that budget. */
  readonly reconnection: boolean;
  /** Transports the client may use, in order. */
  readonly transports: readonly string[];
}

/** How a Socket.IO client is constructed, which is `io(url, options)`. */
export type SocketIoFactory = (url: string, options: SocketIoOptions) => SocketIoLike;

/** What this adapter is built with. */
export interface SocketIoTransportOptions {
  /** The `io` function, from whatever copy of `socket.io-client` the host already ships. */
  readonly create: SocketIoFactory;
  /** The event messages ride on, defaulting to {@link DEFAULT_SOCKET_IO_EVENT}. */
  readonly event?: string;
  /** Transports offered to the client, defaulting to {@link DEFAULT_SOCKET_IO_TRANSPORTS}. */
  readonly transports?: readonly string[];
}

/** The event name messages ride on when the host names none. */
export const DEFAULT_SOCKET_IO_EVENT = 'message';

/**
 * Transports offered by default.
 *
 * WEBSOCKET ONLY, AND THAT IS THE HONEST DEFAULT FOR THIS CONSOLE. Socket.IO's own default starts
 * on long polling and upgrades, which means a console showing a WebSocket page would be exercising
 * an HTTP transport for the first part of every session, and a reader reading the page would be
 * told something that was true of the protocol and not of what just happened.
 */
export const DEFAULT_SOCKET_IO_TRANSPORTS: readonly string[] = ['websocket'];

/** Opens Socket.IO connections. */
export class SocketIoTransport implements ISocketTransport {
  private readonly create: SocketIoFactory;
  private readonly event: string;
  private readonly transports: readonly string[];

  /**
   * @param options - The `io` function, and what messages ride on
   * @throws {RunnerError} When no `io` function was handed over, which a JavaScript caller and a
   *   host whose `socket.io-client` import resolved to nothing can both do
   */
  constructor(options: SocketIoTransportOptions) {
    this.create = requireFactory(options.create);
    this.event = options.event ?? DEFAULT_SOCKET_IO_EVENT;
    this.transports = options.transports ?? DEFAULT_SOCKET_IO_TRANSPORTS;
  }

  /**
   * @param handshake - The url with its query, and the `auth` payload
   * @param handlers - Where the connection reports what happens to it
   * @returns The connection
   * @throws {RunnerError} When the handshake was built for a native socket, so its credentials
   *   are in the address alone and the `auth` mechanism was never applied
   */
  open(handshake: SocketHandshake, handlers: SocketTransportHandlers): SocketConnection {
    if (handshake.kind !== 'socket.io') {
      throw new RunnerError(
        `this handshake was built for a ${handshake.kind} socket, so opening it over Socket.IO would send a different set of credentials than the one it was planned with`,
        'RUN_NOT_AVAILABLE',
        undefined,
        { kind: handshake.kind },
      );
    }

    const client = this.create(handshake.url, {
      auth: handshake.auth,
      // THE CLIENT'S OWN RECONNECTION IS OFF, ALWAYS. SPEC 14.7 gives the session a budget that
      // cannot be restored, and a client reconnecting underneath it would spend nothing from that
      // budget while looping exactly as hard as the budget exists to forbid.
      reconnection: false,
      transports: this.transports,
    });

    // ONE CLOSE PER OPEN, WHICH THIS CLIENT DOES NOT GIVE BY ITSELF. `connect_error` is not
    // followed by `disconnect`, so a failed handshake would leave the session waiting for a close
    // that never comes. The adapter reports the error and then the close, which is the contract
    // the port states and the state machine relies on.
    let closed = false;
    const finish = (code: number, reason: string, clean: boolean): void => {
      if (closed) return;

      closed = true;
      handlers.onClose({ code, reason, clean });
    };

    client.on('connect', () => {
      handlers.onOpen();
    });

    client.on('connect_error', (...args) => {
      const message = messageOf(args[0]);
      handlers.onError(message);
      finish(0, message, false);
    });

    client.on('disconnect', (...args) => {
      const reason = typeof args[0] === 'string' ? args[0] : '';
      // Socket.IO's own vocabulary: these two are the closing handshake, everything else is the
      // connection going away underneath it.
      const clean = reason === 'io client disconnect' || reason === 'io server disconnect';
      finish(clean ? 1000 : 1006, reason, clean);
    });

    client.on(this.event, (...args) => {
      handlers.onMessage(textOf(args[0]));
    });

    return {
      send: (data) => {
        client.emit(this.event, data);
      },
      close: () => {
        client.disconnect();
        // `disconnect()` emits `disconnect` with `io client disconnect`, and `finish` is idempotent,
        // so nothing here depends on which of the two arrives first.
        finish(1000, 'io client disconnect', true);
      },
    };
  }
}

/**
 * The `io` function, or a refusal that names what to hand in.
 *
 * WIDENED TO `unknown` ON THE WAY IN, the shape `storageFor` in `credentials.ts` uses. The declared
 * type says `create` is a function and a TypeScript caller cannot omit it, so a check written
 * against the declared type is one the compiler proves pointless and the linter refuses; the value
 * that actually arrives is whatever a JavaScript caller passed, or whatever a host's dynamic import
 * of `socket.io-client` resolved to, which is a real state and is not always a function.
 *
 * AT CONSTRUCTION, WHICH IS WHERE THE MISTAKE IS. Without this the first `open` died on
 * `this.create is not a function`, a bare `TypeError` with no code and no sentence, inside the one
 * slice built to end failures that explain nothing.
 *
 * @param create - Whatever the caller handed over
 * @returns The factory
 * @throws {RunnerError} When it is not a function
 */
function requireFactory(create: unknown): SocketIoFactory {
  if (typeof create !== 'function') {
    throw new RunnerError(
      'this Socket.IO transport was built with no io function; hand in the `io` export of the socket.io-client the host already ships',
      'RUN_NOT_AVAILABLE',
      undefined,
      { given: create === undefined ? 'nothing' : typeof create },
    );
  }

  return create as SocketIoFactory;
}

/**
 * One message as text, whatever shape the payload arrived in.
 *
 * THE THREE VALUES `JSON.stringify` ANSWERS `undefined` FOR ARE TAKEN OUT FIRST, and they are the
 * three no socket can carry anyway: an event emitted with no argument at all, and a function or a
 * symbol, which only a local double can produce. Its declared return type is `string`, so a
 * fallback after the call would be a branch the compiler proves unreachable and the linter refuses.
 */
function textOf(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (payload === undefined || typeof payload === 'function' || typeof payload === 'symbol') {
    return '';
  }

  try {
    return JSON.stringify(payload);
  } catch {
    // A payload with a cycle in it, which Socket.IO itself could not have sent but a local test
    // double can. Naming it beats a thrown error inside a message handler.
    return '[a payload that could not be read as text]';
  }
}

/** What a `connect_error` argument says, without trusting it to be an `Error`. */
function messageOf(cause: unknown): string {
  if (cause instanceof Error && cause.message !== '') return cause.message;
  if (typeof cause === 'string' && cause !== '') return cause;

  return 'the Socket.IO client refused the connection and said nothing about it';
}

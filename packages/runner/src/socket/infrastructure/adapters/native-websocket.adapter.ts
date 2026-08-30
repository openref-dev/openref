/**
 * The native `WebSocket`, said structurally, and the one thing it refuses to pretend about.
 *
 * SPEC 14.7 IN ONE ADAPTER. A native socket is handed a url and a subprotocol list. It is not
 * handed headers, because the constructor takes none and no browser exposes them; whatever cookies
 * the browser decides are in scope go with the handshake without this code seeing them, and the
 * `Origin` header is the browser's word about the page rather than the page's word about itself.
 *
 * AN `auth` PAYLOAD IS REFUSED RATHER THAN DROPPED. Socket.IO's `auth` has no native equivalent,
 * so an adapter handed one and connecting anyway would open an unauthenticated socket that the
 * reader believes carries their credential. That is the mysterious failure this whole slice exists
 * to prevent, one layer down from the handshake rule.
 *
 * STRUCTURAL, LIKE `KeyValueStorage` IN `credentials.ts` AND FOR THE SAME REASON: this package
 * compiles without the DOM lib, so it names the four handlers and two methods it touches instead
 * of depending on a global type, and a test satisfies it with a plain object.
 */

import { ErrorCode, RunnerError } from '@openref/core';
import type {
  ISocketTransport,
  SocketConnection,
  SocketHandshake,
  SocketTransportHandlers,
} from '../../application/ports/socket-transport.port';

/** The part of a browser `WebSocket` this adapter uses. */
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: ((event: WebSocketCloseLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** The part of a browser `CloseEvent` this adapter reads. */
export interface WebSocketCloseLike {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}

/** How a socket is constructed, which in a browser is `new WebSocket(url, protocols)`. */
export type WebSocketFactory = (url: string, protocols: readonly string[]) => WebSocketLike;

/** What this adapter is built with. */
export interface NativeWebSocketTransportOptions {
  /** The constructor, defaulting to the page's own `WebSocket`. */
  readonly create?: WebSocketFactory;
}

/**
 * The default factory: the page's own `WebSocket`, or a refusal naming its absence.
 *
 * A REFUSAL AND NOT A SILENT NO-OP, because a runtime with no `WebSocket` is a real state, on a
 * server render and in a test environment both, and a transport that returned a dead connection
 * there would leave a session in `connecting` for ever with nothing to read.
 */
function globalWebSocket(url: string, protocols: readonly string[]): WebSocketLike {
  const candidate = (globalThis as { WebSocket?: unknown }).WebSocket;

  if (typeof candidate !== 'function') {
    throw new RunnerError(
      'this runtime carries no WebSocket, so a native socket cannot be opened here',
      ErrorCode.RUN_NOT_AVAILABLE,
    );
  }

  const construct = candidate as new (url: string, protocols?: readonly string[]) => WebSocketLike;

  return protocols.length === 0 ? new construct(url) : new construct(url, protocols);
}

/** Opens native `WebSocket` connections. */
export class NativeWebSocketTransport implements ISocketTransport {
  private readonly create: WebSocketFactory;

  /**
   * @param options - The constructor to use, defaulting to the page's own
   */
  constructor(options: NativeWebSocketTransportOptions = {}) {
    this.create = options.create ?? globalWebSocket;
  }

  /**
   * @param handshake - The url, the subprotocols, and an `auth` payload this transport refuses
   * @param handlers - Where the connection reports what happens to it
   * @returns The connection
   * @throws {RunnerError} When the handshake carries an `auth` payload, which no native socket
   *   can send
   */
  open(handshake: SocketHandshake, handlers: SocketTransportHandlers): SocketConnection {
    const carried = Object.keys(handshake.auth);
    if (carried.length > 0) {
      throw new RunnerError(
        `a native WebSocket cannot send an auth payload, and this handshake carries ${carried.join(', ')}; open it over Socket.IO or through the server bridge`,
        ErrorCode.RUN_NOT_AVAILABLE,
        undefined,
        { fields: carried },
      );
    }

    const socket = this.create(handshake.url, handshake.protocols);
    // ONE CLOSE PER OPEN IS THE PORT'S CONTRACT, and a browser honours it: `onerror` is always
    // followed by `onclose`, with code 1006 and no reason on a handshake that never completed.
    let closed = false;

    socket.onopen = (): void => {
      handlers.onOpen();
    };

    socket.onmessage = (event): void => {
      // TEXT ONLY, PER SPEC 14.7. A binary frame arrives as a Blob or an ArrayBuffer, neither of
      // which this package can read without the DOM lib and neither of which the log can show, so
      // it is reported as what it is rather than stringified into `[object Blob]`.
      handlers.onMessage(
        typeof event.data === 'string'
          ? event.data
          : '[a binary frame, which this console does not read]',
      );
    };

    socket.onerror = (): void => {
      // The event carries nothing a page is allowed to read, by design of the platform: a socket
      // error is deliberately opaque so that a page cannot probe the network with it.
      handlers.onError('the browser reported a socket error and said nothing about it');
    };

    socket.onclose = (event): void => {
      if (closed) return;

      closed = true;
      handlers.onClose({ code: event.code, reason: event.reason, clean: event.wasClean });
    };

    return {
      send: (data) => {
        socket.send(data);
      },
      close: () => {
        socket.close();
      },
    };
  }
}

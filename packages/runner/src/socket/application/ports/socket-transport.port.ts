/**
 * What opens a socket, said as the two transports of SPEC 14.7 can both satisfy it.
 *
 * A THIRD PORT AND NOT A FLAG ON EITHER OF THE OTHER TWO, the reasoning `IStreamTransport` records
 * one level up. `IHttpTransport.send` returns a whole body and `IStreamTransport.open` returns
 * chunks that end; a socket has no body, no end anybody promised, and traffic in both directions.
 * They differ in what they return, so they are separate ports, and a transport may implement any
 * one of the three.
 *
 * THE HANDSHAKE IS DATA AND THE ADAPTER IS THE ONE THAT KNOWS WHAT IT CAN USE. `SocketHandshake`
 * carries everything either transport can carry at open time, and each adapter refuses the members
 * it cannot honour rather than dropping them: a native `WebSocket` handed an `auth` payload has to
 * say so, because silently connecting without it is a connection the reader believes is
 * authenticated and is not.
 */

/** How a socket is opened, per SPEC 14.7. */
export type SocketTransportKind = 'native' | 'socket.io';

/** Everything a transport is given at open time, already placed where that transport can use it. */
export interface SocketHandshake {
  readonly kind: SocketTransportKind;
  /** The address with its query string already built, which is the one place a native socket has. */
  readonly url: string;
  /** `Sec-WebSocket-Protocol` values, the one header a browser lets a page influence. */
  readonly protocols: readonly string[];
  /**
   * The Socket.IO `auth` payload. Empty for a native socket, and a native adapter refuses a
   * non-empty one rather than connecting without it.
   */
  readonly auth: Readonly<Record<string, string>>;
}

/** Why a socket closed, as the transport reports it. */
export interface SocketCloseInfo {
  readonly code: number;
  readonly reason: string;
  /** Whether the close followed the protocol's own closing handshake. */
  readonly clean: boolean;
}

/** What a transport tells the client while a connection is up. */
export interface SocketTransportHandlers {
  readonly onOpen: () => void;
  /** One message, already decoded to text. Binary frames are not read, per SPEC 14.7. */
  readonly onMessage: (data: string) => void;
  readonly onClose: (info: SocketCloseInfo) => void;
  /**
   * A transport level failure with no close frame behind it.
   *
   * SEPARATE FROM `onClose` BECAUSE A BROWSER SOCKET REPORTS BOTH AND MEANS DIFFERENT THINGS. An
   * error with no close is a handshake that never completed, which is what a refusing server
   * produces, and the client counts that against its attempt budget differently from a server
   * that accepted and then said goodbye.
   */
  readonly onError: (message: string) => void;
}

/** A connection that is open, or about to be. */
export interface SocketConnection {
  /** Sends one text frame. */
  send(data: string): void;
  /** Closes from this side. Calling it twice is not an error. */
  close(): void;
}

/** Opens sockets. */
export interface ISocketTransport {
  /**
   * @param handshake - Everything this transport is allowed to carry at open time
   * @param handlers - Where the connection reports what happens to it
   * @returns The connection
   */
  open(handshake: SocketHandshake, handlers: SocketTransportHandlers): SocketConnection;
}

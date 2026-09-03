/**
 * The socket engine of SPEC 14.7 on its own entry, so a chunk that opens a socket is not a chunk
 * that sends a request.
 *
 * WHY IT EXISTS IS A MEASUREMENT AND IT IS THE `@openref/vue/runner` PRECEDENT EXACTLY. `T031`
 * took 962 bytes out of the first paint by moving `useRunner` off the barrel the renderer imports
 * onto a second entry, for the same mechanism this file answers: a bundler splits on modules, and
 * a barrel is one module. `TX-SOCKET-CONSOLE` measured the other side of it. The console's factory
 * and the request runner's factory are two dynamic entry points of the served bundle, and while
 * both imported this package's barrel, esbuild put the whole barrel in a chunk they shared: a
 * reader who pressed Send downloaded the socket engine, and `client-js-send-raw` read 74,366
 * against a cap of 73,200. Measured by building the tree twice, with the barrel and with this
 * entry.
 *
 * SO THE SPLIT IS BY WHAT A READER DOES, which is the same division `CLIENT_JS_GESTURES` makes one
 * level up. Pressing Send downloads the request engine; reaching into a channel's console
 * downloads this. Neither downloads the other.
 *
 * THE BARREL STILL EXPORTS EVERY NAME BELOW AND THAT IS NOT A DUPLICATE SURFACE. `./socket` is a
 * second door onto the same modules, for a consumer whose bundler needs the smaller one; a
 * consumer importing `@openref/runner` gets what it always got, and the pair is held equal by
 * `packages/runner/test/unit/entry-parity.spec.ts` rather than by anybody remembering.
 */

export type {
  ISocketTransport,
  SocketCloseInfo,
  SocketConnection,
  SocketHandshake,
  SocketTransportHandlers,
  SocketTransportKind,
} from './socket/application/ports/socket-transport.port';

export { buildHandshake, type SocketHandshakeInput } from './socket/domain/handshake';

export {
  checkSocketMessage,
  type NamedMessageSchema,
  type SocketMessageVerdict,
} from './socket/domain/message-check';

export {
  createSocketLog,
  DEFAULT_SOCKET_LOG_BYTES,
  DEFAULT_SOCKET_LOG_WINDOW,
  type SocketLog,
  type SocketLogEntry,
  type SocketLogState,
  type SocketMessageDirection,
} from './socket/domain/message-log';

export {
  createSocketClient,
  DEFAULT_SOCKET_RECONNECT_ATTEMPTS,
  DEFAULT_SOCKET_RECONNECT_DELAY_MS,
  openSocket,
  SOCKET_BACKOFF_CEILING,
  type SocketClient,
  type SocketSession,
  type SocketSessionContext,
  type SocketSessionHandlers,
  type SocketSessionOptions,
  type SocketSessionState,
  type SocketStatus,
} from './socket/application/services/socket.service';

export {
  NativeWebSocketTransport,
  type NativeWebSocketTransportOptions,
  type WebSocketCloseLike,
  type WebSocketFactory,
  type WebSocketLike,
} from './socket/infrastructure/adapters/native-websocket.adapter';

export {
  DEFAULT_SOCKET_IO_EVENT,
  DEFAULT_SOCKET_IO_TRANSPORTS,
  SocketIoTransport,
  type SocketIoFactory,
  type SocketIoLike,
  type SocketIoOptions,
  type SocketIoTransportOptions,
} from './socket/infrastructure/adapters/socket-io.adapter';

/**
 * The socket client, in the chunk the socket console loads and in no other.
 *
 * WHY IT IS A MODULE OF ITS OWN, the `runner-factory` reason exactly. `@openref/render` may not
 * see `@openref/runner`, STANDARDS 3.5, so the console reaches the engine through `ISocketPort`,
 * declared in `@openref/vue` and satisfied structurally, and somebody who can see both packages
 * has to put the two together. `@openref/nest` is the first package that can. Written inline in
 * `compose.ts` the construction would sit in the first paint chunk of every page, for a console
 * only a channel page has and only a reader who reaches into it opens.
 *
 * THE TRANSPORT IS THE NATIVE ONE AND THE OTHER IS NOT REACHED FROM HERE, which is a fact about
 * what a page can carry rather than a preference. `SocketIoTransport` takes a factory for a
 * Socket.IO client, and this module cannot supply one: the client is a third party package, and a
 * reference that pulled it into its own bundle would ship a dependency for a protocol most
 * documents do not declare. A host that serves Socket.IO channels composes its own port over the
 * same engine and hands it to `hydrateReference`, which is what the seam is for.
 *
 * IT IMPORTS `@openref/runner/socket` AND NOT THE BARREL, AND THAT IS A MEASUREMENT. A bundler
 * splits on modules and a barrel is one module, so while this file and `runner-factory.ts` both
 * imported `@openref/runner`, esbuild put the whole barrel in a chunk they shared and a reader who
 * pressed Send downloaded the socket engine: `client-js-send-raw` read 74,366 against a cap of
 * 73,200. The second entry is the `@openref/vue/runner` precedent applied one package down.
 *
 * SPEC 14.7'S REFUSAL IS THE ENGINE'S AND NOT THIS FILE'S. A credential given to a scheme a
 * browser cannot present at a handshake is refused by `buildHandshake` before a socket is opened;
 * nothing here repeats that rule, so the page and the engine cannot come to disagree about which
 * schemes a browser can carry.
 */

import { createSocketClient, NativeWebSocketTransport } from '@openref/runner/socket';
import type { SocketClient } from '@openref/runner/socket';

/**
 * Builds the socket client the console on a channel page connects through.
 *
 * The return type is the engine's own `SocketClient` rather than `ISocketPort`, which is
 * `createPageRunner`'s decision for `createPageRunner`'s reason: the port is declared in
 * `@openref/vue`, which is not among this package's upstreams, and the client satisfies it
 * structurally, which is the whole way the port works.
 *
 * @returns The port, over the browser's own `WebSocket`
 */
export function createPageSocket(): SocketClient {
  // THE ASSIGNMENT IS THE CONFORMANCE AND IT IS PINNED ELSEWHERE. `createSocketClient` returns a
  // `SocketClient`, which satisfies `ISocketPort` structurally; `socket-port-conformance.spec.ts`
  // holds both directions, so a new required option on the engine fails to compile rather than
  // failing to be noticed.
  return createSocketClient({ transport: new NativeWebSocketTransport() });
}

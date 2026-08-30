/**
 * How a socket client reaches a component: `provide` and `inject`, as the runner does.
 *
 * Provided rather than imported, for the runner's own reason and one more. A reference built to
 * static files has nothing to open a socket from; a reference of an HTTP only API has no channel
 * to open one to; and the transport a host has, native or Socket.IO, is a fact about their
 * deployment rather than about this package. `useSocket` reports the absence as `available: false`
 * rather than as an error, so a theme draws a disabled control instead of one that throws.
 */

import { inject, provide } from 'vue';
import type { InjectionKey } from 'vue';
import type { ISocketPort } from '../application/ports/socket.port';

/** Key a socket client is provided under. */
export const SOCKET_KEY: InjectionKey<ISocketPort> = Symbol('openref.socket');

/**
 * Makes a socket client available to everything below this component.
 *
 * @param socket - Anything satisfying the port
 *
 * @example
 * setup() { provideSocket(createSocketClient({ transport })); }
 */
export function provideSocket(socket: ISocketPort): void {
  provide(SOCKET_KEY, socket);
}

/**
 * The socket client provided above this component, if there is one.
 *
 * @returns The client, or undefined when this build carries none
 *
 * @example
 * const socket = useSocketPort();
 */
export function useSocketPort(): ISocketPort | undefined {
  return inject(SOCKET_KEY, undefined);
}

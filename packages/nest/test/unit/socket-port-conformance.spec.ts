import { describe, expect, expectTypeOf, it } from 'vitest';
import { createSocketClient } from '@openref/runner';
import type {
  ISocketTransport,
  SocketConnection,
  SocketSession,
  SocketSessionOptions,
  SocketTransportHandlers,
} from '@openref/runner';
import type { ISocketPort, SocketOpenInput, SocketSessionView } from '@openref/vue';

/**
 * The socket client of `@openref/runner` really does satisfy `ISocketPort` of `@openref/vue`.
 *
 * WHY THE CLAIM NEEDED A PIN. `socket.service.ts` says the client satisfies the port structurally,
 * and until this file nothing held it to that: the two packages cannot see each other by the
 * dependency rule, the reference composes no socket client, and so a rename on either side or a
 * new required option on the runner would have shipped green with a comment claiming otherwise.
 * The runner's own port has a production site that does this work by accident, `browser/entry.ts`
 * handing `createPageRunner` to a `loadRunner` typed `() => Promise<IRunnerPort>`; this one has
 * none, so the pin is written down instead of hoped for.
 *
 * IT IS IN THIS PACKAGE BECAUSE THIS IS THE ONLY PLACE BOTH ARE VISIBLE. `nest` may reach `runner`
 * and reaches `vue` through `render`; the boundary rules scope `packages/<pkg>/src/`, so a test may
 * name both directly, which `federated-credentials.spec.ts` already does. `pnpm lint` typechecks
 * the test tree, so an incompatibility here fails to compile rather than failing to be noticed.
 *
 * BOTH DIRECTIONS ARE ASSERTED, because one of them is not enough. A method's parameters are
 * compared bivariantly, so an assignment alone would let a new required member on
 * `SocketSessionOptions` through; the input assertion is the one that catches it, and the session
 * assertion catches the runner returning less than the port promises.
 */

/** A transport that opens nothing, so the conformance is about types rather than about sockets. */
const transport: ISocketTransport = {
  open: (_handshake, handlers: SocketTransportHandlers): SocketConnection => {
    handlers.onOpen();

    return { send: () => undefined, close: () => undefined };
  },
};

describe('the socket client and the published socket port', () => {
  it('should be assignable to the port a theme is handed, which is what provideSocket takes', () => {
    // Given, the assignment is the assertion: it is checked when this file is typechecked
    const port: ISocketPort = createSocketClient({ transport });

    // When, and the body runs so this is not a case that only compiles
    const session = port.open({ address: 'wss://example.test/events', transport: 'native' }, {});

    // Then
    expect(session.state().status).toBe('open');
    expect(typeof session.send).toBe('function');
    expect(typeof session.close).toBe('function');
  });

  it('should accept everything the published input carries, so a new required option cannot ship quietly', () => {
    // Given the direction an assignment cannot see, because method parameters are bivariant

    // Then a caller holding only what `@openref/vue` publishes can always call the runner
    expectTypeOf<SocketOpenInput>().toExtend<SocketSessionOptions>();
  });

  it('should return everything the published session promises', () => {
    // Given the other direction: a theme reads `state`, `send`, `close` and `closed` off what the
    // port returned, and the runner is what returns it

    // Then
    expectTypeOf<SocketSession>().toExtend<SocketSessionView>();
  });
});

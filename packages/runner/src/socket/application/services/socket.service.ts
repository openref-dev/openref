/**
 * One socket session: the handshake, the log, and a reconnection budget that cannot run away.
 *
 * THE REFUSAL COMES BEFORE THE TRANSPORT, which is the whole of SPEC 14.7's second half. A value
 * for a scheme a browser cannot present at a handshake is refused by `buildHandshake` while this
 * function is still on its first line, so no socket is opened, nothing broken is put on the wire,
 * and the reader is told which scheme and why. A client that connected and let the server refuse
 * would be teaching the reader that their credential is wrong when the truth is that the browser
 * never sent it.
 *
 * THE RECONNECTION BUDGET IS PER CALL AND IS NEVER RESTORED. The obvious design resets the counter
 * when a connection opens, and the obvious design loops forever against a server that accepts and
 * immediately closes, which is the exact failure this has to be bounded against. So the budget
 * belongs to the `openSocket` call: when it is spent the session is `refused`, every timer is
 * cleared, and a reader who wants more opens another session. A provable bound was chosen over a
 * convenience, and SPEC 14.7 records that as a decision rather than as an implementation detail.
 *
 * THE STATE MACHINE IS DRIVEN BY CLOSES AND NOT BY ERRORS. A browser socket reports both, and a
 * transport level error with no close behind it is a handshake that never completed. The message
 * is kept so the reader gets the sentence, and the close is what moves the session, which is why
 * the port requires every open to end in exactly one close.
 */

import { ErrorCode, RunnerError } from '@openref/core';
import { buildHandshake } from '../../domain/handshake';
import { checkSocketMessage, type NamedMessageSchema } from '../../domain/message-check';
import {
  createSocketLog,
  DEFAULT_SOCKET_LOG_BYTES,
  DEFAULT_SOCKET_LOG_WINDOW,
  type SocketLogEntry,
  type SocketLogState,
} from '../../domain/message-log';
import type { RunnableSecurityScheme } from '../../../request/domain/request-plan';
import type {
  ISocketTransport,
  SocketConnection,
  SocketTransportKind,
} from '../ports/socket-transport.port';

/** Reconnections one session is allowed, per SPEC 14.7. */
export const DEFAULT_SOCKET_RECONNECT_ATTEMPTS = 3;

/** Delay before the first reconnection, doubled each time up to the ceiling. */
export const DEFAULT_SOCKET_RECONNECT_DELAY_MS = 1_000;

/** Highest multiple of the base delay the backoff reaches, the ceiling SPEC 15.2 also uses. */
export const SOCKET_BACKOFF_CEILING = 8;

/**
 * Where a session is.
 *
 * `closed` AND `refused` ARE BOTH TERMINAL AND ARE NOT ONE STATE. `closed` is a session that ended
 * the way somebody asked it to; `refused` is a session that spent its whole budget without the
 * server keeping a connection up. A reader acts differently on each, so the console can too.
 */
export type SocketStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'refused';

/** What a session is made of. */
export interface SocketSessionOptions {
  /** The socket address, `ws://` or `wss://`. */
  readonly address: string;
  readonly transport: SocketTransportKind;
  /** Schemes the channel requires, resolved against the document's table. */
  readonly schemes?: readonly RunnableSecurityScheme[];
  /** What the reader supplied, keyed by scheme id. */
  readonly credentials?: Readonly<Record<string, string>>;
  readonly protocols?: readonly string[];
  readonly query?: readonly (readonly [string, string])[];
  /** The messages the channel declares, which is what a received message is checked against. */
  readonly messages?: readonly NamedMessageSchema[];
  /** Log window, defaulting to {@link DEFAULT_SOCKET_LOG_WINDOW}. */
  readonly windowSize?: number;
  /**
   * Payload bytes the log holds, defaulting to {@link DEFAULT_SOCKET_LOG_BYTES}.
   *
   * THE SECOND CEILING, ADDED AT `T062` BECAUSE THE FIRST ONE ALONE BOUNDS NOTHING. A window of
   * entries times an unbounded frame size is an unbounded log, measured at 500 entries and 500.0
   * MB from 600 frames of a megabyte.
   */
  readonly maxBufferedBytes?: number;
  /** Reconnections allowed, defaulting to {@link DEFAULT_SOCKET_RECONNECT_ATTEMPTS}. */
  readonly maxReconnectAttempts?: number;
  /** Base reconnection delay, defaulting to {@link DEFAULT_SOCKET_RECONNECT_DELAY_MS}. */
  readonly reconnectDelayMs?: number;
}

/** What a session reports to whoever draws it. */
export interface SocketSessionState {
  readonly status: SocketStatus;
  readonly log: SocketLogState;
  /** How many times a connection was opened, the first one included. */
  readonly attempts: number;
  /** Why the session is where it is, when there is anything to say. */
  readonly message?: string;
}

/**
 * Where a session reports what happens to it.
 *
 * ONE CALLBACK, AND THE SECOND WAS REMOVED RATHER THAN LEFT DECLARED. `onEntry` handed the caller
 * each message as it was filed, and every consumer of it could read the same message off the state
 * published in the same breath, as the last entry of the window. Two ways to observe one event is a
 * second home for one idea, and the vue port that restates this interface never filled it at all.
 */
export interface SocketSessionHandlers {
  readonly onState?: (state: SocketSessionState) => void;
}

/** What a session is run against. */
export interface SocketSessionContext {
  readonly transport: ISocketTransport;
  /** Injected so a test can drive the backoff without waiting for it, per `runStream`. */
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

/** A running session. */
export interface SocketSession {
  state(): SocketSessionState;
  /**
   * Sends one message.
   *
   * @param data - The message, as text
   * @throws {RunnerError} When the session is not open
   */
  send(data: string): void;
  /** Closes the session. Calling it twice does nothing the first call did not do. */
  close(): void;
  /** Resolves once, when the session reaches a terminal state. */
  readonly closed: Promise<SocketSessionState>;
}

/** A socket client: a transport with its defaults bound, opening one session per call. */
export interface SocketClient {
  open(options: SocketSessionOptions, handlers: SocketSessionHandlers): SocketSession;
}

/**
 * Binds a transport and its defaults into the client a page is handed.
 *
 * THIS IS THE COMPOSITION POINT AND IT IS NOT ON `RequestRunner`. A socket is not a request, so
 * the two do not share a session, a credential path or a lifetime; and putting it on the runner
 * would put every byte of this slice into the chunk a press of Send downloads, for a console that
 * does not open sockets. It satisfies `ISocketPort` of `@openref/vue` structurally, which is how
 * that port works and the reason neither package imports the other.
 *
 * THE DEFAULTS ARE THE HOST'S AND THE ADDRESS IS THE READER'S. A window size and an attempt budget
 * are deployment decisions, made once where the client is composed; the address, the schemes and
 * the credentials belong to the session being opened and arrive per call.
 *
 * @param context - The transport and, for a test, the timers
 * @param defaults - Window size, attempt budget and base delay, for every session this opens
 * @returns The client
 *
 * @example
 * const socket = createSocketClient({ transport: new NativeWebSocketTransport() });
 */
export function createSocketClient(
  context: SocketSessionContext,
  defaults: Pick<
    SocketSessionOptions,
    'windowSize' | 'maxBufferedBytes' | 'maxReconnectAttempts' | 'reconnectDelayMs'
  > = {},
): SocketClient {
  return {
    open: (options, handlers) => openSocket({ ...defaults, ...options }, handlers, context),
  };
}

/**
 * Opens a socket session.
 *
 * @param options - The address, the transport, the schemes and the credentials
 * @param handlers - Where the session reports its state and its messages
 * @param context - The transport and, for a test, the timers
 * @returns The session
 * @throws {AuthError} When the reader supplied a value no handshake can carry, before any socket
 *   is opened
 *
 * @example
 * const session = openSocket({ address, transport: 'native' }, {}, { transport });
 */
export function openSocket(
  options: SocketSessionOptions,
  handlers: SocketSessionHandlers,
  context: SocketSessionContext,
): SocketSession {
  // FIRST, AND BEFORE ANYTHING TOUCHES THE TRANSPORT. A throw here leaves no connection, no timer
  // and no session, which is what "surfaces the limitation rather than sending a broken request"
  // means when it is written as code.
  const handshake = buildHandshake({
    address: options.address,
    transport: options.transport,
    schemes: options.schemes ?? [],
    credentials: options.credentials ?? {},
    ...(options.protocols === undefined ? {} : { protocols: options.protocols }),
    ...(options.query === undefined ? {} : { query: options.query }),
  });

  const messages = options.messages ?? [];
  const log = createSocketLog(
    options.windowSize ?? DEFAULT_SOCKET_LOG_WINDOW,
    options.maxBufferedBytes ?? DEFAULT_SOCKET_LOG_BYTES,
  );
  const budget = Math.max(0, options.maxReconnectAttempts ?? DEFAULT_SOCKET_RECONNECT_ATTEMPTS);
  const baseDelay = Math.max(0, options.reconnectDelayMs ?? DEFAULT_SOCKET_RECONNECT_DELAY_MS);

  const setTimer =
    context.setTimer ?? ((callback: () => void, ms: number): unknown => setTimeout(callback, ms));
  const clearTimer =
    context.clearTimer ??
    ((handle: unknown): void => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    });

  // A HOLDER RATHER THAN LOOSE BINDINGS, the `runStream` finding: control flow analysis does not
  // follow an assignment made inside a transport callback, so reads in a later closure would
  // narrow to the initial value and whole branches would compile as unreachable.
  const session = {
    status: 'idle' as SocketStatus,
    attempts: 0,
    reconnects: 0,
    opened: 0,
    message: undefined as string | undefined,
    lastError: undefined as string | undefined,
    connection: undefined as SocketConnection | undefined,
    timer: undefined as unknown,
    stopped: false,
    settled: false,
  };

  let settle: ((state: SocketSessionState) => void) | null = null;
  const closed = new Promise<SocketSessionState>((resolve) => {
    settle = resolve;
  });

  function stateOf(): SocketSessionState {
    return {
      status: session.status,
      log: log.state(),
      attempts: session.attempts,
      ...(session.message === undefined ? {} : { message: session.message }),
    };
  }

  function publish(): void {
    handlers.onState?.(stateOf());
  }

  function finish(status: 'closed' | 'refused', message?: string): void {
    if (session.settled) return;

    session.settled = true;
    session.status = status;
    session.message = message;
    session.connection = undefined;

    if (session.timer !== undefined) {
      clearTimer(session.timer);
      session.timer = undefined;
    }

    publish();
    settle?.(stateOf());
  }

  /**
   * Files one message and publishes the state that now carries it.
   *
   * THE APPEND IS A STATEMENT AND NEVER AN ARGUMENT TO AN OPTIONAL CALL, which is a defect this
   * suite caught rather than a style. The first form of this function was
   * `handlers.onEntry?.(log.append(entry))`, and optional call syntax does not evaluate what it is
   * passed: with no listener the whole expression short circuited, so a session composed without
   * one logged nothing at all while reporting a status of `open`. `onEntry` has since gone, and
   * the shape is written down here because the next value computed inside an optional call will
   * disappear the same way.
   */
  function record(entry: Omit<SocketLogEntry, 'seq'>): void {
    log.append(entry);
    publish();
  }

  /**
   * Checks and files one message, in either direction.
   *
   * BOTH DIRECTIONS GO THROUGH THE SAME CHECK, because the messages a channel declares are the
   * messages of that channel and not only the ones it sends back. A reader typing a payload that
   * matches nothing the document declares has learned something worth marking.
   */
  function file(direction: SocketLogEntry['direction'], data: string): void {
    const verdict = checkSocketMessage(data, messages);

    record({
      direction,
      data,
      ...(verdict.matched === undefined ? {} : { matched: verdict.matched }),
      ...(verdict.problem === undefined ? {} : { problem: verdict.problem }),
    });
  }

  /**
   * What a spent budget says, and it is two sentences because two things happen.
   *
   * A SERVER THAT NEVER COMPLETES A HANDSHAKE AND A SERVER THAT ANSWERS AND HANGS UP ARE NOT THE
   * SAME EVENT, and the first wording covered both. A blind review probed a server that opened,
   * delivered and closed cleanly with 1000 on every attempt and read back "No connection was kept",
   * which is false of a session that had two of them and read messages on both. The bound is the
   * same either way; what a reader is told about why it ended is not.
   *
   * @returns The sentence for the ending this session actually had
   */
  function spentSentence(): string {
    const attempts = String(session.attempts);

    if (session.opened === 0) {
      return `No connection was kept after ${attempts} attempts, so the session gave up.`;
    }

    const received = log.state().received;

    return (
      `The server closed each of the ${attempts} connections this session opened, ` +
      `which delivered ${String(received)} message${received === 1 ? '' : 's'} in all, ` +
      'so the budget is spent.'
    );
  }

  function attempt(): void {
    session.attempts += 1;
    session.status = session.attempts === 1 ? 'connecting' : 'reconnecting';
    session.message = undefined;
    publish();

    session.connection = context.transport.open(handshake, {
      onOpen: () => {
        if (session.settled) return;

        session.opened += 1;
        session.status = 'open';
        session.lastError = undefined;
        publish();
      },

      onMessage: (data) => {
        if (session.settled) return;

        file('received', data);
      },

      // A FRAME NOBODY READ NEVER MEETS THE VALIDATOR, per SPEC 14.7 as `T059` wrote it. It is
      // filed with the transport's own reason and counted apart, because "read and matched nothing"
      // and "not read at all" are two facts and only one of them is about the document.
      onUnreadableFrame: (description) => {
        if (session.settled) return;

        record({
          direction: 'received',
          data: description,
          problem: description,
          unreadable: true,
        });
      },

      // A VALIDATION FAILURE NEVER REACHES HERE, which is the point of `file`: it marks the entry
      // and returns, so a session goes on delivering after a message nothing declared.
      onError: (message) => {
        session.lastError = message;
      },

      onClose: (info) => {
        if (session.settled) return;

        session.connection = undefined;

        if (session.stopped) {
          finish('closed', 'the session was closed from this page');
          return;
        }

        const reason = closeSentence(info.code, info.reason, info.clean, session.lastError);

        if (session.reconnects >= budget) {
          finish('refused', budget === 0 ? reason : `${reason} ${spentSentence()}`);
          return;
        }

        session.reconnects += 1;
        session.status = 'reconnecting';
        session.message = reason;
        publish();

        session.timer = setTimer(
          () => {
            session.timer = undefined;
            if (!session.settled && !session.stopped) attempt();
          },
          backoffDelay(baseDelay, session.reconnects),
        );
      },
    });
  }

  attempt();

  return {
    state: stateOf,

    send: (data) => {
      if (session.status !== 'open' || session.connection === undefined) {
        throw new RunnerError(
          `the socket is ${session.status} rather than open, so nothing can be sent on it`,
          ErrorCode.RUN_NOT_AVAILABLE,
          undefined,
          { status: session.status },
        );
      }

      session.connection.send(data);
      file('sent', data);
    },

    close: () => {
      if (session.settled) return;

      session.stopped = true;

      if (session.timer !== undefined) {
        clearTimer(session.timer);
        session.timer = undefined;
      }

      // A CONNECTION THAT IS UP IS ASKED TO CLOSE AND THE CLOSE IS AWAITED, because the transport
      // owes exactly one close per open and the session ends on it. A session waiting on a
      // backoff timer has no connection to ask, so it ends here.
      const live = session.connection;
      if (live === undefined) {
        finish('closed', 'the session was closed from this page');
        return;
      }

      live.close();
    },

    closed,
  };
}

/**
 * How long to wait before the nth reconnection.
 *
 * DETERMINISTIC AND WITHOUT JITTER, the rule the federated remote lifecycle of SPEC 15.2 already
 * follows: 1x, 2x, 4x of the base with a ceiling of 8x. Jitter would make the one property this
 * has to prove, that the whole sequence is bounded, unprovable by a test.
 */
function backoffDelay(base: number, reconnect: number): number {
  return base * Math.min(2 ** Math.max(0, reconnect - 1), SOCKET_BACKOFF_CEILING);
}

/** What a reader is told about a close the page did not ask for. */
function closeSentence(
  code: number,
  reason: string,
  clean: boolean,
  lastError: string | undefined,
): string {
  const said = reason === '' ? '' : `: ${reason}`;

  if (!clean && code === 0) {
    // The browser's own shape for a handshake that never completed: no close frame, so no code
    // and no reason, and whatever the error handler was told is the only thing there is to say.
    return lastError === undefined
      ? 'The connection failed before the socket opened.'
      : `The connection failed before the socket opened: ${lastError}`;
  }

  return clean
    ? `The server closed the socket with code ${String(code)}${said}.`
    : `The socket closed without a closing handshake, code ${String(code)}${said}.`;
}

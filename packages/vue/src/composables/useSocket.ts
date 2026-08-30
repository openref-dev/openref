import { ErrorCode, handshakeBlockedCause, RunnerError } from '@openref/core';
import { computed, ref, shallowRef } from 'vue';
import type { IRSecurityRequirement, IRSecurityScheme } from '@openref/core';
import type { ComputedRef, MaybeRefOrGetter } from 'vue';
import { useSocketPort } from '../socket/api/context';
import { useDocState } from '../state/api/context';
import { useNode } from './useNode';
import type {
  SocketHandshakeBlockView,
  SocketLogStateView,
  SocketNamedMessageView,
  SocketSecuritySchemeView,
  SocketSessionStateView,
  SocketSessionView,
  SocketStatusView,
  SocketTransportKindView,
} from '../socket/application/ports/socket.port';

/**
 * The interactive event client of SPEC 14.7, built at `T055` and declared since `T008`.
 *
 * TWO HALVES, AND ONLY ONE OF THEM NEEDS A PORT. `blocked` reads the channel's own security out of
 * the document and answers what a browser cannot present at a socket handshake, so it is true on
 * a page with no socket client at all and it is true before anybody presses anything. That is what
 * SPEC 14.7 requires of the statement: the reader meets the limitation named, with the route
 * beside it, rather than a connection that fails for a reason nothing on the page explains. The
 * other half, `connect`, `send` and `close`, needs a client and reports `available: false` without
 * one, exactly as `useRunner` does.
 *
 * THE STATE IS THE SESSION'S AND IS MIRRORED, NOT REBUILT. The session owns the bounded log of
 * SPEC 14.7, and this composable holds the last state it published. Recomputing entries here would
 * be a second copy of a five hundred entry window, and a second place for the counters to
 * disagree with the first.
 *
 * WHAT IS DELIBERATELY NOT HERE IS ANY CREDENTIAL STORAGE. What the reader typed is passed through
 * to the port on the call that uses it, per SPEC 14.4, and never held in a ref that a server
 * rendered page would serialize.
 */
export interface UseSocket {
  readonly id: ComputedRef<string | undefined>;
  /** Whether a socket client was provided above this component and this node is a channel. */
  readonly available: ComputedRef<boolean>;
  /**
   * Schemes this channel requires that a browser cannot present at a handshake, per SPEC 14.7.
   *
   * ANSWERED FROM THE DOCUMENT AND NOT FROM AN ATTEMPT, so it is a fact about the channel rather
   * than about one reader's credentials, and it is available with no client and no connection.
   */
  readonly blocked: ComputedRef<readonly SocketHandshakeBlockView[]>;
  readonly status: ComputedRef<SocketStatusView>;
  /** The log window and its counters, empty until a session has been opened. */
  readonly log: ComputedRef<SocketLogStateView>;
  /** Why the session is where it is, or why the last attempt to open one failed. */
  readonly message: ComputedRef<string | undefined>;

  /**
   * Opens the connection.
   *
   * @param args - The address, the transport, and what the reader supplied
   * @returns Nothing, once the session has been opened
   * @throws {RunnerError} When no socket client was provided, or the node is not a channel
   */
  connect(args: UseSocketConnectArgs): Promise<void>;

  /**
   * Sends one message on the open session.
   *
   * @param data - The message, as text
   * @throws {RunnerError} When no session is open
   */
  send(data: string): void;

  /** Closes the session. Does nothing when none is open. */
  close(): void;
}

/** What opening a session needs beyond the channel itself. */
export interface UseSocketConnectArgs {
  /** The socket address, `ws://` or `wss://`. */
  readonly address: string;
  readonly transport: SocketTransportKindView;
  /** Credentials keyed by scheme id, as the reader supplied them. */
  readonly credentials?: Readonly<Record<string, string>>;
  readonly protocols?: readonly string[];
  readonly query?: readonly (readonly [string, string])[];
  /** The messages a received one is checked against. The channel's own when nothing is given. */
  readonly messages?: readonly SocketNamedMessageView[];
}

/** The log a page has before any session has been opened. */
const EMPTY_LOG: SocketLogStateView = {
  entries: [],
  sent: 0,
  received: 0,
  invalid: 0,
  dropped: 0,
};

/**
 * @param id - Channel node id, or nothing to follow the current selection
 * @returns The socket client for that channel
 * @throws {ThemeContractError} When no state was provided above
 *
 * @example
 * const { blocked, connect } = useSocket();
 */
export function useSocket(id?: MaybeRefOrGetter<string | undefined>): UseSocket {
  const state = useDocState();
  const port = useSocketPort();
  const { id: resolvedId, node } = useNode(id);

  const channel = computed(() => (node.value?.kind === 'channel' ? node.value : undefined));

  // A SHALLOW REF, BECAUSE WHAT IT HOLDS IS REPLACED AND NEVER EDITED. The session publishes a
  // whole new state each time anything moves, so deep reactivity would walk a five hundred entry
  // window on every message to discover that every entry is the one it already saw.
  const published = shallowRef<SocketSessionStateView | undefined>(undefined);
  const session = ref<SocketSessionView | undefined>(undefined);
  const failure = ref<string | undefined>(undefined);

  /**
   * The schemes this channel requires, resolved against the document's own table.
   *
   * BOTH POSITIONS, per SPEC 8.2: what connecting to a server costs and what performing an
   * operation costs are two lists, and a handshake has to satisfy whichever of them applies. A
   * requirement naming a scheme the document never declared keeps its name and reads as `unknown`,
   * which is what the operation page already shows and what `handshakeBlockedCause` answers
   * `undeclared` for.
   */
  const schemes = computed<readonly SocketSecuritySchemeView[]>(() => {
    const view = channel.value;
    if (view === undefined) return [];

    const document = state.document.value;
    const declared = new Map(document.security.map((scheme) => [scheme.id, scheme]));
    const seen = new Set<string>();
    const resolved: SocketSecuritySchemeView[] = [];

    const take = (requirements: readonly IRSecurityRequirement[] | undefined): void => {
      for (const requirement of requirements ?? []) {
        if (seen.has(requirement.schemeId)) continue;

        seen.add(requirement.schemeId);
        resolved.push(schemeViewOf(requirement.schemeId, declared.get(requirement.schemeId)));
      }
    };

    for (const override of view.node.servers) {
      take(document.servers.find((server) => server.url === override.url)?.security);
    }
    for (const operation of view.operations) take(operation.security);

    return resolved;
  });

  const blocked = computed<readonly SocketHandshakeBlockView[]>(() => {
    const blocks: SocketHandshakeBlockView[] = [];

    for (const scheme of schemes.value) {
      const cause = handshakeBlockedCause(scheme);
      if (cause !== undefined) blocks.push({ schemeId: scheme.id, type: scheme.type, cause });
    }

    return blocks;
  });

  function connect(args: UseSocketConnectArgs): Promise<void> {
    const view = channel.value;

    if (port === undefined || view === undefined) {
      return Promise.reject(
        new RunnerError(
          port === undefined
            ? 'no socket client was provided above this component, so nothing can be connected'
            : 'this node is not a channel, so there is no socket to open',
          ErrorCode.RUN_NOT_AVAILABLE,
          undefined,
          { nodeId: resolvedId.value },
        ),
      );
    }

    session.value?.close();
    failure.value = undefined;

    try {
      // THE PORT MAY THROW BEFORE IT OPENS ANYTHING, which is the whole of SPEC 14.7's refusal:
      // a credential for a scheme a handshake cannot carry is refused with no socket opened. The
      // sentence is kept so a theme can draw it, and the error is rethrown so a caller that wants
      // to handle it still can.
      const opened = port.open(
        {
          address: args.address,
          transport: args.transport,
          schemes: schemes.value,
          ...(args.credentials === undefined ? {} : { credentials: args.credentials }),
          ...(args.protocols === undefined ? {} : { protocols: args.protocols }),
          ...(args.query === undefined ? {} : { query: args.query }),
          messages: args.messages ?? [],
        },
        {
          onState: (next) => {
            published.value = next;
          },
        },
      );

      session.value = opened;
      published.value = opened.state();

      return Promise.resolve();
    } catch (cause) {
      failure.value = messageOf(cause);
      published.value = undefined;
      session.value = undefined;

      return Promise.reject(cause instanceof Error ? cause : new Error(failure.value));
    }
  }

  return {
    id: resolvedId,
    available: computed(() => port !== undefined && channel.value !== undefined),
    blocked,
    status: computed<SocketStatusView>(() => published.value?.status ?? 'idle'),
    log: computed(() => published.value?.log ?? EMPTY_LOG),
    message: computed(() => failure.value ?? published.value?.message),

    connect,

    send: (data) => {
      const open = session.value;
      if (open === undefined) {
        throw new RunnerError(
          'no socket session is open, so nothing can be sent',
          ErrorCode.RUN_NOT_AVAILABLE,
          undefined,
          { nodeId: resolvedId.value },
        );
      }

      open.send(data);
      published.value = open.state();
    },

    close: () => {
      session.value?.close();
    },
  };
}

/**
 * One requirement with its scheme looked up, or the honest `unknown` when there is none.
 *
 * THE SAME ANSWER THE PAGE ALREADY GIVES. `securityModels` in the renderer reads an undeclared
 * scheme as type `unknown`, and this reads it the same way rather than dropping the requirement:
 * a requirement the document wrote is a fact, and a handshake plan that silently omitted it would
 * be planning for a channel the document does not describe.
 */
function schemeViewOf(
  schemeId: string,
  scheme: IRSecurityScheme | undefined,
): SocketSecuritySchemeView {
  return {
    id: schemeId,
    type: scheme?.type ?? 'unknown',
    ...(scheme?.in === undefined ? {} : { in: scheme.in }),
    ...(scheme?.name === undefined ? {} : { name: scheme.name }),
    ...(scheme?.scheme === undefined ? {} : { scheme: scheme.scheme }),
  };
}

/** The one sentence a console shows when opening a session failed. */
function messageOf(cause: unknown): string {
  if (cause instanceof Error && cause.message !== '') return cause.message;

  return 'the socket could not be opened, for a reason nothing reported';
}

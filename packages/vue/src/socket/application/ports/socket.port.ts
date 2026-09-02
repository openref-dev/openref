/**
 * What a socket client looks like from the headless layer, per SPEC 14.7.
 *
 * RESTATED AND NOT IMPORTED, exactly as the runner port is. `@openref/vue` has one upstream and it
 * is `@openref/core`, so this package cannot see `@openref/runner`; the session `openSocket`
 * returns satisfies this structurally, and the two are held to each other where they are composed.
 * A copy here is the price of the dependency rule and is the same price the runner port pays.
 *
 * THE PORT IS THE SESSION AND NOT THE LOG. State lives in the session the client owns, and the
 * composable subscribes to it rather than keeping a second copy, because two copies of a message
 * log is exactly one copy too many for a page that may be holding five hundred entries.
 */

import type { HandshakeBlockedCause } from '@openref/core';

/** How a socket is opened, per SPEC 14.7. */
export type SocketTransportKindView = 'native' | 'socket.io';

/** Where a session is. */
export type SocketStatusView =
  'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'refused';

/** Which way one message went. */
export type SocketMessageDirectionView = 'sent' | 'received';

/** One message in the log. */
export interface SocketLogEntryView {
  readonly seq: number;
  readonly direction: SocketMessageDirectionView;
  readonly data: string;
  /** Name of the declared message this one matched, absent when none did. */
  readonly matched?: string;
  /** Why this message matches nothing the channel declares, absent when it does. */
  readonly problem?: string;
  /**
   * True when the frame was never read at all, per SPEC 14.7 and the `T065` section.
   *
   * THE ENTRY HALF OF THE COUNTER BELOW. Without it a theme can read that some frames were
   * unreadable and cannot say which, so it would have to guess from the `problem` sentence, which
   * is the guess the split exists to remove.
   */
  readonly unreadable?: true;
}

/** The log, bounded by its window, with everything counted. */
export interface SocketLogStateView {
  readonly entries: readonly SocketLogEntryView[];
  readonly sent: number;
  readonly received: number;
  readonly invalid: number;
  /**
   * Messages the log could not read at all, per SPEC 14.7 and the `T065` section.
   *
   * SEPARATE FROM `invalid` BECAUSE THE TWO MEAN DIFFERENT THINGS TO A READER. A binary frame on a
   * text channel was never checked against a schema, so counting it as a schema mismatch tells a
   * reader to go and look at a schema that is fine. `T059` split the pair in
   * `packages/runner/src/socket/domain/message-log.ts` and this view never gained the member, so a
   * Vue consumer could not read the counter the split exists to provide, and structural assignment
   * kept the omission green.
   */
  readonly unreadable: number;
  readonly dropped: number;
}

/** What a session reports. */
export interface SocketSessionStateView {
  readonly status: SocketStatusView;
  readonly log: SocketLogStateView;
  readonly attempts: number;
  readonly message?: string;
}

/** One scheme a browser cannot present at the handshake, per SPEC 14.7. */
export interface SocketHandshakeBlockView {
  readonly schemeId: string;
  /** The type as the document wrote it, or `unknown` for a scheme it never declared. */
  readonly type: string;
  readonly cause: HandshakeBlockedCause;
}

/** One message a channel declares, in the JSON Schema subset of SPEC 14.6. */
export interface SocketMessageSchemaView {
  readonly type?: string | readonly string[];
  readonly required?: readonly string[];
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly properties?: Readonly<Record<string, SocketMessageSchemaView>>;
}

/** A declared message with its name, which is what a verdict names. */
export interface SocketNamedMessageView {
  readonly name: string;
  readonly schema: SocketMessageSchemaView;
}

/** A security scheme as the client needs to read it to plan a handshake. */
export interface SocketSecuritySchemeView {
  readonly id: string;
  readonly type: string;
  readonly in?: string;
  readonly name?: string;
  readonly scheme?: string;
}

/** What opening a session needs. */
export interface SocketOpenInput {
  readonly address: string;
  readonly transport: SocketTransportKindView;
  readonly schemes?: readonly SocketSecuritySchemeView[];
  readonly credentials?: Readonly<Record<string, string>>;
  readonly protocols?: readonly string[];
  readonly query?: readonly (readonly [string, string])[];
  readonly messages?: readonly SocketNamedMessageView[];
}

/**
 * Where a session reports what happens to it.
 *
 * ONE CALLBACK, AND A SECOND ONE WAS REMOVED RATHER THAN LEFT DECLARED. `onEntry` sat here until a
 * blind review found that `useSocket` never filled it, which is the declared-and-unfilled class
 * this project keeps filing. It was redundant as well as unfilled: a session publishes a state on
 * every message, and the message just filed is the last entry of the window that state carries, so
 * two ways to observe one event were two places for the observations to disagree.
 */
export interface SocketSessionHandlersView {
  readonly onState?: (state: SocketSessionStateView) => void;
}

/** A running session. */
export interface SocketSessionView {
  state(): SocketSessionStateView;
  send(data: string): void;
  close(): void;
  readonly closed: Promise<SocketSessionStateView>;
}

/** Opens socket sessions. */
export interface ISocketPort {
  /**
   * @param input - The address, the transport, the schemes and the credentials
   * @param handlers - Where the session reports its state and its messages
   * @returns The session
   * @throws When the reader supplied a value no handshake can carry, before any socket is opened
   */
  open(input: SocketOpenInput, handlers: SocketSessionHandlersView): SocketSessionView;
}

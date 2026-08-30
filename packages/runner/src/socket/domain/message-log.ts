/**
 * The message log: bounded by a window, and loud about what fell out of it.
 *
 * THE SAME RULE AS THE STREAM LOG OF SPEC 14.6, AND THE SAME REASON. A socket session is unbounded
 * by construction, so a log that keeps everything is a page that grows until the tab dies. What is
 * kept is the last `windowSize` entries; what is counted is everything, sent, received, marked and
 * dropped. A session of ten thousand messages therefore leaves five hundred entries and four
 * numbers behind it.
 *
 * DROPPED IS COUNTED OUT LOUD, which SPEC 14.8 requires of the bridge and this file owes for the
 * same reason: a log that quietly forgets is a log a reader trusts to be complete and is not.
 *
 * IT IS IN THIS PACKAGE AND NOT IN THE RENDERER, which is the opposite of where `createStreamLog`
 * lives, and the difference is measured rather than preferred. The stream log went to the renderer
 * because it was first paint bytes; nothing in the shipped browser entry composes a socket client,
 * so this file is not in any browser bundle at all, and it belongs with the client that fills it.
 */

/** How many entries the log holds before the oldest falls out. */
export const DEFAULT_SOCKET_LOG_WINDOW = 500;

/** Which way one message went. */
export type SocketMessageDirection = 'sent' | 'received';

/** One message in the log. */
export interface SocketLogEntry {
  /** Position in the whole session, counting from one and never reused. */
  readonly seq: number;
  readonly direction: SocketMessageDirection;
  readonly data: string;
  /** Name of the declared message this one matched, per SPEC 14.7. Absent when nothing did. */
  readonly matched?: string;
  /** Why this message matches nothing the channel declares. Absent when it does, or when
   * the channel declares nothing to match against. */
  readonly problem?: string;
}

/** The log as a consumer reads it. */
export interface SocketLogState {
  /** The last `windowSize` entries, oldest first. */
  readonly entries: readonly SocketLogEntry[];
  readonly sent: number;
  readonly received: number;
  /** How many received messages matched nothing the channel declares. */
  readonly invalid: number;
  /** How many entries fell out of the window. */
  readonly dropped: number;
}

/** A log that keeps a window and counts everything. */
export interface SocketLog {
  /** The current state, as a new value each time something is appended. */
  state(): SocketLogState;
  /**
   * Appends one message.
   *
   * @param entry - The message, without its sequence number
   * @returns The entry as it was filed, with its sequence number
   */
  append(entry: Omit<SocketLogEntry, 'seq'>): SocketLogEntry;
}

/**
 * Creates a log bounded by a window.
 *
 * @param windowSize - Entries to keep, defaulting to {@link DEFAULT_SOCKET_LOG_WINDOW}
 * @returns The log
 *
 * @example
 * const log = createSocketLog();
 */
export function createSocketLog(windowSize: number = DEFAULT_SOCKET_LOG_WINDOW): SocketLog {
  // A window of zero would keep nothing and count everything, which is a legitimate thing to ask
  // for; a negative one is a caller error and is read as zero rather than as an unbounded log.
  const size = Math.max(0, Math.floor(windowSize));

  let entries: SocketLogEntry[] = [];
  let seq = 0;
  let sent = 0;
  let received = 0;
  let invalid = 0;
  let dropped = 0;

  return {
    state: (): SocketLogState => ({ entries, sent, received, invalid, dropped }),

    append: (entry): SocketLogEntry => {
      seq += 1;
      const filed: SocketLogEntry = { ...entry, seq };

      if (filed.direction === 'sent') sent += 1;
      else received += 1;

      if (filed.problem !== undefined) invalid += 1;

      // A NEW ARRAY EVERY TIME, so a consumer holding the previous state sees a value that did
      // not move under it. A ring buffer mutated in place would be cheaper and would make every
      // reader of `state()` race the next message.
      const next = [...entries, filed];
      dropped += Math.max(0, next.length - size);
      entries = next.slice(Math.max(0, next.length - size));

      return filed;
    },
  };
}

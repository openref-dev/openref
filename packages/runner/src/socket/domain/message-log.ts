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

/**
 * How many bytes of payload the log holds, whatever the entry count says.
 *
 * A WINDOW OF ENTRIES IS NOT A BOUND, AND `T062` MEASURED WHAT IT COSTS. Driving the real session
 * through the suite's own transport double: 60 frames of one megabyte leave 60 entries holding
 * 60.0 MB, and 600 of them leave the default window holding its ceiling, 500 entries and 500.0 MB.
 * The bound was `windowSize` times the size of a frame, which is a bound on nothing, and the
 * neighbouring fact is what settled it: the stream decoder of SPEC 14.6, in this same package,
 * refuses a single element over one mebibyte while this log accepted five hundred of them.
 *
 * THE NUMBER IS THE BRIDGE RING'S, DELIBERATELY. `DEFAULT_BRIDGE_BUFFERED_BYTES` is one mebibyte
 * for the same question asked on a server, and two ceilings on one repository's message buffers
 * that differ for no stated reason are two numbers a reader has to reconcile.
 *
 * THE NUMBER IS THE RING'S AND THE ORDER IS NOT, AND THE DIFFERENCE IS STATED RATHER THAN CALLED
 * "THE SAME SHAPE". The ring decides before it stores: a message that would overflow is refused,
 * dropped or ends the session, per the mode SPEC 14.8 gives it, because a server chooses what to do
 * with a producer it cannot keep up with. This log has no mode and no producer to answer: it is a
 * reader's own tail view, so it always keeps the newest and evicts the oldest, which means it
 * stores and then evicts. The one case where the two coincide is an entry larger than the whole
 * ceiling, which both refuse before storing, because emptying the buffer for something that still
 * would not fit loses everything and bounds nothing. The peak held is therefore one entry above the
 * ceiling here and exactly the ceiling there, which is the whole of the difference.
 */
export const DEFAULT_SOCKET_LOG_BYTES = 1_048_576;

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
  /**
   * True when the frame was never read at all, per SPEC 14.7.
   *
   * IT IS A MEMBER AND NOT A SHAPE OF `problem`, because the two answer different questions and
   * `T059` measured a reader being given one for the other: a frame that is not text has no payload
   * to check, so a `problem` naming a schema is a false reason and an `invalid` count that includes
   * it is a false number. The entry still carries a `problem`, and it names the frame.
   */
  readonly unreadable?: true;
}

/** The log as a consumer reads it. */
export interface SocketLogState {
  /** The last `windowSize` entries, oldest first. */
  readonly entries: readonly SocketLogEntry[];
  readonly sent: number;
  readonly received: number;
  /** How many received messages were read and matched nothing the channel declares. */
  readonly invalid: number;
  /** How many frames arrived that this console does not read at all, per SPEC 14.7. */
  readonly unreadable: number;
  /**
   * How many entries the log holds no longer, whichever ceiling took them.
   *
   * ONE COUNTER FOR THREE CAUSES, WHICH IS A DECISION AND NOT AN ACCIDENT OF SHARING A VARIABLE.
   * An entry leaves because the window filled, because the byte ceiling filled, or because it was
   * alone larger than the whole ceiling and was never kept. To the reader those are one fact, "the
   * log is not complete, and this is by how much", and three numbers would be three ways to ask
   * the same question. The sentence here said "fell out of the window" for one milestone after the
   * byte ceiling was added, which is a counter that was unified while its documentation was not.
   */
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
 * Creates a log bounded by a window and by a byte ceiling.
 *
 * @param windowSize - Entries to keep, defaulting to {@link DEFAULT_SOCKET_LOG_WINDOW}
 * @param maxBufferedBytes - Payload bytes to keep, defaulting to {@link DEFAULT_SOCKET_LOG_BYTES}
 * @returns The log
 *
 * @example
 * const log = createSocketLog();
 */
export function createSocketLog(
  windowSize: number = DEFAULT_SOCKET_LOG_WINDOW,
  maxBufferedBytes: number = DEFAULT_SOCKET_LOG_BYTES,
): SocketLog {
  // A window of zero would keep nothing and count everything, which is a legitimate thing to ask
  // for; a negative one is a caller error and is read as zero rather than as an unbounded log.
  const size = Math.max(0, Math.floor(windowSize));
  const byteCeiling = Math.max(0, Math.floor(maxBufferedBytes));

  let entries: SocketLogEntry[] = [];
  let seq = 0;
  let sent = 0;
  let received = 0;
  let invalid = 0;
  let unreadable = 0;
  let dropped = 0;
  let bytes = 0;

  return {
    state: (): SocketLogState => ({ entries, sent, received, invalid, unreadable, dropped }),

    append: (entry): SocketLogEntry => {
      seq += 1;
      const filed: SocketLogEntry = { ...entry, seq };

      if (filed.direction === 'sent') sent += 1;
      else received += 1;

      // THE TWO COUNTERS ARE EXCLUSIVE AND THAT IS THE WHOLE POINT OF THE SECOND ONE. `invalid` is
      // "read and matched nothing"; a frame that was never read cannot have matched or failed to.
      if (filed.unreadable === true) unreadable += 1;
      else if (filed.problem !== undefined) invalid += 1;

      // ONE FRAME LARGER THAN THE WHOLE CEILING IS NOT KEPT, which is the same answer the bridge
      // ring of SPEC 14.8 gives to the same question: emptying the log for one entry that still
      // does not fit would lose everything and bound nothing.
      const filedSize = sizeOf(filed);
      if (byteCeiling > 0 && filedSize > byteCeiling) {
        dropped += 1;

        return filed;
      }

      // A NEW ARRAY EVERY TIME, so a consumer holding the previous state sees a value that did
      // not move under it. A ring buffer mutated in place would be cheaper and would make every
      // reader of `state()` race the next message.
      let next = [...entries, filed];
      bytes += filedSize;

      // THE ENTRY WINDOW FIRST, THEN THE BYTES, and both count into one `dropped`. To a reader
      // the two are the same fact: the log is not complete, and this is by how much.
      const overWindow = Math.max(0, next.length - size);
      if (overWindow > 0) {
        for (const leaving of next.slice(0, overWindow)) bytes -= sizeOf(leaving);
        dropped += overWindow;
        next = next.slice(overWindow);
      }

      while (next.length > 0 && bytes > byteCeiling) {
        const leaving = next[0];
        if (leaving === undefined) break;

        bytes -= sizeOf(leaving);
        dropped += 1;
        next = next.slice(1);
      }

      entries = next;

      return filed;
    },
  };
}

/**
 * How large one entry is: every string it holds, not only the payload.
 *
 * MEASURING THE PAYLOAD ALONE LEFT THE CEILING FULLY BYPASSABLE, AND IT WAS MEASURED RATHER THAN
 * ARGUED. The first form of this counted `data` only, exactly the mistake `bridge.service.ts` warns
 * against at its own call site, in its own words: "measuring the payload alone would let an id
 * nobody bounded carry the memory the payload was refused." Driven on 2026-08-30: 60 entries of a
 * two byte payload each carrying a one megabyte `problem` retained **60.0 MB** with `dropped` at
 * zero, while the counted total read 120 bytes of a 1,048,576 ceiling.
 *
 * AND THE VECTOR IS THE DOCUMENT RATHER THAN THE SERVER, WHICH IS WHY IT MATTERS. `problem` is
 * built by `checkSocketMessage` from the declared message's own name, so its size is a value a
 * document wrote; a reader connecting to an honest server can be handed the memory by the
 * specification the page was built from. `matched` is the same name on the other branch.
 *
 * CODE UNITS RATHER THAN ENCODED BYTES, which is a decision and not an oversight: measuring UTF-8
 * length means encoding every frame a second time, on the client, to bound a buffer. The two agree
 * on ASCII and the ceiling is conservative by at most a factor of three the other way. The
 * sequence number, the direction and the `unreadable` flag are not counted: they are the same
 * handful of bytes on every entry, so counting them would make the ceiling a number about the
 * log's own bookkeeping rather than about what a session carried.
 *
 * @param entry - The entry
 * @returns Its size
 */
function sizeOf(entry: SocketLogEntry): number {
  return entry.data.length + (entry.problem?.length ?? 0) + (entry.matched?.length ?? 0);
}

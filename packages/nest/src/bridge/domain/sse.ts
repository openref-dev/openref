/**
 * Server sent event framing, and the four things the bridge stream ever says.
 *
 * THE STREAM IS THE BRIDGE'S USER INTERFACE, AND SPEC 14.8 SAYS SO WITH A NUMBER. The indicator
 * SPEC 19.8 demands has to reach the reader, and on 2026-08-30 the default theme has 40 bytes of
 * `theme-css-raw` headroom, which is the same measurement that made SPEC 14.7 record the socket
 * console as a debt rather than build it. What a reader of this route watches is the stream, so
 * the drop notice rides in the stream: it costs no stylesheet byte, no browser byte, and it is
 * readable by `curl`, by `EventSource` and by whatever a host puts in front of it.
 *
 * EVERY LINE OF A PAYLOAD BECOMES ITS OWN `data:` LINE, which is the format's own rule and not a
 * nicety. A payload containing a newline written as one `data:` line ends the event early, so the
 * remainder of a broker message would arrive as a field name the reader silently discards. A
 * carriage return does the same, so it goes too.
 */

/** One SSE frame, as it goes on the wire. */
export type SseFrame = string;

/** The event name carrying a broker message. */
export const SSE_MESSAGE_EVENT = 'message';

/** The event name carrying the drop indicator of SPEC 19.8. */
export const SSE_DROPPED_EVENT = 'dropped';

/** The event name carrying the reason a stream ends. */
export const SSE_CLOSED_EVENT = 'closed';

/** The event name carrying the fact that a subscription is live. */
export const SSE_OPEN_EVENT = 'open';

/**
 * The first bytes of a bridge stream.
 *
 * IT IS A COMMENT AND IT IS SENT BEFORE ANYTHING ELSE, so the response headers leave the process
 * on the instant rather than when the broker first speaks. A channel that is quiet for a minute
 * would otherwise look to the reader exactly like a server that never answered.
 *
 * @param channel - The channel this stream carries
 * @returns The prelude comment and the open event
 */
export function ssePrelude(channel: string): SseFrame {
  return `: openref bridge\n\n${sseFrame(SSE_OPEN_EVENT, JSON.stringify({ channel }))}`;
}

/**
 * One broker message.
 *
 * @param data - The payload as the broker gave it
 * @param id - The broker's own id, when it has one
 * @returns The frame
 */
export function sseMessage(data: string, id?: string): SseFrame {
  return sseFrame(SSE_MESSAGE_EVENT, data, id);
}

/** What the reader is told when messages were lost, per SPEC 19.8. */
export interface SseDropNotice {
  /** How many were lost since the last notice. */
  readonly dropped: number;
  /** How many were lost in this subscription so far. */
  readonly total: number;
  /** Which overflow mode did it, so the reader knows whether the newest or the oldest is gone. */
  readonly mode: string;
}

/**
 * The drop indicator.
 *
 * TWO NUMBERS AND NOT ONE. `dropped` is what a reader who saw the previous notice needs, `total`
 * is what a reader who joined late or missed one needs, and a notice carrying only the first is a
 * count that cannot be reconstructed from the stream a reader actually received.
 *
 * @param notice - What was lost and how
 * @returns The frame
 */
export function sseDropped(notice: SseDropNotice): SseFrame {
  return sseFrame(SSE_DROPPED_EVENT, JSON.stringify(notice));
}

/** What the reader is told when the stream ends. */
export interface SseCloseNotice {
  /** Why it ended, in words. */
  readonly reason: string;
  /** How many were lost in this subscription, including anything the close itself discarded. */
  readonly dropped: number;
  /** How many were delivered. */
  readonly delivered: number;
}

/**
 * The closing statement.
 *
 * NO ENDING IS SILENT, WHICH IS WHAT MAKES `disconnect` A MODE AND NOT A DEFECT. The mode drops
 * the reader, so if the drop were the whole of it the reader would see a connection that stopped
 * and could not tell it from a network that broke. It sees a reason and a count instead.
 *
 * @param notice - Why the stream ends and what it carried
 * @returns The frame
 */
export function sseClosed(notice: SseCloseNotice): SseFrame {
  return sseFrame(SSE_CLOSED_EVENT, JSON.stringify(notice));
}

/**
 * One frame, with the payload split across `data:` lines.
 *
 * @param event - Event name
 * @param data - Payload, which may carry line breaks
 * @param id - Event id, when there is one
 * @returns The frame, terminated by the blank line the format requires
 */
function sseFrame(event: string, data: string, id?: string): SseFrame {
  const lines = data.split(/\r\n|\r|\n/).map((line) => `data: ${line}`);
  const head = id === undefined ? '' : `id: ${sseField(id)}\n`;

  return `${head}event: ${event}\n${lines.join('\n')}\n\n`;
}

/**
 * One field value, with anything that would end the field removed.
 *
 * AN ID COMES FROM THE BROKER AND THEREFORE FROM OUTSIDE, so it is treated as the untrusted value
 * it is: a newline in it would end the event and turn the rest into a field name of its own.
 *
 * @param value - Whatever the broker supplied
 * @returns The value with line breaks removed
 */
function sseField(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

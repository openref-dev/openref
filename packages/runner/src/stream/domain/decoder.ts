import { ErrorCode, StreamError } from '@openref/core';
/**
 * Turning a byte stream into elements, one chunk at a time, per SPEC 14.6.
 *
 * THE WHOLE FILE IS ABOUT THE BOUNDARY THAT IS NOT THERE. A chunk from the network has nothing
 * to do with an element: one element can arrive in six chunks, six elements can arrive in one,
 * and a chunk can end in the middle of a `data:` field, in the middle of a line terminator, or
 * in the middle of a character. So there is one buffer, it survives every call, and a caller
 * that hands over the chunks in order gets the elements in order whatever the split was.
 *
 * THE CHARACTER SPLIT IS NOT THIS FILE'S PROBLEM AND THAT IS DELIBERATE. `TextDecoder` with
 * `{ stream: true }` holds a partial code point back until the rest of it arrives, so what
 * reaches `push` is always whole characters. Doing it here as well would be a second, worse
 * implementation of the same thing.
 *
 * SSE IS PARSED AS THE EVENT STREAM FORMAT DEFINES IT AND NOT AS "SPLIT ON data:". The three
 * line terminators are all accepted, a `\r` at the end of a chunk cannot be dispatched until the
 * next chunk says whether it was a `\r\n`, a comment line is a keepalive rather than an element,
 * multiple `data:` fields join with a newline, and an event with no data dispatches nothing. A
 * console that guessed instead would show a keepalive as an empty element every fifteen seconds.
 */

/** The two wire formats SPEC 14.6 renders incrementally. */
export type StreamFormat = 'sse' | 'ndjson';

/** One element as it came off the wire, before anything has judged it. */
export interface StreamFrame {
  /** The data of the element: the joined `data` fields for SSE, the line for NDJSON. */
  readonly data: string;
  /** The SSE event name, when the server named one. */
  readonly event?: string;
  /** The SSE event id, when the server sent one. */
  readonly id?: string;
}

/**
 * How many characters one element may hold before the decoder refuses to keep buffering.
 *
 * A LIMIT ON THE ELEMENT AND NOT ONLY ON THEIR NUMBER. A server that opens a stream and never
 * sends a separator is a server sending one infinite element, and every bound expressed in
 * elements is satisfied by it forever.
 */
export const DEFAULT_MAX_ELEMENT_CHARS = 1024 * 1024;

/**
 * Thrown by the decoder when one element passes the limit it was built with.
 *
 * IT EXTENDS `StreamError` SINCE `T065`, AND IT EXTENDED `Error` BEFORE THAT, WHICH WAS A RULE
 * VIOLATION IN THE PUBLISHED SURFACE. STANDARDS and `CLAUDE.md` both say every error of this
 * project extends `OpenRefError` and carries an `ErrorCode`, and the hierarchy already had the
 * exact place for this one, `RunnerError -> StreamError`. This is the only error class
 * `@openref/runner`, `@openref/nest` and `@openref/vue` export at all, so the one that reached a
 * consumer was the one that broke the rule: a caller doing `error instanceof OpenRefError` or
 * reading `error.code` got neither, and a `@throws` tag named a shape the rest of the surface does
 * not share. `limit` stays a readonly member so the existing catch site keeps compiling, and it is
 * repeated into the error context, which is where every other error of this project puts its
 * subject.
 */
export class ElementTooLargeError extends StreamError {
  /** @param limit - The limit that was passed, in characters */
  constructor(public readonly limit: number) {
    super(
      `one element of the stream is longer than the ${String(limit)} characters this console will buffer`,
      ErrorCode.RUN_STREAM_FAILED,
      undefined,
      { limit },
    );
  }
}

/** Reads chunks of text and reports the elements they complete. */
export class StreamDecoder {
  private buffer = '';
  private data: string[] = [];
  private event: string | undefined;
  private id: string | undefined;

  /**
   * @param format - Which wire format the server is speaking
   * @param maxElementChars - Greatest length of one element, in characters
   */
  constructor(
    private readonly format: StreamFormat,
    private readonly maxElementChars: number = DEFAULT_MAX_ELEMENT_CHARS,
  ) {}

  /**
   * Adds one chunk and reports whatever it completed.
   *
   * @param text - The chunk, as characters
   * @returns The elements this chunk finished, in order, empty when it finished none
   * @throws {ElementTooLargeError} When what is buffered passes the limit
   */
  push(text: string): StreamFrame[] {
    this.buffer += text;

    if (this.buffer.length > this.maxElementChars) {
      throw new ElementTooLargeError(this.maxElementChars);
    }

    const frames: StreamFrame[] = [];

    for (;;) {
      const line = this.takeLine();
      if (line === null) break;

      const frame = this.consume(line);
      if (frame !== null) frames.push(frame);
    }

    return frames;
  }

  /**
   * Reports the element the stream ended in the middle of, when it ended in one.
   *
   * A SERVER THAT CLOSES WITHOUT A FINAL NEWLINE HAS STILL SENT AN ELEMENT, and dropping it
   * would make the last line of every such stream invisible. The event stream format does say
   * a final block with no blank line after it is discarded; NDJSON has no such rule, and this
   * is why the two are told apart here rather than sharing one flush.
   *
   * @returns The trailing element, or an empty list when there is none
   */
  flush(): StreamFrame[] {
    const rest = this.buffer;
    this.buffer = '';

    if (this.format === 'ndjson') {
      const line = rest.replace(/\r$/, '');

      return line.trim() === '' ? [] : [{ data: line }];
    }

    // An incomplete SSE block is discarded, which is what the format says to do with one. The
    // buffer is still cleared, so a decoder reused after a failed stream starts empty.
    this.data = [];
    this.event = undefined;
    this.id = undefined;

    return [];
  }

  /**
   * Takes one complete line off the buffer, leaving a partial one behind.
   *
   * A `\r` AT THE END OF THE BUFFER IS NOT A COMPLETE LINE, because the next chunk decides
   * whether it was a lone carriage return or the first half of a `\r\n`. Treating it as complete
   * dispatches the element one chunk early and then reads the `\n` as an empty line, which for
   * SSE is a dispatch of nothing and for NDJSON is a blank element.
   *
   * @returns The line without its terminator, or null when the buffer holds no complete line
   */
  private takeLine(): string | null {
    const index = this.buffer.search(/\r\n|\r|\n/);
    if (index === -1) return null;

    const isBareCarriageReturnAtEnd =
      this.buffer[index] === '\r' && index === this.buffer.length - 1;
    if (isBareCarriageReturnAtEnd) return null;

    const line = this.buffer.slice(0, index);
    const width = this.buffer.startsWith('\r\n', index) ? 2 : 1;
    this.buffer = this.buffer.slice(index + width);

    return line;
  }

  /**
   * Feeds one line to the format's own rules.
   *
   * @param line - The line, without its terminator
   * @returns The element it completed, or null when it completed none
   */
  private consume(line: string): StreamFrame | null {
    if (this.format === 'ndjson') {
      return line.trim() === '' ? null : { data: line };
    }

    if (line === '') return this.dispatch();

    // A line beginning with a colon is a comment, which is what a keepalive is made of. It is
    // not an element and it is not an error: it is the server saying the connection is alive.
    if (line.startsWith(':')) return null;

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const raw = colon === -1 ? '' : line.slice(colon + 1);
    const value = raw.startsWith(' ') ? raw.slice(1) : raw;

    if (field === 'data') this.data.push(value);
    else if (field === 'event') this.event = value;
    // A NUL in an id is the one value the format says to ignore rather than store.
    else if (field === 'id' && !value.includes('\0')) this.id = value;

    // `retry` and any unknown field are ignored, which is what the format requires of a reader
    // that meets a field it does not know.
    return null;
  }

  /**
   * Ends the current SSE block.
   *
   * @returns The element, or null when the block carried no data at all
   */
  private dispatch(): StreamFrame | null {
    const { data, event, id } = this;
    this.data = [];
    this.event = undefined;

    // THE ID SURVIVES THE DISPATCH, because the format defines it as the last event id of the
    // stream rather than a field of one event. The event name does not.
    if (data.length === 0) return null;

    return {
      data: data.join('\n'),
      ...(event === undefined ? {} : { event }),
      ...(id === undefined ? {} : { id }),
    };
  }
}

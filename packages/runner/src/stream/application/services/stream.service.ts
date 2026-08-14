/**
 * One stream, from the request that opens it to the reason it ended.
 *
 * EVERY WAY A STREAM CAN END IS A NAMED REASON AND NOT AN EXCEPTION. A reader watching a live
 * feed needs to know which of these happened: the server closed it, the terminator arrived, they
 * pressed Stop, the server went quiet for a minute, the server refused, or something broke. Four
 * of the six are ordinary and only two are faults, so `done` resolves rather than rejecting and
 * the reason is the value. A promise that rejected on Stop would make the ordinary case the one
 * every caller has to write a handler for.
 *
 * STOP AND THE IDLE TIMEOUT ARE THE SAME MECHANISM, DELIBERATELY. Both abort the controller the
 * request was opened with, so both close the connection rather than stopping the reading, and
 * what tells them apart afterwards is which flag was set. One way to end a request means there is
 * one thing to get right.
 *
 * THE COUNTS OUTLIVE THE WINDOW. `received` and `invalid` count every element the server sent,
 * not the ones still held: whoever draws the stream keeps a bounded window, per SPEC 14.6, and a
 * count that agreed with the window would be a count of what has not scrolled away.
 */

import { ErrorCode, RunnerError } from '@openref/core';
import type { RequestPlan } from '../../../request/domain/request-plan';
import { StreamDecoder, ElementTooLargeError, type StreamFormat } from '../../domain/decoder';
import { checkStreamItem, type StreamItemSchema } from '../../domain/item-check';
import type { IStreamTransport } from '../ports/stream-transport.port';

/**
 * How long the server may say nothing before the stream is closed, in milliseconds.
 *
 * BETWEEN CHUNKS AND NOT BETWEEN ELEMENTS, per SPEC 14.6. An SSE keepalive is a comment line: it
 * is bytes from the server and it is not an element, so a limit counted in elements would cut
 * off exactly the connections a server is taking the trouble to keep alive.
 */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 60_000;

/** How much of a refused response is quoted back to the reader. */
const REFUSAL_EXCERPT_CHARS = 2048;

/** One element of a stream, as whatever draws it receives it. */
export interface StreamElement {
  /** Position in the stream, from 1, counting every element the server sent. */
  readonly seq: number;
  readonly data: string;
  readonly event?: string;
  readonly id?: string;
  /**
   * Why this element does not match the declared item schema, when it does not.
   *
   * MARKED AND NEVER DROPPED, per SPEC 14.6. An element quietly discarded turns a server that is
   * sending the wrong thing into a server that is sending less, and telling those two apart is
   * what this console is for.
   */
  readonly problem?: string;
}

/** Why a stream is no longer running. */
export type StreamEndReason =
  'complete' | 'terminator' | 'stopped' | 'timeout' | 'refused' | 'failed';

/** How a stream ended, and what it delivered before it did. */
export interface StreamEnd {
  readonly reason: StreamEndReason;
  /** Every element the server sent, including the ones marked invalid. */
  readonly received: number;
  /** How many of them did not match the declared item schema. */
  readonly invalid: number;
  /** What to tell the reader, for the reasons that need telling. */
  readonly message?: string;
}

/** What the server said when the stream opened. */
export interface StreamOpened {
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly (readonly [string, string])[];
}

/** Where a running stream reports to. */
export interface StreamHandlers {
  readonly onOpen?: (opened: StreamOpened) => void;
  readonly onElement: (element: StreamElement) => void;
  readonly onEnd?: (end: StreamEnd) => void;
}

/** What one stream is run with. */
export interface StreamRunOptions {
  /** Which wire format the response is read as. */
  readonly format: StreamFormat;
  /** The value that ends the stream normally, from `@ApiStream({ terminator })`. */
  readonly terminator?: string;
  /** What each element is checked against, within the limits SPEC 14.6 names. */
  readonly itemSchema?: StreamItemSchema;
  /** How long the server may say nothing. Defaults to {@link DEFAULT_STREAM_IDLE_TIMEOUT_MS}. */
  readonly idleTimeoutMs?: number;
  /** Greatest length of one element, in characters. */
  readonly maxElementChars?: number;
}

/** A stream that is running, and the one thing that can be done to it. */
export interface StreamHandle {
  /** Aborts the request, which closes the connection rather than stopping the reading. */
  stop(): void;
  /** Resolves once the stream has ended, whatever ended it. Never rejects. */
  readonly done: Promise<StreamEnd>;
}

/** Everything `runStream` needs that is not about this one request. */
export interface StreamRunContext {
  readonly transport: IStreamTransport;
  /** Injected so a test can drive the idle timeout without waiting a minute. */
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

/**
 * Opens a stream, reports its elements as they arrive, and ends for one named reason.
 *
 * @param plan - The request as `buildRequest` resolved it
 * @param options - Format, terminator, item schema and limits
 * @param handlers - Where elements and the ending are reported
 * @param context - The transport, and the timer to bound silence with
 * @returns A way to stop it, and a promise for how it ended
 *
 * @example
 * const stream = runStream(plan, { format: 'sse' }, { onElement }, { transport });
 */
export function runStream(
  plan: RequestPlan,
  options: StreamRunOptions,
  handlers: StreamHandlers,
  context: StreamRunContext,
): StreamHandle {
  const controller = new AbortController();
  const setTimer = context.setTimer ?? ((callback, ms): unknown => setTimeout(callback, ms));
  const clearTimer =
    context.clearTimer ??
    ((handle): void => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    });
  const idleMs = options.idleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;

  // A HOLDER RATHER THAN TWO LOCALS, and it is about the compiler rather than about style. Both
  // are assigned only inside callbacks, which control flow analysis does not follow, so read from
  // the catch below they narrow to `false` and the two branches that tell an abort from a timeout
  // read as dead code. The object is what makes the reads honest.
  const ended = { stopped: false, timedOut: false };
  let received = 0;
  let invalid = 0;
  let idleHandle: unknown = null;

  const clearIdle = (): void => {
    if (idleHandle !== null) clearTimer(idleHandle);
    idleHandle = null;
  };

  const armIdle = (): void => {
    clearIdle();
    idleHandle = setTimer(() => {
      ended.timedOut = true;
      controller.abort();
    }, idleMs);
  };

  const done = (async (): Promise<StreamEnd> => {
    const decoder = new StreamDecoder(options.format, options.maxElementChars);

    /**
     * Delivers one decoded frame, checking it and counting it.
     *
     * @param frame - What the decoder produced
     * @returns True when this frame was the terminator and the stream is over
     */
    const deliver = (frame: { data: string; event?: string; id?: string }): boolean => {
      if (options.terminator !== undefined && frame.data === options.terminator) return true;

      received += 1;
      const problem = checkStreamItem(frame.data, options.itemSchema);
      if (problem !== null) invalid += 1;

      handlers.onElement({
        seq: received,
        data: frame.data,
        ...(frame.event === undefined ? {} : { event: frame.event }),
        ...(frame.id === undefined ? {} : { id: frame.id }),
        ...(problem === null ? {} : { problem }),
      });

      return false;
    };

    try {
      armIdle();
      const opened = await context.transport.open(plan, controller.signal);

      handlers.onOpen?.({
        status: opened.status,
        statusText: opened.statusText,
        headers: opened.headers,
      });

      // A REFUSAL IS NOT A STREAM, AND ITS BODY IS THE ONE THING WORTH SHOWING. The server said
      // no in a status and usually said why in a body, so the body is quoted back rather than
      // decoded into elements that were never elements.
      if (opened.status < 200 || opened.status > 299) {
        let excerpt = '';
        for await (const chunk of opened.chunks) {
          excerpt += chunk;
          if (excerpt.length >= REFUSAL_EXCERPT_CHARS) break;
        }
        controller.abort();

        return {
          reason: 'refused',
          received,
          invalid,
          message:
            `the server answered ${String(opened.status)} ${opened.statusText} and did not open a stream` +
            (excerpt.trim() === '' ? '' : `: ${excerpt.slice(0, REFUSAL_EXCERPT_CHARS)}`),
        };
      }

      for await (const chunk of opened.chunks) {
        armIdle();

        for (const frame of decoder.push(chunk)) {
          if (!deliver(frame)) continue;
          controller.abort();

          return { reason: 'terminator', received, invalid };
        }
      }

      for (const frame of decoder.flush()) {
        if (!deliver(frame)) continue;

        return { reason: 'terminator', received, invalid };
      }

      return { reason: 'complete', received, invalid };
    } catch (cause) {
      if (ended.stopped) return { reason: 'stopped', received, invalid };

      if (ended.timedOut) {
        return {
          reason: 'timeout',
          received,
          invalid,
          message: `the server sent nothing for ${String(idleMs)} ms, so the stream was closed`,
        };
      }

      if (cause instanceof ElementTooLargeError) {
        controller.abort();

        return { reason: 'failed', received, invalid, message: cause.message };
      }

      return {
        reason: 'failed',
        received,
        invalid,
        message:
          cause instanceof RunnerError || cause instanceof Error
            ? cause.message
            : 'the stream ended abnormally',
      };
    } finally {
      clearIdle();
    }
  })().then((end) => {
    handlers.onEnd?.(end);

    return end;
  });

  return {
    stop(): void {
      ended.stopped = true;
      controller.abort();
    },
    done,
  };
}

/**
 * The error a caller gets when a stream is asked for on a runner that has no stream transport.
 *
 * NAMED RATHER THAN SILENT, because a console whose Stream button does nothing is the state this
 * repository keeps removing: a capability that is present in the type and absent in the artefact.
 *
 * @returns The error
 */
export function noStreamTransport(): RunnerError {
  return new RunnerError(
    'this runner was built without a stream transport, so it cannot open a stream',
    ErrorCode.RUN_NOT_AVAILABLE,
  );
}

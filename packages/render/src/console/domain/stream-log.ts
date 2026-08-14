/**
 * What a console keeps of a stream, which is not the stream.
 *
 * THE BOUND IS A WINDOW AND NOT A COUNT OF ELEMENTS, per SPEC 14.6. A stream of ten thousand
 * elements is an ordinary stream, and a console that held all of them would hold ten thousand
 * rows of state and ten thousand nodes for a reader who is looking at the last twenty. So the
 * last `windowSize` elements are kept and the rest are counted.
 *
 * WHAT FELL OUT IS COUNTED OUT LOUD. `dropped` exists so that whatever draws this can say the
 * sentence rather than pretend the stream began where the window does. Silent loss of data is
 * forbidden here for the same reason SPEC 14.8 forbids it for the broker bridge: a reader who
 * cannot tell a gap from a beginning is reading a different stream from the one that happened.
 *
 * IT IS PLAIN STATE AND NOT A COMPOSABLE, which is the same decision `doc-state.ts` records. A
 * ref belongs to whatever renders; what belongs here is the rule about what is kept.
 *
 * AND IT IS IN THE RENDERER RATHER THAN IN `@openref/vue`, WHICH IS A MEASUREMENT AND NOT A
 * PLACEMENT PREFERENCE. The headless layer is where a theme author writing their own console
 * would look for it, and it is also one bundled module that the entry imports for `RUNNER_KEY`,
 * so the bundler cannot split it: measured at T030, putting this there cost the first paint 270
 * bytes and took `client-js-raw` 45 bytes past its limit, for a function no reader who never
 * opens a console will ever call. Here it travels in the console's own chunk. It is the same
 * axis and the same answer as the sign in surface of T028, and T031 owns moving it back when the
 * package becomes public and can pay for it, with the pair measured before and after.
 */

import type { RunnerStreamElement, RunnerStreamEnd } from '@openref/vue';

/** How many elements a console keeps in view by default. */
export const DEFAULT_STREAM_WINDOW = 500;

/** What a reader is looking at, and what they are not. */
export interface StreamLogState {
  /** The last elements, oldest first, at most `windowSize` of them. */
  readonly elements: readonly RunnerStreamElement[];
  /** Every element the server sent, including the ones no longer held. */
  readonly received: number;
  /** How many of them did not match the declared item schema. */
  readonly invalid: number;
  /** How many have fallen out of the window, so the gap can be named. */
  readonly dropped: number;
  /** How it ended, once it has. */
  readonly end?: RunnerStreamEnd;
}

/** A bounded record of one stream. */
export interface StreamLog {
  /** What is currently held, as a value that can be read after every append. */
  state(): StreamLogState;
  /**
   * Adds one element, dropping the oldest when the window is full.
   *
   * @param element - What the runner delivered
   */
  append(element: RunnerStreamElement): void;
  /**
   * Records how the stream ended.
   *
   * @param end - The ending, as the runner reported it
   */
  finish(end: RunnerStreamEnd): void;
}

/**
 * Creates a bounded record of one stream.
 *
 * @param windowSize - How many elements to keep. Defaults to {@link DEFAULT_STREAM_WINDOW}
 * @returns The log
 *
 * @example
 * const log = createStreamLog(500);
 * log.append({ seq: 1, data: '{"id":1}' });
 */
export function createStreamLog(windowSize: number = DEFAULT_STREAM_WINDOW): StreamLog {
  const size = Math.max(1, Math.floor(windowSize));
  const elements: RunnerStreamElement[] = [];
  let received = 0;
  let invalid = 0;
  let dropped = 0;
  let end: RunnerStreamEnd | undefined;

  return {
    state(): StreamLogState {
      return {
        elements: [...elements],
        received,
        invalid,
        dropped,
        ...(end === undefined ? {} : { end }),
      };
    },

    append(element: RunnerStreamElement): void {
      received += 1;
      if (element.problem !== undefined) invalid += 1;

      elements.push(element);

      // ONE AT A TIME AND FROM THE FRONT, because the window is only ever exceeded by one: the
      // append that just happened. A splice of the whole overflow would be the same thing written
      // as if the window could be resized while a stream is running, which it cannot.
      if (elements.length > size) {
        elements.shift();
        dropped += 1;
      }
    },

    finish(value: RunnerStreamEnd): void {
      end = value;
    },
  };
}

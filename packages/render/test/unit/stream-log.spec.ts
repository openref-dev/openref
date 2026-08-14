import { describe, expect, it } from 'vitest';
import type { RunnerStreamElement } from '@openref/vue';
import { createStreamLog, DEFAULT_STREAM_WINDOW } from '../../src/console/domain/stream-log';

/**
 * What a console keeps of a stream.
 *
 * THE TEN THOUSAND ELEMENT CASE IS ABOUT WHAT IS NOT HELD. A stream of that length is ordinary
 * and the console has to stay the same size while it runs, so the assertion is on the window and
 * on the counts around it: the window is full, the counts are of the whole stream, and the
 * difference between them is a number the reader can be shown rather than a gap that reads as a
 * beginning.
 */

/**
 * One element, numbered.
 *
 * @param seq - Its position in the stream
 * @param problem - What is wrong with it, when anything is
 * @returns The element
 */
function element(seq: number, problem?: string): RunnerStreamElement {
  return {
    seq,
    data: `{"id":${String(seq)}}`,
    ...(problem === undefined ? {} : { problem }),
  };
}

describe('createStreamLog', () => {
  it('should keep the last window of a ten thousand element stream and count the rest', () => {
    // Given
    const log = createStreamLog(500);

    // When
    for (let seq = 1; seq <= 10_000; seq += 1) log.append(element(seq));
    const state = log.state();

    // Then
    expect(state.elements).toHaveLength(500);
    expect(state.received).toBe(10_000);
    expect(state.dropped).toBe(9500);
    expect(state.elements[0]?.seq).toBe(9501);
    expect(state.elements[499]?.seq).toBe(10_000);
  });

  it('should count an invalid element in the whole stream even after it has left the window', () => {
    // Given
    const log = createStreamLog(2);

    // When
    log.append(element(1, 'the property id is declared integer and this element carries string'));
    log.append(element(2));
    log.append(element(3));
    const state = log.state();

    // Then
    expect(state.invalid).toBe(1);
    expect(state.elements.map((held) => held.seq)).toEqual([2, 3]);
    expect(state.dropped).toBe(1);
  });

  it('should hold nothing more than the window even when the window is one', () => {
    // Given
    const log = createStreamLog(1);

    // When
    log.append(element(1));
    log.append(element(2));
    const state = log.state();

    // Then
    expect(state.elements.map((held) => held.seq)).toEqual([2]);
  });

  it('should record how the stream ended so the reader is told rather than left waiting', () => {
    // Given
    const log = createStreamLog();

    // When
    log.append(element(1));
    log.finish({ reason: 'timeout', received: 1, invalid: 0, message: 'nothing for 60000 ms' });
    const state = log.state();

    // Then
    expect(state.end?.reason).toBe('timeout');
    expect(DEFAULT_STREAM_WINDOW).toBe(500);
  });
});

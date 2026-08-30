import { describe, expect, it } from 'vitest';
import { BridgeService } from '../../src/index';
import { drain, FakeClock, FakeSource } from '../mocks/bridge';

/**
 * The acceptance evidence of `T056`: six million messages from a hostile producer, and a heap that
 * does not move.
 *
 * WHY THIS CASE EXISTS AND THE PER MODE CASES DO NOT REPLACE IT. "The bridge survives a hostile
 * producer with flat memory" is not a property anybody can read off the code, and it is not what
 * `bridge-service.spec.ts` measures: those cases prove that each rule does what it is named after,
 * over tens of messages. What can only be measured is whether the rules together hold a retained
 * set flat while a producer pushes millions through them, and that is measured here, against the
 * real ring, the real gate, a real `Readable` and a real consumer.
 *
 * TIME IS DRIVEN AND THE PRODUCER IS NOT PACED, WHICH IS SAID PLAINLY BECAUSE IT IS A CHOICE. SPEC
 * 14.8's own figure is ten thousand a second for ten minutes; what that costs on the wall is ten
 * minutes, and what it measures is retention across six million messages. The clock advances ten
 * virtual milliseconds per hundred messages, so the limiter sees exactly the arrival pattern it
 * would see in a process, and the six million allocations are real. A wall clock run of the same
 * shape would add six hundred seconds to the suite and not one new fact.
 *
 * THE HEAP FIGURE IS READ AS A MINIMUM PER WINDOW AND NOT AS AN INSTANT. `heapUsed` sawtooths
 * between collections, so a single reading says as much about when the last collection ran as
 * about what is retained; the minimum across a window of samples tracks the live set, because an
 * allocation heavy loop collects often. Where `--expose-gc` is available the collection is asked
 * for outright and the reading is exact; where it is not, the minimum is the honest substitute and
 * the bound below is set for that case.
 */

/** Messages offered per virtual step. A step is ten milliseconds, so this is ten thousand a second. */
const PER_STEP = 100;

/** Steps in the run. Sixty thousand steps of ten milliseconds is six hundred virtual seconds. */
const STEPS = 60_000;

/** Steps between one drain of the reader's stream and one heap sample. */
const SAMPLE_EVERY = 100;

/**
 * How far the retained set may move between the first tenth of the run and the last, in bytes.
 *
 * MEASURED RATHER THAN CHOSEN, on 2026-08-30, with `--expose-gc` unavailable and 600 samples: the
 * first decile minimum read 75,781,112 bytes, the last decile minimum 76,658,448, so the retained
 * set moved 877,336 bytes, 0.84 MB, across six million messages. The instantaneous peak over the
 * run was 141,467,040, which is the sawtooth between collections and is exactly why the minimum is
 * what is compared. The bound is 16 MB, nineteen times the reading and still far below what an
 * unbounded queue would show, since the payload text alone for six million of these messages is
 * about 240 MiB before any object header. It is a leak detector and not a memory budget, in the
 * sense F25 gives the phrase.
 */
const FLAT_WITHIN_BYTES = 16 * 1024 * 1024;

/**
 * The smallest reading in a window of samples.
 *
 * @param samples - Heap readings, in bytes
 * @returns The minimum, or zero when the window is empty
 */
function low(samples: readonly number[]): number {
  return samples.length === 0 ? 0 : Math.min(...samples);
}

describe('the broker bridge under a hostile producer', () => {
  it('should hold the limit and keep the heap flat across six million messages', async () => {
    // Given, the configuration SPEC 14.8 prints, with a connection ceiling above the run so that
    // what ends this subscription is the loop and not the ceiling
    const clock = new FakeClock();
    const source = new FakeSource();
    const bridge = new BridgeService('the soak mount', {
      enabled: true,
      channels: ['orders.created'],
      source,
      maxMessagesPerSecond: 50,
      bufferSize: 500,
      onOverflow: 'drop-oldest',
      maxConnectionSeconds: 3_600,
      maxConcurrentSubscriptions: 1,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });

    const collect = (globalThis as { gc?: () => void }).gc;
    const samples: number[] = [];
    let offered = 0;
    let messageFrames = 0;
    let dropNotices = 0;
    let lastNotice = '';

    const opened = await bridge.open('orders.created');
    expect(opened.refused).toBeUndefined();
    if (opened.session === undefined) throw new Error('the bridge refused the soak subscription');
    const live = opened.session;

    /** Takes what the stream wrote and counts the two kinds of frame a reader sees. */
    const readOut = (): void => {
      for (const block of drain(live.stream).split('\n\n')) {
        if (block.includes('event: message')) messageFrames += 1;
        if (!block.includes('event: dropped')) continue;
        dropNotices += 1;
        lastNotice = block;
      }
    };

    // When, six hundred virtual seconds of ten thousand messages a second
    for (let step = 0; step < STEPS; step += 1) {
      for (let message = 0; message < PER_STEP; message += 1) {
        offered += 1;
        source.emit(`{"seq":${String(offered)},"channel":"orders.created"}`);
      }
      clock.advance(10);

      if (step % SAMPLE_EVERY !== 0) continue;

      readOut();
      collect?.();
      samples.push(process.memoryUsage().heapUsed);
    }
    readOut();

    // Then, the producer really produced, which is what makes every number below a measurement
    const counts = live.counts();
    expect(offered).toBe(PER_STEP * STEPS);
    expect(counts.received).toBe(PER_STEP * STEPS);

    // And the debit reconciles exactly: nothing vanished without being counted
    expect(counts.delivered + counts.dropped + counts.buffered).toBe(counts.received);

    // And the limit held, to the message. Six hundred seconds at fifty a second, plus the one
    // second of burst `RateGate` starts with and records that it starts with.
    expect(counts.delivered).toBe(50 * 600 + 50);
    expect(counts.dropped).toBe(counts.received - counts.delivered - counts.buffered);

    // And the queue never grew past the ring, which is the whole of why the heap can be flat
    expect(counts.buffered).toBeLessThanOrEqual(500);

    // And what the reader actually received matches what the counters claim, so the delivery
    // figure is a fact about the stream rather than about a variable
    expect(messageFrames).toBe(counts.delivered);

    // And the reader was told about the loss in the stream it is watching, rather than left to
    // infer it from a gap in a sequence number, which is what SPEC 19.8 forbids
    expect(counts.dropped).toBeGreaterThan(5_900_000);
    expect(dropNotices).toBeGreaterThan(500);
    expect(dropNotices).toBeLessThan(counts.delivered);
    expect(lastNotice).toMatch(/"total":\d{7}/);

    // And the heap is flat: the live set at the end of the run is where it was near the start
    const tenth = Math.max(1, Math.floor(samples.length / 10));
    const first = low(samples.slice(0, tenth));
    const last = low(samples.slice(-tenth));
    expect(samples.length).toBeGreaterThan(500);
    expect(first).toBeGreaterThan(0);
    expect(last - first).toBeLessThan(FLAT_WITHIN_BYTES);

    live.close('the soak is over');
    expect(bridge.liveSubscriptions).toBe(0);
    expect(clock.armed).toBe(0);
    // THE TIMEOUT IS A HANG CATCHER AND NOT A BUDGET, per F25, and it is declared because this
    // case is the class F25 names rather than the class vitest's default was chosen for. MEASURED
    // on 2026-08-30, and as a range because a point figure here is a property of the machine
    // rather than of the subject: six million messages through the ring, the gate and the stream
    // cost between about 0.6 and 1.1 seconds across the workstations this has run on, comfortably
    // inside vitest's own default. The declaration is for the machine an order of magnitude slower
    // than any of them, and nothing here should be tuned against either end of that range.
  }, 120_000);
});

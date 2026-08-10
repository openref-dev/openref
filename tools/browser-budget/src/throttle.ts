/**
 * Proving that the CPU throttle asked for is the CPU throttle applied.
 *
 * THIS EXISTS BECAUSE THE ALTERNATIVE IS A FICTION. `Emulation.setCPUThrottlingRate` is a
 * request, and a browser that ignored it, clamped it, or applied it to a thread other than the
 * one the page runs on would answer the call successfully and then hand back a figure measured
 * at full speed. Every number after that would be wrong in the direction that looks good, and
 * nothing would say so. So the rate is measured before it is trusted, on every run, and a rate
 * that did not take is a hard failure rather than a warning.
 *
 * THE FIRST VERSION OF THIS FILE COULD NOT TELL A THROTTLE FROM A COLD OPTIMIZER, and the
 * runner caught it on the first study: 4x requested, 0.81x measured, the throttled sample
 * faster than the unthrottled one. It timed the workload once unthrottled and once throttled,
 * so the unthrottled sample paid for compiling the loop and the throttled sample ran the
 * compiled version. On a workstation the loop dwarfed the compile and the ratio looked right;
 * on a slower shared machine the compile dominated and the check reported the opposite of the
 * truth. Warm up first, take several samples of each condition, and compare the fastest of
 * each, because the fastest sample is the one least contaminated by everything else on the
 * machine.
 *
 * IT ALSO MEASURES UNTHROTTLED TWICE, before and after. A machine that simply got slower half
 * way through would otherwise read as a throttle that took, and the check would pass for the
 * wrong reason on exactly the runs where the numbers are least trustworthy.
 *
 * WHAT THE 4x IS RELATIVE TO. CDP throttling is relative to the host CPU: it stalls the
 * renderer's main thread so that a unit of work takes four times as long as it takes on that
 * machine. It is not a fixed reference device. A figure from a GitHub runner and a figure from
 * a workstation are therefore two different measurements, and every record this package writes
 * names the machine it came from for that reason.
 */

import type { CDPSession, Page } from 'playwright-core';

/** The rate SPEC 20 budgets TTI under. */
export const THROTTLE_RATE = 4;

/**
 * How far the measured slowdown may sit from the rate asked for.
 *
 * Wide, because the check is not a calibration. It has to separate "applied" from "ignored"
 * (a ratio near 1) and from "clamped to something else" (a ratio near 2, or near the number of
 * cores), and it must not fire on a busy runner that happened to schedule one sample badly.
 * Anything inside this band is the throttle working; anything outside it is a measurement
 * nobody should read.
 */
export const THROTTLE_TOLERANCE = { min: 2.8, max: 6.0 } as const;

/**
 * How far the two unthrottled measurements may drift from each other.
 *
 * They bracket the throttled one in time. If the machine changed speed between them by more
 * than this, the ratio is not a measurement of the throttle and nothing here is worth reading.
 */
export const DRIFT_TOLERANCE = 2;

/** Samples taken of each condition. The fastest of each is what is compared. */
const SAMPLES = 3;

/** What the verification found. */
export interface ThrottleVerification {
  readonly rate: number;
  /** Fastest unthrottled sample, taken before the throttle was applied. */
  readonly unthrottledMs: number;
  /** Fastest unthrottled sample, taken after the throttle was lifted again. */
  readonly recheckMs: number;
  readonly throttledMs: number;
  /** Measured slowdown, which is what the rate claims to be. */
  readonly ratio: number;
  readonly iterations: number;
}

/**
 * Runs a fixed arithmetic workload in the page and reports how long it took.
 *
 * The accumulator is written to a global so that nothing in the chain, from the optimizer to
 * the serializer, is free to discard the loop. A workload that was optimized away would time
 * at zero under both conditions and produce a ratio of one, which reads exactly like a
 * throttle that was ignored.
 *
 * @param page - Page to run in
 * @param iterations - Loop length
 * @returns Wall clock milliseconds
 */
async function busyMs(page: Page, iterations: number): Promise<number> {
  return page.evaluate((count: number) => {
    const started = performance.now();
    let accumulator = 0;
    for (let index = 0; index < count; index += 1) {
      accumulator += Math.sqrt(index) * Math.sin(index);
    }
    (globalThis as unknown as { __openrefBusy?: number }).__openrefBusy = accumulator;

    return performance.now() - started;
  }, iterations);
}

/**
 * The fastest of several runs of the same workload.
 *
 * @param page - Page to run in
 * @param iterations - Loop length
 * @returns The lowest time seen
 */
async function fastestMs(page: Page, iterations: number): Promise<number> {
  let best = Number.POSITIVE_INFINITY;

  for (let sample = 0; sample < SAMPLES; sample += 1) {
    best = Math.min(best, await busyMs(page, iterations));
  }

  return best;
}

/**
 * Finds a loop length that takes long enough to time reliably, with the optimizer warm.
 *
 * A workload of a millisecond or two cannot tell a fourfold slowdown from scheduling noise, so
 * the length is grown until a warm unthrottled run is comfortably above the timer's
 * resolution.
 *
 * @param page - Page to calibrate in
 * @returns The loop length and what a warm run costs unthrottled
 */
async function calibrate(page: Page): Promise<{ iterations: number; ms: number }> {
  let iterations = 200_000;

  for (let attempt = 0; attempt < 14; attempt += 1) {
    const ms = await fastestMs(page, iterations);
    if (ms >= 25) return { iterations, ms };
    iterations *= 2;
  }

  throw new Error(
    'could not find a workload that takes 25 ms unthrottled; the page is not executing the loop',
  );
}

/**
 * Applies the throttle and proves it took.
 *
 * @param page - Page to measure in
 * @param session - Its CDP session
 * @param rate - Slowdown factor to request
 * @returns What was measured
 * @throws Error when the measured slowdown is outside {@link THROTTLE_TOLERANCE}, or when the
 *   machine's own speed drifted too far between the two unthrottled measurements
 */
export async function applyVerifiedThrottle(
  page: Page,
  session: CDPSession,
  rate: number = THROTTLE_RATE,
): Promise<ThrottleVerification> {
  await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  // Warm the workload before anything is timed. The first execution of this loop compiles it,
  // and a compile counted as work is the defect this file was rewritten for.
  await busyMs(page, 200_000);
  const baseline = await calibrate(page);

  await session.send('Emulation.setCPUThrottlingRate', { rate });
  const throttledMs = await fastestMs(page, baseline.iterations);

  await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const recheckMs = await fastestMs(page, baseline.iterations);

  const drift = Math.max(baseline.ms, recheckMs) / Math.min(baseline.ms, recheckMs);
  if (drift > DRIFT_TOLERANCE) {
    throw new Error(
      `the machine changed speed while the throttle was being verified: ${baseline.ms.toFixed(1)} ms ` +
        `before and ${recheckMs.toFixed(1)} ms after, a factor of ${drift.toFixed(2)}. ` +
        'Nothing measured under that is comparable with anything.',
    );
  }

  // The lower of the two unthrottled measurements, because the throttle can only make work
  // slower, so the fastest unthrottled sample is the most honest reference for it.
  const unthrottled = Math.min(baseline.ms, recheckMs);
  const ratio = throttledMs / unthrottled;

  // Restore the rate the caller asked for. The recheck lifted it, and a navigation that ran
  // unthrottled after a verification that said otherwise is the same fiction one step along.
  await session.send('Emulation.setCPUThrottlingRate', { rate });

  if (ratio < THROTTLE_TOLERANCE.min || ratio > THROTTLE_TOLERANCE.max) {
    throw new Error(
      `Emulation.setCPUThrottlingRate was asked for ${String(rate)}x and delivered ` +
        `${ratio.toFixed(2)}x: ${unthrottled.toFixed(1)} ms unthrottled against ` +
        `${throttledMs.toFixed(1)} ms throttled over ${String(baseline.iterations)} iterations. ` +
        'Every figure measured under a throttle that did not take is a fiction, so this is a ' +
        'failure rather than a measurement.',
    );
  }

  return {
    rate,
    unthrottledMs: baseline.ms,
    recheckMs,
    throttledMs,
    ratio,
    iterations: baseline.iterations,
  };
}

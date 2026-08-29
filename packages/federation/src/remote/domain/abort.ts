/**
 * Turning an `AbortSignal` into something a race can lose to.
 *
 * ONE IMPLEMENTATION, BECAUSE TWO PLACES ENFORCE THE SAME DEADLINE. The lifecycle aborts the
 * signal at its timeout and must stop waiting on a fetcher that ignores it; the fetch adapter must
 * stop reading a body that is still arriving when that happens. Both need the same thing, and two
 * copies of it is how one of them comes to keep waiting after the other gave up.
 */

/**
 * A promise that rejects with the signal's reason when it aborts, and never resolves.
 *
 * THE LISTENER IS ADDED ONCE, WHICH MATTERS WHERE THE RESULT IS RACED IN A LOOP. A body read races
 * this against every chunk, and a promise that registered a listener per call would add one per
 * chunk of the document.
 *
 * @param signal - The signal to watch
 * @returns A promise that only ever rejects
 */
export function abortedPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    signal.addEventListener(
      'abort',
      () => {
        reject(abortReason(signal));
      },
      { once: true },
    );
  });
}

/**
 * The reason an abort carried, as an error.
 *
 * The lifecycle aborts with the project error naming its timeout, so passing the reason through is
 * what keeps the recorded failure the one that was decided rather than a generic cancellation.
 *
 * @param signal - The aborted signal
 * @returns The reason when it is an error, and an error carrying it otherwise
 */
export function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error(String(reason));
}

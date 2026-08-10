/**
 * The spread of a set of measurements.
 *
 * A single browser figure says nothing on its own: the question a budget has to answer is
 * whether a change moved the number or whether the machine did, and only the run to run spread
 * can tell those apart. So every figure this package commits carries the spread it was taken
 * with, and the relative check is written in terms of it rather than in terms of a percentage
 * somebody liked the look of.
 */

/** What a set of samples looks like. */
export interface Spread {
  readonly samples: readonly number[];
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly median: number;
  readonly mean: number;
  /** Sample standard deviation, Bessel corrected. Zero for a single sample. */
  readonly standardDeviation: number;
  /** `max - min`, in the unit of the samples. */
  readonly range: number;
  /** `range / median`, as a fraction. */
  readonly relativeRange: number;
}

/**
 * Summarises a set of samples.
 *
 * @param values - The samples, in any order
 * @returns The spread
 * @throws Error when there are no samples, because an empty summary would report zeros that
 *   look like a fast page
 */
export function spreadOf(values: readonly number[]): Spread {
  if (values.length === 0) throw new Error('a spread needs at least one sample');

  const sorted = [...values].sort((left, right) => left - right);
  const count = sorted.length;
  const min = sorted[0] ?? 0;
  const max = sorted[count - 1] ?? 0;

  const middle = Math.floor(count / 2);
  const median =
    count % 2 === 1
      ? (sorted[middle] ?? 0)
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;

  const mean = sorted.reduce((total, value) => total + value, 0) / count;

  const variance =
    count < 2 ? 0 : sorted.reduce((total, value) => total + (value - mean) ** 2, 0) / (count - 1);

  return {
    samples: sorted,
    count,
    min,
    max,
    median,
    mean,
    standardDeviation: Math.sqrt(variance),
    range: max - min,
    relativeRange: median === 0 ? 0 : (max - min) / median,
  };
}

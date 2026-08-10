import { gzipSync } from 'node:zlib';

/**
 * Size measurement of one built artifact.
 */
export interface ArtifactMeasurement {
  /** Repository relative path. */
  readonly path: string;
  readonly rawBytes: number;
  readonly gzipBytes: number;
}

/**
 * Which quantity a budget bounds.
 *
 * NAMED RATHER THAN ASSUMED, per SPEC 0. `transfer` is what a host serves and a CDN bills;
 * `parse` is what the main thread decodes and then has to do something with. For the theme
 * stylesheets the two differ by a factor of 5.97, and a budget that measured only the first
 * reported 6.3 KB of 15 while nothing bounded the 38.8 KB the browser walked.
 */
export type BudgetQuantity = 'transfer' | 'parse';

/**
 * Outcome of comparing measured artifacts against a limit.
 */
export interface BudgetEvaluation {
  readonly ok: boolean;
  readonly quantity: BudgetQuantity;
  /** Sum of the quantity this budget names, not of some other one. */
  readonly totalBytes: number;
  readonly limitBytes: number;
  readonly overBy: number;
}

/**
 * Measures the gzip size of a buffer at the level used by static hosts.
 *
 * @param content - Raw artifact bytes
 * @returns Size in bytes after gzip at level 9
 */
export function gzipSizeOf(content: Buffer): number {
  return gzipSync(content, { level: 9 }).byteLength;
}

/**
 * Compares the summed size of a set of artifacts against a limit, in one named quantity.
 *
 * @param limitBytes - Budget in bytes
 * @param measurements - Artifacts that make up the budgeted bundle
 * @param quantity - Which size the limit is about, transferred or decoded
 * @returns Evaluation carrying the total and the overshoot
 */
export function evaluateBudget(
  limitBytes: number,
  measurements: readonly ArtifactMeasurement[],
  quantity: BudgetQuantity = 'transfer',
): BudgetEvaluation {
  const totalBytes = measurements.reduce(
    (sum, item) => sum + (quantity === 'parse' ? item.rawBytes : item.gzipBytes),
    0,
  );
  const overBy = Math.max(0, totalBytes - limitBytes);

  return {
    ok: totalBytes <= limitBytes,
    quantity,
    totalBytes,
    limitBytes,
    overBy,
  };
}

/**
 * Formats a byte count for gate output.
 *
 * @param bytes - Byte count
 * @returns Human readable size using binary kilobytes
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

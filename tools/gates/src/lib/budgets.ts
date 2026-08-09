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
 * Outcome of comparing measured artifacts against a limit.
 */
export interface BudgetEvaluation {
  readonly ok: boolean;
  readonly totalGzipBytes: number;
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
 * Compares the summed gzip size of a set of artifacts against a limit.
 *
 * @param limitBytes - Budget in bytes
 * @param measurements - Artifacts that make up the budgeted bundle
 * @returns Evaluation carrying the total and the overshoot
 */
export function evaluateBudget(
  limitBytes: number,
  measurements: readonly ArtifactMeasurement[],
): BudgetEvaluation {
  const totalGzipBytes = measurements.reduce((sum, item) => sum + item.gzipBytes, 0);
  const overBy = Math.max(0, totalGzipBytes - limitBytes);

  return {
    ok: totalGzipBytes <= limitBytes,
    totalGzipBytes,
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

import type { IRDriftIssue, IRDriftSeverity } from './runtime.types';

/**
 * Documentation Health, per SPEC 7.2.
 *
 * One check answers one question over the whole document, for example "how many operations
 * have a stable operationId". The score is derived from the checks, never entered by hand.
 */
export interface IRHealthCheck {
  /** Stable identifier, used by `--fail-on` and by the UI. */
  readonly id: string;
  readonly label: string;
  readonly passed: number;
  readonly total: number;
  readonly severity: IRDriftSeverity;
}

/** Health report for one document. */
export interface IRHealthReport {
  /** Whole percentage points, 0 to 100. */
  readonly score: number;
  readonly operationCount: number;
  readonly checks: readonly IRHealthCheck[];
  readonly drift: readonly IRDriftIssue[];
}

/**
 * Outcome of a single gate.
 *
 * `skip` means the gate had nothing to check yet, for example a size budget whose
 * artifact is produced by a later milestone. A skip is always printed, never hidden,
 * so that a missing artifact can never be mistaken for a passing check.
 */
export type GateStatus = 'pass' | 'fail' | 'skip';

/**
 * Severity of a single message produced by a gate.
 */
export type FindingLevel = 'error' | 'warning' | 'info';

/**
 * One message produced by a gate.
 */
export interface GateFinding {
  readonly level: FindingLevel;
  readonly message: string;
}

/**
 * Result of running one gate.
 */
export interface GateResult {
  readonly id: string;
  readonly title: string;
  readonly status: GateStatus;
  readonly findings: readonly GateFinding[];
}

/**
 * Environment handed to every gate.
 */
export interface GateContext {
  /** Absolute path to the repository root. */
  readonly repoRoot: string;
}

/**
 * A committed CI gate.
 *
 * Gates are never relaxed to make a build pass. A red gate means the code is wrong.
 */
export interface Gate {
  readonly id: string;
  readonly title: string;
  run(context: GateContext): Promise<GateResult>;
}

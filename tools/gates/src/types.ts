/**
 * Outcome of a single gate.
 *
 * `skip` means the gate had nothing to check yet, for example a size budget whose
 * artifact is produced by a later milestone. A skip is always printed, never hidden,
 * so that a missing artifact can never be mistaken for a passing check.
 */
export type GateStatus = 'pass' | 'fail' | 'skip';

/**
 * Why a gate checked nothing.
 *
 * A SKIP THAT HAPPENS FOR THE WRONG REASON LOOKS IDENTICAL TO THE RIGHT ONE while the only
 * record of the cause is prose in a finding. `SKIP theme-motion` in the summary reads the same
 * whether the maintainer's private documents are absent, which is expected on every clone, or
 * whether the stylesheets stopped being produced, which is a defect. Naming the cause is what
 * lets `accountForSkips` tell them apart on a machine that has neither.
 *
 * - `ai-docs-absent`: the maintainer's private documents are not in this checkout
 * - `artifact-absent`: what the gate weighs or scans has not been built yet
 */
export type SkipReasonId = 'ai-docs-absent' | 'artifact-absent';

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

  /**
   * Why the gate checked nothing. Required whenever `status` is `skip`.
   *
   * It is optional in the type and mandatory in the run: `accountForSkips` fails a skip that
   * names no reason, so a new gate cannot skip silently even though the compiler admits it.
   * A discriminated union would move that to compile time and was not taken, because it would
   * restructure all fourteen gates for a check the first run already makes.
   */
  readonly skipReason?: SkipReasonId;
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

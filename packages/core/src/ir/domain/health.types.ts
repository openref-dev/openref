import type { IRDriftIssue, IRDriftRule, IRDriftSeverity } from './runtime.types';

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

/**
 * One class of finding the host decided not to fix, per SPEC 7.2.
 *
 * THE KEY IS THE KEBAB RULE ID AND NOT THE DISPLAY CODE, for the reason `IRDriftRule` exists: the
 * kebab is the identifier, it is hashed, and it never changes, while `DX030` is what the interface
 * prints. Typing the key in the closed union is what turns a misspelled class into a compile error
 * at the host instead of a suppression that quietly matches nothing.
 */
export interface IRHealthSuppressedClass {
  readonly rule: IRDriftRule;
  /**
   * Why the host decided not to fix it, which is refused at boot when it is missing or empty.
   *
   * A SUPPRESSION WITHOUT A REASON IS THE SILENT LIE THIS OPTION EXISTS TO PREVENT. The whole
   * argument for suppressing a class is that somebody looked at it and decided; a list of rule ids
   * with nothing beside them is indistinguishable from a list somebody pasted.
   */
  readonly reason: string;
  /** Severity of the rule, which is what decides the inversion of SPEC 7.2. */
  readonly severity: IRDriftSeverity;
  /**
   * How many findings this class actually took out of `drift`.
   *
   * ZERO IS LEGAL AND IS REPORTED RATHER THAN DROPPED. A class can be legitimately empty on one
   * deployment, so it does not refuse boot; it is printed with its zero because the day the class
   * comes back it starts suppressing with nobody told.
   */
  readonly matched: number;
}

/**
 * What suppression did to a report, per SPEC 7.2.
 *
 * THE FINDINGS MOVED HERE AND WERE NOT DELETED, which is what makes `drift.length` plus
 * `findings.length` the whole, with no stored total that could disagree with its own parts.
 */
export interface IRHealthSuppression {
  /** The classes the host named, in the order they were written. */
  readonly classes: readonly IRHealthSuppressedClass[];
  /** The findings that left `drift`, in report order. */
  readonly findings: readonly IRDriftIssue[];
  /** The score with the suppressed classes left out, which is what the checks support. */
  readonly suppressedScore: number;
  /** The score with them counted back in. */
  readonly unsuppressedScore: number;
  /**
   * True while any suppressed class is severity `error`, per SPEC 7.2.
   *
   * WHEN IT IS TRUE, {@link IRHealthReport.score} CARRIES `unsuppressedScore`. Nothing stops a
   * host suppressing `security-drift`, deliberately, because a prohibition would remove the escape
   * from the case the option exists for: a host whose authorisation is enforced by a gateway this
   * package cannot see, where the rule fires falsely on every route. What is refused instead is
   * the headline, so suppressing a note buys a cleaner list and a better number and suppressing an
   * error buys a cleaner list and nothing else.
   */
  readonly inverted: boolean;
}

/** Health report for one document. */
export interface IRHealthReport {
  /**
   * Whole percentage points, 0 to 100, and THE PRIMARY NUMBER rather than the plain one.
   *
   * WITH NO SUPPRESSION IT IS EXACTLY WHAT IT ALWAYS WAS. With suppression it is the suppressed
   * score, and while any suppressed class is severity `error` it inverts and carries the
   * unsuppressed one, per {@link IRHealthSuppression.inverted}. The primary rides in this member
   * rather than beside it on purpose: every surface that already reads `score` then prints the
   * honest figure without being told, and there is no member anywhere holding `100%` for a
   * document whose errors were suppressed, so no theme and no consumer written tomorrow can make
   * it the headline by reading the obvious field.
   */
  readonly score: number;
  readonly operationCount: number;
  readonly checks: readonly IRHealthCheck[];
  /**
   * The findings, minus any the host suppressed.
   *
   * Absent from here means present in {@link IRHealthSuppression.findings}, never absent from the
   * report, which is what lets every counter that recomputes a length follow for free.
   */
  readonly drift: readonly IRDriftIssue[];
  /** What suppression did, when the host configured any. Absent means none was configured. */
  readonly suppression?: IRHealthSuppression;
}

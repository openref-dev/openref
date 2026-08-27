/**
 * The exit code contract, frozen from `T036` onward per BUILD.md: every later task in M3 and
 * every CI integration reads these three values and none of the others.
 */
export const EXIT_CODE = {
  /** Nothing to report. */
  SUCCESS: 0,
  /** The command ran and found something: drift, a lint violation, a breaking diff. */
  FINDINGS: 1,
  /** The command could not run at all: a bad flag, a missing file, an application that would not boot. */
  USAGE_ERROR: 2,
} as const;

/** One of the three frozen exit codes. */
export type ExitCode = (typeof EXIT_CODE)[keyof typeof EXIT_CODE];

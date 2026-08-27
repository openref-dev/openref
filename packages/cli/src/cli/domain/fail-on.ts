import type { IRDriftSeverity } from '@openref/core';

/**
 * `--fail-on` values, per SPEC 17, most inclusive first.
 *
 * OMITTED MEANS `doctor` NEVER FAILS. The flag is what lets a team gate on a threshold it can act
 * on today rather than everything at once, and a first run in a pipeline that has never seen this
 * command before should see the report, not an unexpected red build. `lint` has no such flag and
 * fails on any finding at all, because its rule set is deliberately the small, always-actionable
 * one of SPEC 7.1's quality group.
 */
export const FAIL_ON_LEVELS = ['drift', 'warn', 'error'] as const;

/** One of the three `--fail-on` values. */
export type FailOnLevel = (typeof FAIL_ON_LEVELS)[number];

/** Reports whether a string is one of the three values SPEC 17 lists for `--fail-on`. */
export function isFailOnLevel(value: string): value is FailOnLevel {
  return (FAIL_ON_LEVELS as readonly string[]).includes(value);
}

/**
 * Whether a finding of the given severity should fail the build at the given `--fail-on` level.
 *
 * CUMULATIVE, LOUDEST TO QUIETEST. `error` counts only `error` severity findings; `warn` adds
 * `warning`; `drift` counts anything at all, including `info`, which is the same reading `doctor`
 * gives when the flag is omitted except that omitted never fails regardless of what this returns.
 *
 * @param severity - Severity of one finding
 * @param level - The configured `--fail-on` threshold
 * @returns True when a finding at this severity should cause exit code 1 at this threshold
 */
export function meetsFailOnThreshold(severity: IRDriftSeverity, level: FailOnLevel): boolean {
  if (level === 'error') return severity === 'error';
  if (level === 'warn') return severity === 'error' || severity === 'warning';

  return true;
}

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
 * How loud each severity is, loudest first, as a total record over the severity union.
 *
 * WRITTEN AS A RANK AFTER THE PRE-M4 REVIEW, AND THE SPELLING IS THE POINT. The threshold used to
 * be three hand written comparisons, `level === 'error'` returning `severity === 'error'` and so
 * on, which is a rule that reads correctly for the three severities that exist and answers wrongly
 * for any fourth. A `critical` added above `error` would be admitted by `--fail-on=drift`, which
 * counts everything, and silently dropped by `--fail-on=error`, which names its one severity
 * instead of asking which are at least as loud: the loudest severity in the product would be the
 * one the strictest threshold ignored. A total record does not compile until a new severity is
 * ranked, and the comparison below then places it without another edit.
 */
const SEVERITY_RANK: Readonly<Record<IRDriftSeverity, number>> = {
  error: 0,
  warning: 1,
  info: 2,
};

/**
 * How quiet a finding may be and still count, per threshold, as a total record over the levels.
 *
 * `drift` floors at the quietest rank there is rather than at `info` by name, because its own
 * sentence is "counts anything at all". Naming `info` there would have made a severity quieter
 * than `info` fall out of the threshold that promises to catch everything.
 */
const LEVEL_FLOOR: Readonly<Record<FailOnLevel, number>> = {
  error: SEVERITY_RANK.error,
  warn: SEVERITY_RANK.warning,
  drift: Math.max(...Object.values(SEVERITY_RANK)),
};

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
  return SEVERITY_RANK[severity] <= LEVEL_FLOOR[level];
}

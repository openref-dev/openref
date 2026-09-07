import {
  groupDriftByRule,
  healthScoreMark,
  type DriftRuleGroup,
  type IRDriftIssue,
  type IRDriftRule,
  type IRHealthCheck,
  type IRHealthReport,
  type IRHealthSuppression,
} from '@openref/core';
import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import { useDocState } from '../state/api/context';

/**
 * Documentation Health, per SPEC 7.2 and 7.3.
 *
 * The report is produced by the drift engine of M1. A document nothing measured has none, and
 * `available` says so rather than a score of zero being shown, which would read as "this
 * documentation is bad" instead of "nothing measured it".
 *
 * A FAILED COLLECTOR IS A CHECK AND NEVER A FINDING, per SPEC 7. It arrives in `checks` as
 * `runtime-collectors` and it is not in `drift`, because a drift row sends a reader to edit their
 * own code and a defect in this package is not something they can fix there. The two are easiest
 * to confuse exactly here, where they would be drawn as neighbouring rows.
 */
export interface UseHealth {
  readonly report: ComputedRef<IRHealthReport | undefined>;
  readonly available: ComputedRef<boolean>;
  /**
   * Whole percentage points, or `undefined` when nothing measured the document.
   *
   * IT IS THE PRIMARY NUMBER, per SPEC 7.2, so printing it bare is incomplete and never a lie.
   * With a suppressed `error` class the report inverts and this member carries the UNSUPPRESSED
   * percentage, which is why there is no reachable member anywhere holding the flattering figure.
   * {@link UseHealth.scoreMark} is the same number with the other one beside it.
   */
  readonly score: ComputedRef<number | undefined>;
  /**
   * The percentage as every surface prints it, parenthesis and all.
   *
   * `88% (77% unsuppressed)` or `77% (100% suppressed)`, built once in `@openref/core`. A theme
   * that renders this renders both halves or neither, which is the point of it being a string.
   * Plain `77%` on a document nothing was suppressed on, and the empty string when nothing
   * measured the document at all, which is what `available` is for.
   */
  readonly scoreMark: ComputedRef<string>;
  /** What the host suppressed, per SPEC 7.2, or `undefined` when nothing was. */
  readonly suppression: ComputedRef<IRHealthSuppression | undefined>;
  readonly checks: ComputedRef<readonly IRHealthCheck[]>;
  readonly drift: ComputedRef<readonly IRDriftIssue[]>;
  /**
   * The findings grouped by the rule that produced them, loudest first.
   *
   * THE PANEL HAS TO WORK AT FOUR HUNDRED FINDINGS AND AT TWO. Four hundred findings are still at
   * most ten rules, so this is what a panel lists; the findings of one rule are what a reader
   * opens.
   */
  readonly byRule: ComputedRef<readonly DriftRuleGroup[]>;
  /** How many findings each rule produced, for a filter that shows a count beside a name. */
  readonly counts: ComputedRef<ReadonlyMap<IRDriftRule, number>>;
}

/**
 * @returns The health report
 * @throws {ThemeContractError} When no state was provided above
 *
 * @example
 * const { score, byRule } = useHealth();
 */
export function useHealth(): UseHealth {
  const state = useDocState();
  const report = computed(() => state.document.value.health);
  const byRule = computed(() => groupDriftByRule(report.value?.drift ?? []));

  return {
    report,
    available: computed(() => report.value !== undefined),
    score: computed(() => report.value?.score),
    scoreMark: computed(() => {
      const own = report.value;

      return own === undefined ? '' : healthScoreMark(own);
    }),
    suppression: computed(() => report.value?.suppression),
    checks: computed(() => report.value?.checks ?? []),
    drift: computed(() => report.value?.drift ?? []),
    byRule,
    counts: computed(() => new Map(byRule.value.map((group) => [group.rule, group.issues.length]))),
  };
}

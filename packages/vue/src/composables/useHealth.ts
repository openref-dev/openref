import {
  groupDriftByRule,
  type DriftRuleGroup,
  type IRDriftIssue,
  type IRDriftRule,
  type IRHealthCheck,
  type IRHealthReport,
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
  /** Whole percentage points, or `undefined` when nothing measured the document. */
  readonly score: ComputedRef<number | undefined>;
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
    checks: computed(() => report.value?.checks ?? []),
    drift: computed(() => report.value?.drift ?? []),
    byRule,
    counts: computed(() => new Map(byRule.value.map((group) => [group.rule, group.issues.length]))),
  };
}

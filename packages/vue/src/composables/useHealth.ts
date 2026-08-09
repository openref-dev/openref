import type { IRDriftIssue, IRHealthCheck, IRHealthReport } from '@openref/core';
import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import { useDocState } from '../state/api/context';

/**
 * Documentation Health, per SPEC 7.2.
 *
 * The report is produced by the drift engine in M1. Until then there is none, and `available`
 * says so rather than a score of zero being shown, which would read as "this documentation is
 * bad" instead of "nothing measured it".
 */
export interface UseHealth {
  readonly report: ComputedRef<IRHealthReport | undefined>;
  readonly available: ComputedRef<boolean>;
  /** Whole percentage points, or `undefined` when nothing measured the document. */
  readonly score: ComputedRef<number | undefined>;
  readonly checks: ComputedRef<readonly IRHealthCheck[]>;
  readonly drift: ComputedRef<readonly IRDriftIssue[]>;
}

/**
 * @returns The health report
 * @throws {ThemeContractError} When no state was provided above
 *
 * @example
 * const { score, available } = useHealth();
 */
export function useHealth(): UseHealth {
  const state = useDocState();
  const report = computed(() => state.document.value.health);

  return {
    report,
    available: computed(() => report.value !== undefined),
    score: computed(() => report.value?.score),
    checks: computed(() => report.value?.checks ?? []),
    drift: computed(() => report.value?.drift ?? []),
  };
}

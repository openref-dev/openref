import type { IRDriftIssue, IRGuard, IRNodeRuntime, IRRuntimeMeta } from '@openref/core';
import { computed } from 'vue';
import type { ComputedRef, MaybeRefOrGetter } from 'vue';
import { useDocState } from '../state/api/context';
import { useNode } from './useNode';

/**
 * Runtime facts about one node, per SPEC 6.
 *
 * The IR carries the shape from M0 and the collectors that fill it arrive in M1, so this
 * composable is real and finds nothing until then. `available` says which of the two is
 * happening. A theme must not read that as "this endpoint has no guards": absent facts and
 * facts that say nothing are different claims, and only the collectors can tell them apart.
 */
export interface UseRuntime {
  readonly runtime: ComputedRef<IRNodeRuntime | undefined>;
  /** Whether any collector ran for this document at all. */
  readonly available: ComputedRef<boolean>;
  readonly guards: ComputedRef<readonly IRGuard[]>;
  readonly drift: ComputedRef<readonly IRDriftIssue[]>;
  /** Document wide collector metadata, for a panel that reports what ran. */
  readonly meta: ComputedRef<IRRuntimeMeta | undefined>;
}

/**
 * @param id - Node id, or nothing to follow the current selection
 * @returns The runtime facts of that node
 * @throws {ThemeContractError} When no state was provided above
 *
 * @example
 * const { guards, available } = useRuntime();
 */
export function useRuntime(id?: MaybeRefOrGetter<string | undefined>): UseRuntime {
  const state = useDocState();
  const { node } = useNode(id);

  const runtime = computed(() => node.value?.node.runtime);

  return {
    runtime,
    available: computed(() => state.document.value.runtime !== undefined),
    guards: computed(() => runtime.value?.guards ?? []),
    drift: computed(() => runtime.value?.drift ?? []),
    meta: computed(() => state.document.value.runtime),
  };
}

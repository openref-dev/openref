import { ErrorCode, RunnerError } from '@openref/core';
import { computed } from 'vue';
import type { ComputedRef, MaybeRefOrGetter } from 'vue';
import { useNode } from './useNode';

/**
 * The try-it runner, per SPEC 13. Arrives in M2.
 *
 * The signature is declared now because it is part of the theme contract in SPEC 10.4, and a
 * contract that grows a member later is a contract that breaks a theme later.
 *
 * `available` is false and `send` throws. It reports rather than silently doing nothing: a
 * theme can render a disabled panel from `available` without touching `send`, and anything
 * that does call `send` gets an error naming the milestone instead of a request that never
 * happened.
 */
export interface UseRunner {
  readonly id: ComputedRef<string | undefined>;
  /** Whether a runner is wired into this build. False until M2. */
  readonly available: ComputedRef<boolean>;
  /**
   * Sends the request.
   *
   * @throws {RunnerError} Always, in a build with no runner
   */
  send(): Promise<never>;
}

/**
 * @param id - Operation node id, or nothing to follow the current selection
 * @returns The runner for that operation
 * @throws {ThemeContractError} When no state was provided above
 *
 * @example
 * const { available } = useRunner();
 */
export function useRunner(id?: MaybeRefOrGetter<string | undefined>): UseRunner {
  const { id: resolvedId } = useNode(id);

  return {
    id: resolvedId,
    available: computed(() => false),
    send: () =>
      Promise.reject(
        new RunnerError(
          'the request runner arrives in M2; this build carries no runner',
          ErrorCode.RUN_NOT_AVAILABLE,
          undefined,
          { nodeId: resolvedId.value },
        ),
      ),
  };
}

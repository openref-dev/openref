import { ErrorCode, RunnerError } from '@openref/core';
import { computed } from 'vue';
import type { ComputedRef, MaybeRefOrGetter } from 'vue';
import { useNode } from './useNode';

/**
 * The interactive event client, per SPEC 16. Arrives in M6.
 *
 * Declared now for the same reason as {@link useRunner}: SPEC 10.4 lists it in the theme
 * contract, and adding a member to a frozen contract later is a breaking change.
 */
export interface UseSocket {
  readonly id: ComputedRef<string | undefined>;
  /** Whether a socket client is wired into this build. False until M6. */
  readonly available: ComputedRef<boolean>;
  /**
   * Opens the connection.
   *
   * @throws {RunnerError} Always, in a build with no socket client
   */
  connect(): Promise<never>;
}

/**
 * @param id - Channel node id, or nothing to follow the current selection
 * @returns The socket client for that channel
 * @throws {ThemeContractError} When no state was provided above
 *
 * @example
 * const { available } = useSocket();
 */
export function useSocket(id?: MaybeRefOrGetter<string | undefined>): UseSocket {
  const { id: resolvedId } = useNode(id);

  return {
    id: resolvedId,
    available: computed(() => false),
    connect: () =>
      Promise.reject(
        new RunnerError(
          'the interactive event client arrives in M6; this build carries no socket client',
          ErrorCode.RUN_NOT_AVAILABLE,
          undefined,
          { nodeId: resolvedId.value },
        ),
      ),
  };
}

import type { IRParameter, IRParameterLocation, IRRequestBody, IRResponse } from '@openref/core';
import { computed } from 'vue';
import type { ComputedRef, MaybeRefOrGetter } from 'vue';
import type { OperationView, ResolvedSecurityRequirement } from '../state/domain/node-view';
import { useNode } from './useNode';

/**
 * One HTTP operation.
 *
 * Narrower than {@link useNode}: it yields `undefined` for a node that is a channel rather
 * than pretending a channel has parameters. A theme that wants either uses `useNode`.
 */
export interface UseOperation {
  readonly id: ComputedRef<string | undefined>;
  readonly operation: ComputedRef<OperationView | undefined>;
  readonly parameters: ComputedRef<ReadonlyMap<IRParameterLocation, readonly IRParameter[]>>;
  readonly requestBody: ComputedRef<IRRequestBody | undefined>;
  readonly responses: ComputedRef<readonly IRResponse[]>;
  readonly security: ComputedRef<readonly ResolvedSecurityRequirement[]>;
  readonly deprecated: ComputedRef<boolean>;
}

const NO_PARAMETERS: ReadonlyMap<IRParameterLocation, readonly IRParameter[]> = new Map();

/**
 * @param id - Operation node id, or nothing to follow the current selection
 * @returns The operation and its parts
 * @throws {ThemeContractError} When no state was provided above
 *
 * @example
 * const { operation, responses } = useOperation();
 */
export function useOperation(id?: MaybeRefOrGetter<string | undefined>): UseOperation {
  const { id: resolvedId, node } = useNode(id);

  const operation = computed(() => (node.value?.kind === 'operation' ? node.value : undefined));

  return {
    id: resolvedId,
    operation,
    parameters: computed(() => operation.value?.parameters ?? NO_PARAMETERS),
    requestBody: computed(() => operation.value?.node.requestBody),
    responses: computed(() => operation.value?.responses ?? []),
    security: computed(() => operation.value?.security ?? []),
    deprecated: computed(() => operation.value?.deprecated ?? false),
  };
}

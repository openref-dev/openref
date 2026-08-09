import { computed, toValue } from 'vue';
import type { ComputedRef, MaybeRefOrGetter } from 'vue';
import { useDocState } from '../state/api/context';
import type { NodeView } from '../state/domain/node-view';

/**
 * One node, materialized on demand.
 *
 * The id may be a value, a ref or a getter. Omitting it follows the current selection, which
 * is what a detail pane wants and what keeps a theme from wiring the selection by hand.
 *
 * Materialization happens inside the `computed`, so a node nobody looks at is never derived.
 * That is the lazy node materialization SPEC 11 asks for, and `isMaterialized` on the state
 * exists so a test can prove it rather than assume it.
 */
export interface UseNode {
  readonly id: ComputedRef<string | undefined>;
  readonly node: ComputedRef<NodeView | undefined>;
  /** Whether the id names a node in this document. */
  readonly exists: ComputedRef<boolean>;
}

/**
 * @param id - Node id, or nothing to follow the current selection
 * @returns The materialized node
 * @throws {ThemeContractError} When no state was provided above
 *
 * @example
 * const { node } = useNode(() => route.params.id);
 */
export function useNode(id?: MaybeRefOrGetter<string | undefined>): UseNode {
  const state = useDocState();

  const resolvedId = computed(() => (id === undefined ? state.activeNodeId.value : toValue(id)));
  const node = computed(() =>
    resolvedId.value === undefined ? undefined : state.nodeView(resolvedId.value),
  );

  return {
    id: resolvedId,
    node,
    exists: computed(() => node.value !== undefined),
  };
}

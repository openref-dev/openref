import { computed } from 'vue';
import type { Component, ComputedRef } from 'vue';
import { useDocState } from '../state/api/context';
import type { SlotName } from '../slots/domain/slot-props.types';

/**
 * L1 theming: what actually goes in a slot.
 *
 * A theme replaces one piece of markup and nothing else changes. That is only true if the
 * decision is made in one place, at render time, and if a slot with no override falls through
 * to the default the renderer ships. Both are here.
 *
 * The result is a `computed` rather than a value so that swapping the theme moves the tree.
 *
 * @param name - The slot, validated against the fixed registry
 * @param fallback - The component the renderer ships for this slot
 * @returns The component to render
 * @throws {SlotNotFoundError} When the name is not a slot
 * @throws {ThemeContractError} When no state was provided above
 *
 * @example
 * const header = useSlot('OperationHeader', DefaultOperationHeader);
 * return () => h(header.value, { operation });
 */
export function useSlot(name: SlotName, fallback: Component): ComputedRef<Component> {
  const state = useDocState();
  return computed(() => state.theme.value.slots.resolve(name) ?? fallback);
}

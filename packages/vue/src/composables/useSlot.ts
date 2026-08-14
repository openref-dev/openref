import { computed } from 'vue';
import type { Component, ComputedRef } from 'vue';
import { useSlotRegistry } from '../slots/api/context';
import type { SlotName } from '../slots/domain/slot-props.types';

/**
 * L1 theming: what actually goes in a slot.
 *
 * A theme replaces one piece of markup and nothing else changes. That is only true if the
 * decision is made in one place, at render time, and if a slot with no override falls through
 * to the default the renderer ships. Both are here.
 *
 * IT READS THE REGISTRY AND NOT THE DOCUMENT STATE, since `TX-SLOTWIRE`. It used to reach the
 * registry through `DocState`, which holds an `IRDocument`, and the browser has none: every
 * position of the shipped renderer was therefore unable to resolve a slot, which is why an L1
 * override changed nothing on a page a reader opened. `provideDocState` still provides the
 * registry, so a headless tree is unaffected.
 *
 * A TREE WITH NO REGISTRY RESOLVES TO THE FALLBACK RATHER THAN THROWING. That is the L0 case: a
 * reference published with tokens and no theme has no overrides to look up, and making the
 * lookup mandatory would make a theme mandatory.
 *
 * The result is a `computed` rather than a value so that swapping the theme moves the tree.
 *
 * @param name - The slot, validated against the fixed registry
 * @param fallback - The component the renderer ships for this slot
 * @returns The component to render
 * @throws {SlotNotFoundError} When the name is not a slot
 *
 * @example
 * const header = useSlot('OperationHeader', DefaultOperationHeader);
 * return () => h(header.value, { node, drift });
 */
export function useSlot(name: SlotName, fallback: Component): ComputedRef<Component> {
  const registry = useSlotRegistry();
  return computed(() => registry?.value.resolve(name) ?? fallback);
}

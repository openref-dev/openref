import { computed, inject, provide, type ComputedRef, type Ref } from 'vue';
import type { InjectionKey } from 'vue';
import type { SlotRegistry } from '../domain/slot-registry';

/**
 * How the slot registry reaches a component, which is not through the document state.
 *
 * THIS KEY EXISTS BECAUSE THE RENDERER HAS NO DOCUMENT. `useSlot` read the registry out of
 * `DocState`, and `createDocState` takes an `IRDocument`; the browser never sees one, per SPEC
 * 12, so every position of the shipped renderer was unable to resolve a slot at all. That is the
 * mechanism under `TX-SLOTWIRE` and it comes before the contract: the registry has to be
 * providable on its own before anything can ask it a question.
 *
 * THE HEADLESS PATH KEEPS SUPPLYING ONE. `provideDocState` provides this key too, from the theme
 * it resolved, so a tree built the way SPEC 11 describes needs no second call and a theme swapped
 * on that state still moves the tree.
 *
 * IT IS A REF RATHER THAN A VALUE so that swapping the theme re-resolves every position. The
 * alternative, resolving once at provide time, would make a theme change a remount.
 */
export const SLOT_REGISTRY_KEY: InjectionKey<Ref<SlotRegistry> | ComputedRef<SlotRegistry>> =
  Symbol('openref.slots');

/**
 * Makes a slot registry available to everything below this component.
 *
 * @param registry - The registry, or a ref holding one so a theme swap moves the tree
 *
 * @example
 * setup() { provideSlots(resolveTheme(theme).slots); }
 */
export function provideSlots(registry: SlotRegistry | Ref<SlotRegistry>): void {
  provide(SLOT_REGISTRY_KEY, 'value' in registry ? registry : computed(() => registry));
}

/**
 * The registry provided above this component, or nothing when none was.
 *
 * NOTHING IS AN ANSWER HERE AND NOT AN ERROR, which is the difference between this and
 * `useDocState`. A reference rendered with no theme resolves every slot to the component the
 * renderer ships, which is the L0 case and the common one; throwing would make a theme
 * mandatory.
 *
 * @returns The registry ref, or undefined
 */
export function useSlotRegistry(): ComputedRef<SlotRegistry> | Ref<SlotRegistry> | undefined {
  return inject(SLOT_REGISTRY_KEY, undefined);
}

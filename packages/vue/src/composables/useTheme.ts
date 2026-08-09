import type { Component } from 'vue';
import { computed } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { useDocState } from '../state/api/context';
import type { SlotName } from '../slots/domain/slot-props.types';
import type { ResolvedTheme, ThemeAssets, ThemeTokens } from '../theme/domain/theme.types';

/**
 * The theme in force.
 *
 * Tokens come out as a map rather than as a style string, because a style attribute cannot be
 * authorized by a CSP nonce, per STANDARDS 10. Whoever mounts the reference writes them into a
 * stylesheet or onto a class; nothing here writes them onto an element.
 */
export interface UseTheme {
  readonly theme: Ref<ResolvedTheme>;
  readonly name: ComputedRef<string>;
  readonly tokens: ComputedRef<ThemeTokens>;
  readonly assets: ComputedRef<ThemeAssets>;
  /** The component a theme put in a slot, or `undefined` when it left the default in place. */
  slot(name: SlotName): Component | undefined;
  /** Slots this theme overrides, in registry order. */
  readonly overridden: ComputedRef<readonly SlotName[]>;
}

/**
 * @returns The theme, its tokens and its slot overrides
 * @throws {ThemeContractError} When no state was provided above
 *
 * @example
 * const { tokens, slot } = useTheme();
 */
export function useTheme(): UseTheme {
  const state = useDocState();

  return {
    theme: state.theme,
    name: computed(() => state.theme.value.name),
    tokens: computed(() => state.theme.value.tokens),
    assets: computed(() => state.theme.value.assets),
    slot: (name) => state.theme.value.slots.resolve(name),
    overridden: computed(() => state.theme.value.slots.overridden()),
  };
}

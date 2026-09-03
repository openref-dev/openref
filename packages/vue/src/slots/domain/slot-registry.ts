import { SlotNotFoundError } from '@openref/core';
import type { Component } from 'vue';
import type { SlotName } from './slot-props.types';
import { SLOT_NAMES } from './slot-props.types';

/**
 * The registry that maps a slot name to the component a theme put there.
 *
 * It holds overrides only. A slot with no override falls through to whatever the renderer
 * ships, which keeps the registry free of any visual opinion, per STANDARDS 9.
 *
 * Names are validated at runtime as well as at the type level, because a theme is external
 * input: it can be loaded from a package that was built against a different major version.
 */
export interface SlotRegistry {
  /** Whether a string is a slot name. Narrows, so a validated name is typed from then on. */
  has(name: string): name is SlotName;
  /**
   * The override for a slot, or `undefined` when the theme did not replace it.
   *
   * @throws {SlotNotFoundError} When the name is not a slot
   */
  resolve(name: string): Component | undefined;
  /**
   * Puts a component in a slot, replacing any previous override.
   *
   * @throws {SlotNotFoundError} When the name is not a slot
   */
  register(name: string, component: Component): void;
  /** Names of the slots a theme has overridden, in {@link SLOT_NAMES} order. */
  overridden(): readonly SlotName[];
}

const KNOWN = new Set<string>(SLOT_NAMES);

function assertSlotName(name: string): asserts name is SlotName {
  if (KNOWN.has(name)) return;
  throw new SlotNotFoundError(
    `there is no slot named "${name}"; the registry is fixed and lists ${String(SLOT_NAMES.length)} slots`,
    'THEME_SLOT_NOT_FOUND',
    undefined,
    { name, slots: [...SLOT_NAMES] },
  );
}

/**
 * Creates a slot registry.
 *
 * @param overrides - Components a theme puts in slots, validated on the way in
 * @returns A registry, owned by the state that created it
 * @throws {SlotNotFoundError} When an override names something that is not a slot
 *
 * @example
 * const registry = createSlotRegistry({ OperationHeader: MyHeader });
 */
export function createSlotRegistry(
  overrides: Readonly<Record<string, Component>> = {},
): SlotRegistry {
  const components = new Map<SlotName, Component>();

  /**
   * Refuses a registration whose component is nothing.
   *
   * THE NAME WAS CHECKED AND THE VALUE WAS NOT, UNTIL T035. `resolve` returns `undefined` for a
   * position registered with `undefined` and for one never registered at all, and `useSlot` reads
   * both as "fall back to the reference component", so a broken default export or a circular
   * import that resolves to `undefined` drew the reference's own markup while the theme believed
   * it had drawn its own, with nothing red on either side. `checkTheme` cannot see it either: it
   * counts the keys of the record, and the key is there. A theme that means to leave a position
   * alone omits it; handing over nothing is a mistake, and this is where it is nameable.
   */
  const assertComponent = (name: string, component: Component | undefined): void => {
    if (component !== undefined) return;

    throw new SlotNotFoundError(
      `the theme registered slot "${name}" with nothing to render; a position is either left to ` +
        'the reference by omitting it or filled with a component, and handing over undefined is ' +
        'silently the first while reading as the second',
      'THEME_SLOT_NOT_FOUND',
      undefined,
      { name },
    );
  };

  for (const [name, component] of Object.entries(overrides)) {
    assertSlotName(name);
    assertComponent(name, component);
    components.set(name, component);
  }

  return {
    has: (name): name is SlotName => KNOWN.has(name),
    resolve: (name) => {
      assertSlotName(name);
      return components.get(name);
    },
    register: (name, component) => {
      assertSlotName(name);
      assertComponent(name, component);
      components.set(name, component);
    },
    overridden: () => SLOT_NAMES.filter((name) => components.has(name)),
  };
}

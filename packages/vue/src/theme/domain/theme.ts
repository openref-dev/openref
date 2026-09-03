import { ThemeContractError } from '@openref/core';
import { defineAsyncComponent, type Component } from 'vue';
import { createSlotRegistry, type SlotRegistry } from '../../slots/domain/slot-registry';
import type { ResolvedTheme, ThemeDefinition, ThemeTokens } from './theme.types';

/**
 * Validation and resolution of a theme definition.
 *
 * A theme comes from outside: a package a user installed, possibly built against a different
 * major version. It is checked rather than trusted, and it fails loudly, because a theme that
 * half applies produces a reference that looks fine and is wrong.
 */

/**
 * Name this package gives the empty theme it resolves when handed nothing.
 *
 * CALLED `DEFAULT_THEME_NAME` UNTIL 2026-09-02, AND THE OLD NAME WAS A SECOND ANSWER TO A
 * QUESTION `@openref/theme` ALREADY ANSWERED. That package exports `DEFAULT_THEME_NAME` too, with
 * the value `vernier`, and `@openref/nest` depends on both, so whichever a consumer imported the
 * other one was wrong about the theme actually in force. Only one of the two was ever about the
 * default theme: `@openref/theme` ships it and knows its name, and this package cannot know it,
 * because STANDARDS 3.5 gives `theme` no upstream and the dependency graph forbids the edge in
 * either direction. What this constant names is narrower and is now called what it is: the theme
 * {@link resolveTheme} invents for a host that supplied none, which carries no tokens, no assets
 * and an empty registry. In the shipped product `@openref/nest` always supplies `defaultTheme`, so
 * the theme in force is `vernier` and this name is what a host reaches by wiring `createDocState`
 * itself and passing no theme.
 *
 * The value is unchanged. Renaming the constant is the fix; changing what `useTheme().name`
 * answers for a host that supplied no theme would be a second, unasked-for break.
 */
export const FALLBACK_THEME_NAME = 'default';

/** Token names are `--oref-{group}-{name}`, per STANDARDS 11. */
const TOKEN_NAME = /^--oref-[a-z0-9]+(?:-[a-z0-9]+)*$/;

function checkTokens(tokens: ThemeTokens, themeName: string): void {
  for (const [name, value] of Object.entries(tokens)) {
    if (!TOKEN_NAME.test(name)) {
      throw new ThemeContractError(
        `theme "${themeName}" declares token "${name}", which is not of the form --oref-{group}-{name}`,
        'THEME_CONTRACT_VIOLATED',
        undefined,
        { theme: themeName, token: name },
      );
    }
    if (typeof value !== 'string') {
      throw new ThemeContractError(
        `theme "${themeName}" gives token "${name}" a value that is not a string`,
        'THEME_CONTRACT_VIOLATED',
        undefined,
        { theme: themeName, token: name },
      );
    }
  }
}

/**
 * Validates a theme definition and resolves it into the form the state holds.
 *
 * @param definition - The theme, or nothing for the default
 * @returns The resolved theme
 * @throws {ThemeContractError} When the theme has no usable name or an ill formed token
 * @throws {SlotNotFoundError} When the theme overrides something that is not a slot
 *
 * @example
 * const theme = resolveTheme({ name: 'aurora', tokens: { '--oref-color-fg': '#fff' } });
 */
export function resolveTheme(definition?: ThemeDefinition): ResolvedTheme {
  if (definition === undefined) {
    return {
      name: FALLBACK_THEME_NAME,
      slots: createSlotRegistry(),
      tokens: {},
      assets: {},
    };
  }

  if (typeof definition.name !== 'string' || definition.name.trim() === '') {
    throw new ThemeContractError(
      'a theme must declare a non empty name',
      'THEME_CONTRACT_VIOLATED',
      undefined,
      { theme: definition.name },
    );
  }

  const tokens = definition.tokens ?? {};
  checkTokens(tokens, definition.name);

  return {
    name: definition.name,
    slots: resolveSlots(definition),
    tokens,
    assets: definition.assets ?? {},
  };
}

/**
 * The slot registry of a theme, with its layout resolved into `AppShell`.
 *
 * SEPARATE FROM {@link resolveTheme} BECAUSE THE BROWSER NEEDS ONE HALF OF IT. Validation is an
 * authoring concern: a theme is checked where it is written, by `@openref/theme-kit`, and again
 * on the server when the page is rendered. The client is handed the same object a second time and
 * has nothing to add by refusing it, so the refusals, their sentences and the token pattern stay
 * out of the bundle every reader downloads. Measured at 1.2 KB of `client-js-raw`, which is a
 * budget with no headroom in it.
 *
 * ONE RULE FOR THE LAYOUT AND ONE PLACE FOR IT. Both paths come through here, so the resolution
 * of `layout` into the `AppShell` slot cannot come to differ between the render and the hydration
 * of one page, which would be a hydration mismatch on the whole frame.
 *
 * @param definition - The theme, as its author wrote it
 * @returns The registry the renderer resolves positions through
 * @throws {SlotNotFoundError} When the theme overrides something that is not a slot
 * @throws {ThemeContractError} When the theme declares its page shell twice
 *
 * @example
 * provideSlots(resolveSlots(theme));
 */
export function resolveSlots(definition: ThemeDefinition | undefined): SlotRegistry {
  const slots = createSlotRegistry(definition?.components ?? {});
  if (definition === undefined) return slots;

  const layout = layoutComponent(definition);
  if (layout !== undefined) slots.register('AppShell', layout);

  return slots;
}

/**
 * The layout as the component the `AppShell` slot holds, or nothing when the theme wrote none.
 *
 * ONE POSITION, ONE MECHANISM. `layout` and `components.AppShell` are the same position by two
 * routes, and a theme that declares both leaves the renderer to pick one, which is how a theme
 * comes to ship a shell nobody draws. The refusal names both rather than choosing.
 *
 * The loader is wrapped rather than called, so an unused theme still costs nothing: the module
 * arrives when the position is first rendered.
 *
 * @param definition - The theme, as its author wrote it
 * @returns The component, or undefined
 * @throws {ThemeContractError} When the theme declares the position twice
 */
function layoutComponent(definition: ThemeDefinition): Component | undefined {
  if (definition.layout === undefined) return undefined;

  if (definition.components?.AppShell !== undefined) {
    throw new ThemeContractError(
      `theme "${definition.name}" declares its page shell twice, as \`layout\` and as ` +
        '`components.AppShell`, and those are one position; keep the one that reads better and ' +
        'remove the other',
      'THEME_CONTRACT_VIOLATED',
      undefined,
      { theme: definition.name, slot: 'AppShell' },
    );
  }

  const load = definition.layout;
  return defineAsyncComponent(async () => (await load()) as Component);
}

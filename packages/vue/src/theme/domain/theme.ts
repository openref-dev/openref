import { ErrorCode, ThemeContractError } from '@openref/core';
import { createSlotRegistry } from '../../slots/domain/slot-registry';
import type { ResolvedTheme, ThemeDefinition, ThemeTokens } from './theme.types';

/**
 * Validation and resolution of a theme definition.
 *
 * A theme comes from outside: a package a user installed, possibly built against a different
 * major version. It is checked rather than trusted, and it fails loudly, because a theme that
 * half applies produces a reference that looks fine and is wrong.
 */

/** Name of the theme in force when nobody supplied one. */
export const DEFAULT_THEME_NAME = 'default';

/** Token names are `--oref-{group}-{name}`, per STANDARDS 11. */
const TOKEN_NAME = /^--oref-[a-z0-9]+(?:-[a-z0-9]+)*$/;

function checkTokens(tokens: ThemeTokens, themeName: string): void {
  for (const [name, value] of Object.entries(tokens)) {
    if (!TOKEN_NAME.test(name)) {
      throw new ThemeContractError(
        `theme "${themeName}" declares token "${name}", which is not of the form --oref-{group}-{name}`,
        ErrorCode.THEME_CONTRACT_VIOLATED,
        undefined,
        { theme: themeName, token: name },
      );
    }
    if (typeof value !== 'string') {
      throw new ThemeContractError(
        `theme "${themeName}" gives token "${name}" a value that is not a string`,
        ErrorCode.THEME_CONTRACT_VIOLATED,
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
      name: DEFAULT_THEME_NAME,
      slots: createSlotRegistry(),
      tokens: {},
      assets: {},
    };
  }

  if (typeof definition.name !== 'string' || definition.name.trim() === '') {
    throw new ThemeContractError(
      'a theme must declare a non empty name',
      ErrorCode.THEME_CONTRACT_VIOLATED,
      undefined,
      { theme: definition.name },
    );
  }

  const tokens = definition.tokens ?? {};
  checkTokens(tokens, definition.name);

  return {
    name: definition.name,
    ...(definition.layout === undefined ? {} : { layout: definition.layout }),
    slots: createSlotRegistry(definition.components ?? {}),
    tokens,
    assets: definition.assets ?? {},
  };
}

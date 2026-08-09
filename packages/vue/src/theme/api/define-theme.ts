import type { ThemeDefinition } from '../domain/theme.types';

/**
 * Declares a theme, per SPEC 10.4.
 *
 * It is an identity function with a type on it. That is the whole job: the value is data, and
 * running anything here would mean a theme has behaviour at import time, which the server
 * renderer and the static build both need it not to have.
 *
 * @param definition - The theme
 * @returns The same definition, typed
 *
 * @example
 * export default defineTheme({ name: 'aurora', assets: { css: ['./aurora.css'] } });
 */
export function defineTheme(definition: ThemeDefinition): ThemeDefinition {
  return definition;
}

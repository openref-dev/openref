/**
 * The four components a page can compile after it is interactive, named as a contract.
 *
 * WHY AN INJECTED REGISTRY RATHER THAN AN IMPORT. A bundler splits on the import graph and on
 * nothing else. `NodePanel` importing `TryItPanel` at the top of the file puts the console in
 * the first chunk however the build is configured, so the deferral has to be a hole in the
 * graph and not a flag: the two entry points fill it, and neither component knows which filled
 * it. The server fills it with the real components, because a server render that deferred
 * anything would ship markup with a hole in it. The browser fills it with async components that
 * hydrate when the reader reaches for them.
 *
 * THE FIRST CLIENT RENDER STILL REPRODUCES THE SERVER MARKUP, which is the rule T012-R2
 * recorded and the reason this uses Vue's lazy hydration rather than a conditional render. A
 * deferred component's server markup stays in the document untouched, and hydration happens in
 * place when its trigger fires. Rendering a placeholder instead would be a hydration mismatch on
 * every page, which is the silent class of bug this component tree is written to avoid.
 *
 * A MISSING REGISTRY IS AN ERROR AND NOT AN EMPTY PAGE. The console rendering disabled because
 * nobody wired it is the exact state the `client-runner` gate exists about: it was the shipped
 * behaviour for the length of a task and every check there was stayed green.
 */

import { ErrorCode, InvalidOptionsError } from '@openref/core';
import { inject, type Component, type InjectionKey } from 'vue';

/**
 * The components a page resolves at render time instead of importing.
 *
 * Every one is a component in both fillings. On the server they are the implementations; in the
 * browser they are async components wrapping the same implementations, and Vue treats the two
 * the same way at a use site.
 */
export interface DeferrableComponents {
  /** The schema tree, with the expander behind it. */
  readonly schemaView: Component;
  /** The try-it console, with the runner behind it. */
  readonly tryIt: Component;
  /** The command palette, which is a button until it is opened. */
  readonly commandPalette: Component;
  /**
   * The Health panel, which is on the overview page and on no other.
   *
   * IT IS THE ONE ENTRY HERE THAT THE BROWSER DOES NOT FILL WITH THE FEATURE. Its disclosure is
   * `details` and `summary`, which the user agent opens by itself, so the server's markup is the
   * whole feature and there is nothing for a client render to add. The browser therefore fills
   * this position with an element that adopts the section it was handed, and the report stays on
   * the server: a component here would have to be given the findings, and giving them to it meant
   * shipping every one of them a second time to redraw markup the reader was already reading.
   * Recorded in SPEC 7.2 and 12 on 2026-08-12.
   */
  readonly healthPanel: Component;
}

/** How a component tree reaches the three. */
export const DEFERRABLE_KEY: InjectionKey<DeferrableComponents> = Symbol('oref.deferrable');

/**
 * The registry this tree was rendered with.
 *
 * @returns The three components
 * @throws {InvalidOptionsError} When neither entry point provided one, which would otherwise
 *   render a page with three features silently missing from it
 */
export function useDeferrable(): DeferrableComponents {
  const components = inject<DeferrableComponents | null>(DEFERRABLE_KEY, null);

  if (components === null) {
    throw new InvalidOptionsError(
      'no deferrable component registry was provided. The server render provides the eager one ' +
        'and hydrateReference provides the deferred one; a tree with neither would render ' +
        'without the schema viewer, the try-it console, the palette and the Health panel, and ' +
        'say nothing',
      ErrorCode.CONFIG_INVALID_OPTIONS,
    );
  }

  return components;
}

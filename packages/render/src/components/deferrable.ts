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

import { InvalidOptionsError } from '@openref/core';
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
  /**
   * The reading half of the shapes page, per SPEC 11.
   *
   * The Health panel's shape: no state, no handler, no client render, so the browser adopts
   * the server's rows rather than redrawing them, and the reading half costs the first paint
   * nothing.
   */
  readonly shapesReader: Component;
  /** The filling half of the shapes page: the value driven form, behind its own gesture. */
  readonly shapesFill: Component;
  /**
   * THE ADOPTED POSITIONS OF `TX-ADOPT`, all the Health panel's shape: no state, no handler,
   * no value the browser recomputes. The server fills each with the component that draws it,
   * resolving the slot where one exists, per SPEC 10.4's server resolved list; the browser
   * fills each with a childless element that adopts the markup the server drew, so none of the
   * components ride the first paint. The node page walks `NodeModel.drawn` to know which of
   * them the server mounted, which is what keeps the two trees identical over a redacted
   * state block, per SPEC 12.
   */
  /** The head of a node page: kicker, badge and path, drift box, meta line. */
  readonly operationHeader: Component;
  /** The parity scale and the remainder drift list. */
  readonly runtimePanel: Component;
  /** The description section, heading and paragraph count included. */
  readonly nodeDescription: Component;
  /** The security section a document-only page draws. */
  readonly nodeSecurity: Component;
  /** The parameters table. */
  readonly paramTable: Component;
  /**
   * The channel's own facts: address variables, protocol, servers, bindings, per SPEC 11.
   *
   * THE THREE CHANNEL POSITIONS ARE POSITIONS AND NOT SLOTS, the `NodeDescription` decision: the
   * registry is a fixed set by SPEC 10.4, and a theme that wants other channel markup owns the
   * page composition through `AppShell`. What is fixed here is where the markup is drawn.
   */
  readonly channelFacts: Component;
  /** The channel's `send` and `receive` operations, replies included. */
  readonly channelOperations: Component;
  /** The channel's messages: payloads read as rows, headers, correlation ids and examples. */
  readonly messageList: Component;
  /** The responses section, error contracts grid inside it, single root per SPEC 10.4. */
  readonly responseList: Component;
  /** The document overview article, which is the page a reader lands on. */
  readonly overviewPage: Component;
  /** The states showcase article, which only its own address draws. */
  readonly statesPage: Component;
  /**
   * The federated service card of SPEC 15.3: the Health panel's shape, adopted in the browser.
   *
   * The one live fact on it, the remote's status, is not the card's to draw: it lands on the
   * `data-oref-service` elements from the federation snapshot fetch, outside any chunk.
   */
  readonly servicePage: Component;
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
      'CONFIG_INVALID_OPTIONS',
    );
  }

  return components;
}

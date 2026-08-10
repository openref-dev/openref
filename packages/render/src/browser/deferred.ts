/**
 * The three features that arrive when the reader reaches for them, and not before.
 *
 * WHAT IS DEFERRED IS THE DOWNLOAD AND THE COMPILE, NOT ONLY THE HYDRATION, and the difference
 * is the whole of this file. Vue 3.5 ships lazy hydration, and read from its source rather than
 * from its documentation it does this: `__asyncHydrate` calls `load()` immediately and applies
 * the strategy to what comes back. The chunk is therefore fetched and compiled during the first
 * hydration, and only the hydration itself waits. That defers none of the cost SPEC 20 budgets,
 * which is bytes the main thread parses.
 *
 * SO THE GATE IS THE LOADER. An async component whose loader has not resolved is left alone by
 * hydration: `hydrateSubTree` is handed to `__asyncHydrate` and is not called, so the server's
 * markup stays in the document exactly as it was served, nothing is fetched, and nothing is
 * compiled. When the reader touches the region, the loader resolves, the chunk arrives, and Vue
 * hydrates that subtree in place. The first client render therefore reproduces the server markup
 * by not touching it, which is the strongest form of the rule T012-R2 recorded.
 *
 * THE TRIGGER IS DELEGATED, BECAUSE THERE IS NOTHING TO ATTACH A LISTENER TO YET. Vue hands a
 * strategy the elements of the subtree, and it only does that after the loader resolves, which
 * is the moment this file is trying to reach. So the listeners sit on the document, in the
 * capture phase, and match on the class the server rendered.
 *
 * AND THE EVENT IS REPLAYED, or the first click of every deferred feature would be the click
 * that loads it and does nothing else. The component that resolves is wrapped in one that
 * dispatches the captured event again from `onMounted`, which is after its subtree has hydrated
 * and its listeners are attached.
 */

import {
  defineAsyncComponent,
  defineComponent,
  h,
  onMounted,
  type Component,
  type VNode,
} from 'vue';
import type { DeferrableComponents } from '../components/deferrable';
import type { IRunnerPort } from '@openref/vue';

/** What makes one feature arrive. */
interface ReachSpec {
  /** Name, for the wrapper component and for a message. */
  readonly name: string;
  /** Class of the region the server rendered, matched with `closest`. */
  readonly selector: string;
  /** Events that count as reaching for it. */
  readonly events: readonly string[];
  /** A keystroke anywhere on the page that also opens it, such as the palette shortcut. */
  readonly shortcut?: (event: KeyboardEvent) => boolean;
}

/** A trigger that has been armed. */
interface Reached {
  /** Resolves the moment the reader reaches for the feature. */
  readonly reached: Promise<void>;
  /** Dispatches the captured event again, once, after the feature has hydrated. */
  readonly replay: () => void;
}

/** The palette shortcut, which is a key rather than a place on the page. */
function isPaletteShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
}

/**
 * Arms the delegated listeners for one feature.
 *
 * CAPTURE PHASE, so a region that stops propagation cannot keep its own feature from loading,
 * and `once` is not used because the listener has to survive an event that matched nothing.
 *
 * @param spec - What counts as reaching for this feature
 * @param root - Document to listen on
 * @returns The promise the loader waits on, and the replay
 */
export function whenReached(spec: ReachSpec, root: Document): Reached {
  let captured: Event | null = null;
  let settle: (() => void) | null = null;
  const reached = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const onEvent = (event: Event): void => {
    const target = event.target;
    const inRegion = target instanceof Element && target.closest(spec.selector) !== null;
    const shortcut =
      spec.shortcut !== undefined && event instanceof KeyboardEvent && spec.shortcut(event);

    if (!inRegion && !shortcut) return;

    // The shortcut is the browser's own binding on some platforms, so it is claimed here as
    // well as by the component. Not claiming it would let the browser act on the keystroke
    // that is loading the palette and then act again on the one that is replayed.
    if (shortcut) event.preventDefault();

    captured = event;
    dispose();
    settle?.();
  };

  const dispose = (): void => {
    for (const type of spec.events) root.removeEventListener(type, onEvent, true);
  };

  for (const type of spec.events) root.addEventListener(type, onEvent, true);

  const replay = (): void => {
    const event = captured;
    captured = null;
    if (event === null) return;

    const target = event.target;
    if (target === null) return;

    // Cloned through the event's own constructor with the original as the init, which is how
    // Vue's own interaction strategy replays one: every field a listener reads is on the init.
    const clone = new (event.constructor as new (type: string, init: Event) => Event)(
      event.type,
      event,
    );
    target.dispatchEvent(clone);
  };

  return { reached, replay };
}

/**
 * Wraps a loaded component in one that replays the event that loaded it.
 *
 * @param name - Feature name, for the component name
 * @param inner - The component that just arrived
 * @param replay - What to call once its subtree is mounted
 * @returns The wrapper
 */
function replaying(name: string, inner: Component, replay: () => void): Component {
  return defineComponent({
    name: `OrefDeferred${name}`,
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      onMounted(replay);

      return (): VNode => h(inner, attrs, slots);
    },
  });
}

/**
 * One deferred component: a gate, a dynamic import behind it, and a replay after it.
 *
 * @param spec - What counts as reaching for it
 * @param root - Document to listen on
 * @param load - The dynamic import
 * @returns An async component that fetches nothing until the gate opens
 */
export function deferUntilReached(
  spec: ReachSpec,
  root: Document,
  load: () => Promise<Component>,
): Component {
  const gate = whenReached(spec, root);

  return defineAsyncComponent(async () => {
    await gate.reached;

    return replaying(spec.name, await load(), gate.replay);
  });
}

/** How the client registry reaches a runner without this package importing one. */
export interface DeferredOptions {
  /** Document to arm the triggers on. */
  readonly document: Document;
  /**
   * Builds the request runner, when the console is first reached.
   *
   * A FUNCTION RATHER THAN A PORT, so the runner travels in the console's chunk instead of the
   * first one. `@openref/nest` supplies it, because STANDARDS 3.5 gives this package no edge to
   * `@openref/runner` and that is still true when the import is dynamic.
   */
  readonly loadRunner?: () => Promise<IRunnerPort>;
  /** Hands a runner to the application once there is one. */
  readonly provideRunner: (runner: IRunnerPort) => void;
}

/**
 * The registry a browser fills the component tree with.
 *
 * @param options - Where to listen, and how to reach a runner
 * @returns The three components, each an async component with a closed gate in front of it
 */
export function deferredComponents(options: DeferredOptions): DeferrableComponents {
  const root = options.document;

  return {
    schemaView: deferUntilReached(
      {
        name: 'SchemaView',
        selector: '.oref-schema-tree',
        // `keydown` as well as the pointer, because the tree is a `role="tree"` with roving
        // focus and arrow keys, and a reader who is on the keyboard never clicks it.
        events: ['pointerdown', 'focusin', 'keydown'],
      },
      root,
      async () => (await import('../components/SchemaView')).SchemaView,
    ),

    tryIt: deferUntilReached(
      { name: 'TryItPanel', selector: '.oref-section-tryit', events: ['pointerdown', 'focusin'] },
      root,
      async () => {
        const { TryItPanel } = await import('../components/TryItPanel');

        // BEFORE THE COMPONENT IS RETURNED, so the runner is in the application by the time the
        // console's `setup` injects it. `app.provide` reaches a component that has not been
        // created yet: a child's provides object is created from the application's, so a key
        // added later is found through the prototype chain.
        if (options.loadRunner !== undefined) options.provideRunner(await options.loadRunner());

        return TryItPanel;
      },
    ),

    commandPalette: deferUntilReached(
      {
        name: 'CommandPalette',
        selector: '.oref-palette-open',
        events: ['pointerdown', 'focusin', 'keydown'],
        shortcut: isPaletteShortcut,
      },
      root,
      async () => (await import('../components/CommandPalette')).CommandPalette,
    ),
  };
}

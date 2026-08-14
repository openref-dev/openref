/**
 * The three features that arrive when the reader reaches for them, and not before.
 *
 * THE FOURTH LEFT THIS FILE AND DID NOT MOVE ELSEWHERE. The Health panel was deferred until
 * 2026-08-12 and is now server markup the client adopts, because deferring a component that has
 * nothing to do is still a component, and being a component is what made its findings travel in
 * the state block. `adoptHealthPanel` below is what replaced it.
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
 * AND THE WHOLE INTERACTION IS REPLAYED, or the first click of every deferred feature would be
 * the click that loads it and does nothing else. The component that resolves is wrapped in one
 * that dispatches the captured events again from `onMounted`, which is after its subtree has
 * hydrated and its listeners are attached.
 *
 * THE INTERACTION IS A SEQUENCE AND NOT ONE EVENT, which is the correction of 2026-08-10 and the
 * reason the palette needed two clicks. `pointerdown` is what starts the fetch, because it is the
 * earliest moment a reader has committed to a control, and it is not what any of these components
 * listen to: the palette button opens on `click`, and a click arrives after a pointerdown that
 * this gate has already consumed. Replaying only the event that opened the gate therefore
 * dispatched an event nothing was listening for, and the feature stayed shut until the reader
 * tried again. So the listeners stay armed after the gate opens, every matching event is recorded
 * in the order it happened, and all of them are dispatched again once the subtree is mounted. The
 * gate keeps the earliest possible trigger and the component keeps the event it actually handles.
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
  /**
   * Events that count as reaching for it, and that are recorded until it has hydrated.
   *
   * `pointerdown` is what opens the gate soonest and `click` is what these components listen to,
   * so both belong in the list for a different reason: the first buys the fetch the length of a
   * press, the second is the event the feature has to be handed when it arrives.
   */
  readonly events: readonly string[];
  /** A keystroke anywhere on the page that also opens it, such as the palette shortcut. */
  readonly shortcut?: (event: KeyboardEvent) => boolean;
  /**
   * What a failed load must tell the reader, per SPEC 11's second half.
   *
   * The served control is a real enabled button since 2026-08-14, so a chunk that never
   * arrives would otherwise leave a pressable Send that silently does nothing, which is the
   * reading F14 exists to forbid. The sentence lands in the region and its buttons go dead.
   */
  readonly failure?: string;
}

/**
 * Writes a failed load into the region: dead controls, and the reason in words.
 *
 * DIRECT DOM WORK, AND THAT IS SAFE EXACTLY HERE. The async component rejected, so Vue never
 * claimed this subtree and never will; the server's markup is all there is, and the only
 * honest thing left is to stop it promising. The sentence reuses the class every theme is
 * required to style for the embed's failures, because it is the same statement: this region
 * failed, and whose defect it is.
 *
 * @param spec - The feature whose load failed
 * @param root - Document the region is in
 */
function markFailed(spec: ReachSpec, root: HydrateRoot): void {
  if (spec.failure === undefined) return;

  const region = root.querySelector(spec.selector);
  if (region === null) return;

  region.querySelectorAll('button').forEach((control) => {
    control.setAttribute('disabled', '');
  });
  region.insertAdjacentHTML('beforeend', `<p class="oref-embed-error">${spec.failure}</p>`);
}

/** A trigger that has been armed. */
interface Reached {
  /** Resolves the moment the reader reaches for the feature. */
  readonly reached: Promise<void>;
  /**
   * Dispatches every event of the interaction again, in order, after the feature has hydrated.
   *
   * Disarms first, so a replayed event cannot be recorded as a new one, and clears the queue, so
   * a second call dispatches nothing.
   */
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
 * THE LISTENERS STAY ARMED AFTER THE GATE OPENS. What is being recorded is the interaction and
 * not the trigger: between the pointerdown that starts the fetch and the moment the chunk has
 * hydrated, the reader's pointerup, click and keystrokes all land on markup with no listeners on
 * it, and every one of them is lost unless it is kept here.
 *
 * @param spec - What counts as reaching for this feature
 * @param root - Document to listen on
 * @returns The promise the loader waits on, and the replay
 */
export function whenReached(spec: ReachSpec, root: HydrateRoot): Reached {
  const captured: Event[] = [];
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

    captured.push(event);
    settle?.();
  };

  const dispose = (): void => {
    for (const type of spec.events) root.removeEventListener(type, onEvent, true);
  };

  for (const type of spec.events) root.addEventListener(type, onEvent, true);

  const replay = (): void => {
    // DISARMED BEFORE THE FIRST DISPATCH, and that is not tidiness. A replayed event is an event
    // of a listened type landing inside the region, so a listener still attached would record it
    // and the queue would grow while it was being drained.
    dispose();

    const events = captured.splice(0, captured.length);

    for (const event of events) {
      const target = event.target;
      if (target === null) continue;

      // Cloned through the event's own constructor with the original as the init, which is how
      // Vue's own interaction strategy replays one: every field a listener reads is on the init.
      const clone = new (event.constructor as new (type: string, init: Event) => Event)(
        event.type,
        event,
      );
      target.dispatchEvent(clone);
    }
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
  root: HydrateRoot,
  load: () => Promise<Component>,
): Component {
  const gate = whenReached(spec, root);

  return defineAsyncComponent(async () => {
    await gate.reached;

    try {
      return replaying(spec.name, await load(), gate.replay);
    } catch (cause) {
      // The failure stays loud: rethrowing keeps the rejection the browser suite listens for,
      // and what was added is only that the reader is told before the log is.
      markFailed(spec, root);
      throw cause;
    }
  });
}

/**
 * The Health panel, in the browser: an empty element over markup that is already right.
 *
 * IT IS NOT A DEFERRED COMPONENT AND IT IS NOT A COMPONENT AT ALL IN ANY USEFUL SENSE, and that
 * is the finding rather than an economy. The panel has no state, no handler and no client render:
 * its disclosure is `details` and `summary`, which the user agent opens by itself. It was deferred
 * because deferral was the cheapest thing to do with a component nobody needed, and the price of
 * keeping it a component was that every finding had to travel in the state block so that a
 * hydration nobody benefited from could redraw markup the reader was already looking at. Measured
 * on 578 findings, that copy was 155 KB.
 *
 * SO THE CLIENT CLAIMS THE SECTION AND LEAVES ITS CONTENTS ALONE. A vnode with no children takes
 * neither of the two branches Vue hydrates children with, so the server's rows are adopted rather
 * than compared, and a later patch of an element with no children on either side moves nothing.
 * The class is here because hydration checks the props it was given, and this one matches.
 *
 * WHAT THIS REMOVES BESIDES THE BYTES: the findings out of the state block, the panel's chunk out
 * of the deferred half of the bundle, and two delegated listeners out of the first paint. Nothing
 * a reader can do is lost, because there was nothing the chunk did.
 */
const adoptHealthPanel: Component = () => h('section', { class: 'oref-section-health' });

/**
 * The tree the gates listen in, the same structural slice `HydrateRoot` names in `index.ts`.
 *
 * Declared here rather than imported because `index.ts` imports this module: a type-only
 * import back would be a cycle in the source, which the graph rule reads as one, correctly.
 */
export type HydrateRoot = Pick<
  Document,
  'getElementById' | 'querySelector' | 'addEventListener' | 'removeEventListener'
>;

/** How the client registry reaches a runner without this package importing one. */
export interface DeferredOptions {
  /** Document to arm the triggers on. */
  readonly document: HydrateRoot;
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
        events: ['pointerdown', 'click', 'focusin', 'keydown'],
      },
      root,
      async () => (await import('../components/SchemaView')).SchemaView,
    ),

    tryIt: deferUntilReached(
      {
        name: 'TryItPanel',
        // `focusin` IS WHY ANY TEST OF THE DEFERRED CONSOLE HAS TO PLANT THE CHUNK. The console
        // has ten or more fields ahead of Send, so a reader arriving on the keyboard arms this
        // loader at the first of them, which is many tab presses before the gesture a case is
        // usually about. Without `open(page, true)` the case is a race between the chunk arriving
        // and the remaining presses, and it fails intermittently in exactly that way rather than
        // reporting the thing it asserts. Found 2026-08-12, after the same case went red twice
        // before the cause was named. The rule is about the mechanism and not about one test: the
        // gate can be armed by a gesture unrelated to the one under test.
        selector: '.oref-section-tryit',
        events: ['pointerdown', 'click', 'focusin'],
        // The one deferred feature whose served markup is a working control rather than
        // readable content, so it is the one whose failed load must say so, per SPEC 11.
        failure: 'The console failed to load. Reload the page to try again.',
      },
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
        events: ['pointerdown', 'click', 'focusin', 'keydown'],
        shortcut: isPaletteShortcut,
      },
      root,
      async () => (await import('../components/CommandPalette')).CommandPalette,
    ),

    healthPanel: adoptHealthPanel,
  };
}

import { createSSRApp, defineComponent, h, type Component, type VNode } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createSlotRegistry, provideDocState, type DocState, type SlotName } from '@openref/vue';

/**
 * The dev harness: run a theme's components against a real document and say what happened.
 *
 * WHAT THIS ANSWERS THAT THE CHECKER DOES NOT. The conformance checker reads a theme as data:
 * the names are right, the level is satisfied, the tokens are in the namespace. It never calls
 * a component. A theme that fills every slot with a component that throws on its first render
 * passes it. This is where they run.
 *
 * IT RENDERS ON THE SERVER RATHER THAN IN A DOM, for the reason the headless layer's own test
 * harness gives: a theme is markup and composables, it touches no DOM, and mounting one would
 * add a dependency and hide a violation rather than find one.
 *
 * ONE SLOT AT A TIME, AND A THROW IS A RESULT RATHER THAN A FAILURE. An author wants the list of
 * which of their components are broken, not the first one. So each is rendered in its own app
 * and its own render pass, and the error is caught and reported beside the name.
 *
 * PROPS ARE SUPPLIED BY THE CALLER AND NOT INVENTED HERE. A harness that made up props would be
 * asserting a second, private opinion about the contract beside the one in `SlotPropsMap`, and
 * the two would drift. What this owns is running the component and reporting the outcome.
 */

/** What happened to one slot. */
export interface SlotOutcome {
  readonly slot: SlotName;
  /** The markup the theme's component produced, when it produced any. */
  readonly html?: string;
  /** The message the component threw with, when it threw. */
  readonly error?: string;
}

/** What happened to a theme. */
export interface HarnessReport {
  readonly rendered: readonly SlotOutcome[];
  readonly failed: readonly SlotOutcome[];
}

/** Props to hand each slot, keyed by slot name. A slot with no entry is not run. */
export type SlotPropsBySlot = Partial<Record<SlotName, Record<string, unknown>>>;

/**
 * Renders each of a theme's components against a document.
 *
 * @param components - The theme's slot overrides, already validated by the checker
 * @param state - Document state the components read through the composables
 * @param props - Props for each slot, from the caller
 * @returns What each slot produced, and which ones threw
 *
 * @example
 * const report = await renderThemeSlots(aurora.components ?? {}, state, {
 *   StateNotice: { kind: 'empty', message: undefined },
 * });
 * report.failed.map((outcome) => outcome.slot); // ['StateNotice']
 */
export async function renderThemeSlots(
  components: Readonly<Record<string, Component>>,
  state: DocState,
  props: SlotPropsBySlot,
): Promise<HarnessReport> {
  // The registry is built rather than trusted, so a name that is not a slot is refused here by
  // the same code that refuses it in a running reference, not by a second copy of the list.
  const registry = createSlotRegistry(components);
  const rendered: SlotOutcome[] = [];
  const failed: SlotOutcome[] = [];

  for (const slot of registry.overridden()) {
    const component = registry.resolve(slot);
    if (component === undefined) continue;

    const host = defineComponent({
      name: 'ThemeKitHarness',
      setup() {
        provideDocState(state);
        return (): VNode => h(component, props[slot] ?? {});
      },
    });

    try {
      rendered.push({ slot, html: await renderToString(createSSRApp(host)) });
    } catch (error) {
      failed.push({ slot, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { rendered, failed };
}

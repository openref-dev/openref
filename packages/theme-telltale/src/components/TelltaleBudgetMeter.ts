import { defineComponent, h, onMounted, ref, type VNode } from 'vue';
import { browserDocument, browserPerformance } from '../dom';

/**
 * What the page weighs, shown in the page, which is one of the four things this design does that
 * the other two do not.
 *
 * IT IS A THEME COMPONENT AND NOT A SLOT, and it carries the theme's name in code so that nobody
 * mistakes one for the other. `ai-docs/design/CONTRACT.md` names it, with `TelltaleStatusBar` and
 * `TelltaleSectionIndex`, as this theme's own; no other theme implements it and nothing resolves
 * it through the registry.
 *
 * EVERY NUMBER IS ZERO UNTIL `mounted`, ON BOTH SIDES. The server has no DOM to count and no
 * resource timings to read, so it draws dashes; the first client render draws dashes as well and
 * the figures arrive in the second. Anything else is a hydration mismatch in the frame of every
 * page, which is the class of bug that shows up as a page that is subtly wrong for one reader.
 *
 * WHAT IT CAN MEASURE AND WHAT IT CANNOT. DOM nodes it counts. CSS and JS it takes from
 * `performance.getEntriesByType('resource')`, which reports what the browser actually transferred,
 * including the compression this project's budgets are set in terms of. `transferSize` reads 0 for
 * a resource served from the cache and for a cross origin response with no Timing-Allow-Origin,
 * and the second cannot happen here, because SPEC 19 puts the number of external requests at zero.
 * A zero from the cache is shown as a zero rather than hidden: a number this component invented
 * would be worse than a number a reader has to interpret.
 */
interface Weights {
  readonly nodes: number;
  readonly cssBytes: number;
  readonly jsBytes: number;
}

function measure(): Weights | null {
  const page = browserDocument();
  if (page === undefined) return null;

  let cssBytes = 0;
  let jsBytes = 0;

  const entries = browserPerformance()?.getEntriesByType?.('resource') ?? [];

  for (const resource of Array.from(entries)) {
    const bytes = resource.transferSize ?? 0;
    if (resource.initiatorType === 'css' || resource.initiatorType === 'link') cssBytes += bytes;
    if (resource.initiatorType === 'script') jsBytes += bytes;
  }

  return { nodes: page.getElementsByTagName('*').length, cssBytes, jsBytes };
}

/** Kilobytes, to one place, or a dash before anything has been measured. */
function kb(bytes: number, measured: boolean): string {
  if (!measured) return '--';
  return `${(bytes / 1024).toFixed(1)}k`;
}

export default defineComponent({
  name: 'TelltaleBudgetMeter',

  setup() {
    const weights = ref<Weights | null>(null);

    onMounted(() => {
      weights.value = measure();
    });

    return (): VNode => {
      const measured = weights.value;

      return h('div', { class: 'tt-budget', 'aria-label': 'What this page weighs' }, [
        h('span', { class: 'tt-budget-cell' }, [
          h('span', { class: 'tt-budget-label' }, 'DOM'),
          h(
            'span',
            { class: 'tt-budget-value' },
            measured === null ? '--' : String(measured.nodes),
          ),
        ]),
        h('span', { class: 'tt-budget-cell' }, [
          h('span', { class: 'tt-budget-label' }, 'CSS'),
          h('span', { class: 'tt-budget-value' }, kb(measured?.cssBytes ?? 0, measured !== null)),
        ]),
        h('span', { class: 'tt-budget-cell' }, [
          h('span', { class: 'tt-budget-label' }, 'JS'),
          h('span', { class: 'tt-budget-value' }, kb(measured?.jsBytes ?? 0, measured !== null)),
        ]),
      ]);
    };
  },
});

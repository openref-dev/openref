/**
 * Whether the bundle a page loads has a request runner bound into it.
 *
 * WHY THIS EXISTS. Between T013 and T014 the shipped browser bundle called `hydrateReference`
 * with no runner, and the try-it console rendered disabled. Everything was green: the console
 * had an integration test that passes a runner in by hand, and the bundle had a size budget
 * and a policy scan. The one thing nothing measured was the promise SPEC 2 makes, that an
 * install and one line give a reader something they can fire a request from. That state is
 * legitimate for a static build and it is not legitimate for a served reference, and the
 * difference is invisible unless something reads the artifact.
 *
 * WHAT A STATIC SCAN CAN AND CANNOT SHOW. It can show that the runner's code is in the file,
 * which is a real claim: `@openref/runner` reaches the bundle only by being imported and used,
 * and a tree shaking build drops every byte of it the moment the composition is removed. It
 * cannot show that the runner was handed to the hydration call, because that is behaviour. So
 * this checks presence, and `tools/browser-budget/test/integration/first-minute.spec.ts` drives
 * the built file in a real engine and sends a request through it. Neither is a substitute for
 * the other and both are cheap.
 *
 * MARKERS ARE STRING LITERALS BECAUSE MINIFICATION KEEPS THEM. Identifiers do not survive, so
 * a marker has to be a value the code carries rather than a name it uses.
 *
 * AND SINCE T011-R THE MARKERS ARE LOOKED FOR IN TWO PLACES RATHER THAN ONE, because the bundle
 * is a graph rather than a file. The hydration markers have to be in what the first paint loads,
 * since a page that hydrates on the second interaction does not hydrate. The runner's have to be
 * reachable and have to be somewhere else: the whole of that task is that `@openref/runner` is
 * not compiled until a reader opens the console, and a check that accepted it on either side
 * would go on passing the day it moved back.
 */

/** One thing the bundle has to carry, and what its absence would mean. */
export interface BundleMarker {
  /** Literal that survives minification. */
  readonly literal: string;
  /** What carries it, and therefore what is missing when it is absent. */
  readonly carriedBy: string;
}

/**
 * The runner's own code.
 *
 * Declared inside `@openref/runner` and nowhere else in the graph, so finding it means that
 * package was bundled rather than that something merely mentioned it. This is the marker that
 * moves when the runner moves, and it is the one the deferral is judged by.
 */
export const RUNNER_CODE_MARKERS: readonly BundleMarker[] = [
  {
    literal: 'oref.credential.',
    carriedBy: 'CREDENTIAL_KEY_PREFIX in @openref/runner, the credential store',
  },
];

/**
 * The wiring the runner is handed over through.
 *
 * `RUNNER_KEY` IS DECLARED IN `@openref/vue` AND NOT IN `@openref/runner`, which is the whole
 * reason it is a marker of its own since T011-R. It is an injection key, so it belongs to
 * whoever provides under it, and that is the entry: the browser half calls `app.provide` with it
 * after the console's chunk resolves. Requiring it on the deferred side would have failed a
 * bundle that is correct, and the first version of the split check did exactly that.
 */
export const RUNNER_WIRING_MARKERS: readonly BundleMarker[] = [
  {
    literal: 'openref.runner',
    carriedBy: 'the RUNNER_KEY injection key the console reads a runner through',
  },
];

/**
 * The hydration half.
 *
 * Without these the file is not the bundle a page loads at all, which is a failure that would
 * otherwise look exactly like a passing runner check over the wrong file.
 */
export const HYDRATION_MARKERS: readonly BundleMarker[] = [
  { literal: 'oref-app', carriedBy: 'the mount point the server rendered markup sits in' },
  { literal: 'oref-state', carriedBy: 'the element holding the serialized page model' },
];

/** What one bundle is missing. */
export interface BundleAudit {
  /** Markers that are in neither side of the graph, in declaration order. */
  readonly missing: readonly BundleMarker[];
  /**
   * Runner markers found in what the first paint loads.
   *
   * Present means the runner is compiled before the reader has asked for a console, which is
   * what T011-R removed and what nothing else would report: the bytes would show up in
   * `client-js-raw` as a number that is bigger than it was, and a number is not a diagnosis.
   */
  readonly eager: readonly BundleMarker[];
}

/** The two sides of a split bundle, as text. */
export interface BundleSides {
  /** Concatenated source of the entry and its static closure. */
  readonly initial: string;
  /** Concatenated source of everything behind a dynamic import. */
  readonly deferred: string;
}

/**
 * Audits one built bundle across both sides of its graph.
 *
 * @param sides - The initial closure and the deferred chunks, as source text
 * @returns The markers nothing carries, and the runner markers the first paint carries
 */
export function auditRunnerBinding(sides: BundleSides): BundleAudit {
  const whole = `${sides.initial}\n${sides.deferred}`;

  return {
    missing: [
      // A hydration marker that is only in a deferred chunk is missing from where it has to be,
      // and so is the injection key the entry provides under, so those two are looked for in the
      // first paint rather than in one concatenation of the whole graph.
      ...HYDRATION_MARKERS.filter((marker) => !sides.initial.includes(marker.literal)),
      ...RUNNER_WIRING_MARKERS.filter((marker) => !sides.initial.includes(marker.literal)),
      ...RUNNER_CODE_MARKERS.filter((marker) => !whole.includes(marker.literal)),
    ],
    eager: RUNNER_CODE_MARKERS.filter((marker) => sides.initial.includes(marker.literal)),
  };
}

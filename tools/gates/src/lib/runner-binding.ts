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
 * this checks presence, and `packages/nest/test/integration/first-minute.spec.ts` runs the
 * built file in a document and sends a request through it. Neither is a substitute for the
 * other and both are cheap.
 *
 * MARKERS ARE STRING LITERALS BECAUSE MINIFICATION KEEPS THEM. Identifiers do not survive, so
 * a marker has to be a value the code carries rather than a name it uses.
 */

/** One thing the bundle has to carry, and what its absence would mean. */
export interface BundleMarker {
  /** Literal that survives minification. */
  readonly literal: string;
  /** What carries it, and therefore what is missing when it is absent. */
  readonly carriedBy: string;
}

/**
 * The runner half of the bundle.
 *
 * Each literal is declared inside `@openref/runner` and appears nowhere else in the graph, so
 * finding one means that package was bundled rather than that something merely mentioned it.
 */
export const RUNNER_MARKERS: readonly BundleMarker[] = [
  {
    literal: 'oref.credential.',
    carriedBy: 'CREDENTIAL_KEY_PREFIX in @openref/runner, the credential store',
  },
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
  /** Markers that are not in the file, in declaration order. */
  readonly missing: readonly BundleMarker[];
}

/**
 * Audits one built bundle.
 *
 * @param bundle - Contents of the built file
 * @returns The markers it does not carry
 */
export function auditRunnerBinding(bundle: string): BundleAudit {
  const markers = [...HYDRATION_MARKERS, ...RUNNER_MARKERS];

  return { missing: markers.filter((marker) => !bundle.includes(marker.literal)) };
}

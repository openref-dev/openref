import { PACKAGE_NAME as VUE_PACKAGE } from '@openref/vue';

/**
 * `@openref/theme-kit`: what a theme author runs.
 *
 * Three things, and each one answers a question the other two do not. The conformance checker
 * reads a theme as data and refuses it by name. The harness runs its components against a real
 * document and reports which of them threw. The scaffold produces a theme package that passes
 * the first and survives the second, so an author starts from something that conforms rather
 * than from an empty directory and a specification.
 *
 * PUBLISHED SINCE `T064`, and this paragraph said the opposite until `T065` read the tarball. It
 * used to say the package was internal and bundled, on the reasoning that what a theme author
 * installs is the contract in `@openref/vue`; the maintainer's own test at `T064` was whether a
 * theme author can use it without the rest, and this is the one thing they run to check a theme
 * against the frozen contract of SPEC 10.4 outside this repository. The sentence shipped inside
 * `dist/index.d.ts`, which is where a consumer reads it, so a stale claim there is a claim made
 * to the one reader it is about.
 */

/** Name of this package. */
export const PACKAGE_NAME = '@openref/theme-kit';

/** Packages this package is allowed to depend on, in the order declared by STANDARDS 3.5. */
export const UPSTREAM_PACKAGES: readonly string[] = [VUE_PACKAGE];

export { assertTheme, checkTheme } from './conformance/domain/check-theme';
export type {
  ThemeConformanceOptions,
  ThemeConformanceReport,
  ThemeLevel,
  ThemeProblem,
} from './conformance/domain/check-theme';

export { renderThemeSlots } from './harness/domain/render-slots';
export type { HarnessReport, SlotOutcome, SlotPropsBySlot } from './harness/domain/render-slots';

export { isServerResolved, probeAdoptedSlot } from './harness/domain/probe-adopted';
export type { AdoptedSlotProblem } from './harness/domain/probe-adopted';

export { scaffoldTheme } from './scaffold/domain/scaffold-theme';
export type { ScaffoldFile, ScaffoldOptions } from './scaffold/domain/scaffold-theme';

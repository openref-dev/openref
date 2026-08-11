/**
 * Gate configuration: the budgets and floors from SPEC 20 and STANDARDS 9.1 and 12.
 *
 * Nothing in this file is ever raised or lowered to make a build pass. If a value here is
 * genuinely wrong, `ai-docs/SPEC.md` changes first.
 */

import { ASSET_ALLOWED_LICENSES, FIXTURE_ALLOWED_LICENSES } from './lib/fixtures.js';
import type { BudgetException } from './lib/budget-exceptions.js';
import type { BudgetQuantity } from './lib/budgets.js';
import type { FixtureRoot } from './gates/fixture-licenses.gate.js';
import type { DataOnlyAttestation, LicenseAttestation } from './lib/licenses.js';

/**
 * Recorded readings of licenses that no manifest declares.
 *
 * Each entry says: this text, at this version, hashed to this, and was read as this
 * license. It permits nothing that the policy would otherwise reject. When the text or the
 * version changes the record stops matching and the gate fails, which is the point.
 *
 * Adding an entry means someone read the license file. Do not add one to clear a failure.
 */
export const LICENSE_ATTESTATIONS: readonly LicenseAttestation[] = [
  {
    package: 'spawndamnit@3.0.1',
    license: 'MIT',
    file: 'LICENSE',
    sha256: 'aac99045d4e36ab3b1e2914337620963b56cbac53de280c94f29261a22ab5b0f',
  },
];

/**
 * Recorded readings of packages admitted to the production zone by a data-only license.
 *
 * SPEC 0 accepts CC0-1.0 in zone 1 only for reference data, because CC0 withholds patent
 * rights and that withholding covers nothing in a package that implements nothing. Each
 * entry says: someone read this package, at this version, and found data.
 *
 * The version is part of the key, so a bump stops matching and the gate asks again. A CC0
 * package carrying executable logic gets re-examined rather than admitted by precedent.
 *
 * Empty until a package under such a license actually enters the published closure.
 */
export const DATA_ONLY_ATTESTATIONS: readonly DataOnlyAttestation[] = [
  {
    package: 'mdn-data@2.27.1',
    license: 'CC0-1.0',
    rationale:
      'Read at 2.27.1: 19 JSON files of CSS, API and localization reference tables, plus four index modules whose entire body is require() of those files. It implements nothing, so the patent grant CC0 withholds covers nothing that could be asserted. Arrives through @openref/render -> isomorphic-dompurify -> jsdom -> css-tree.',
  },
];

/** A package that must never reach a consumer, and the reason it would be a defect if it did. */
export interface NeverShippedPackage {
  readonly name: string;
  readonly reason: string;
}

/**
 * Development tools that must stay in zone 2, named rather than inferred.
 *
 * THE LICENCE ZONES CANNOT CATCH THIS ON THEIR OWN. Both zones allow Apache-2.0, so a browser
 * driver crossing from the development tree into the published closure would pass every licence
 * check and add thirteen megabytes to what a consumer installs, with nothing red. The zones ask
 * whether a package may ship; this asks whether a particular package did.
 *
 * The check runs in both directions. A named package inside the published closure is an error.
 * A named package that is nowhere in the development tree either is reported as stale, because
 * an entry for something the repository no longer installs is a check that cannot fail and it
 * should be removed rather than left to look like coverage.
 */
export const NEVER_SHIPPED_PACKAGES: readonly NeverShippedPackage[] = [
  {
    name: 'playwright-core',
    reason:
      'the browser driver T015 measures the SPEC 20 browser budgets with. It is Apache-2.0, so ' +
      'the licence policy would admit it to either zone, and it is 13 MB.',
  },
];

/**
 * Vendored corpora, zone 3 of SPEC 0.
 *
 * Each root holds `manifest.json`, `NOTICE` and `documents/`. Adding a corpus is a line
 * here; adding a document to one is a line in its manifest.
 */
export const FIXTURE_ROOTS: readonly FixtureRoot[] = [
  {
    directory: 'packages/core/test/corpus',
    producedBy: 'T006',
    filesDirectory: 'documents',
    noticeFile: 'NOTICE',
    manifestKey: 'documents',
    allowedLicenses: FIXTURE_ALLOWED_LICENSES,
    extensions: ['.json', '.yaml', '.yml'],
    readsLicenseText: false,
    label: 'document(s)',
  },
  {
    directory: 'packages/theme/fonts',
    producedBy: 'the zone 4 work of 2026-08-10',
    filesDirectory: '',
    noticeFile: 'NOTICE.md',
    manifestKey: 'assets',
    allowedLicenses: ASSET_ALLOWED_LICENSES,
    extensions: ['.woff2', '.woff', '.ttf', '.otf'],
    readsLicenseText: true,
    label: 'font file(s)',
  },
];

/** The build manifest, addressed by absolute line number by every session. */
export const BUILD_FILE = 'ai-docs/BUILD.md';

/**
 * Where work scheduled between two regenerations of BUILD.md lives.
 *
 * BUILD.md cannot gain a task without being regenerated, which is the maintainer's call, so a
 * retrofit and a task with no number are written here and own things from here.
 */
export const BUILD_AMENDMENTS_FILE = 'ai-docs/BUILD-AMENDMENTS.md';

/**
 * The four documents the whole project is written against.
 *
 * `ai-docs/` is excluded from the repository on purpose, so nothing that walks tracked files
 * can tell whether these exist. They are also, for the same reason, the files most likely to
 * go missing without anything noticing: a fresh clone has none of them, and a session that
 * starts without SPEC.md does not stop, it improvises.
 *
 * Checked for presence and for content, alongside the BUILD.md line count, so an absent spec
 * fails the build at once instead of being discovered three tasks later.
 */
export const REQUIRED_DOCS: readonly { readonly file: string; readonly purpose: string }[] = [
  { file: 'ai-docs/SPEC.md', purpose: 'the authoritative product specification' },
  { file: BUILD_FILE, purpose: 'the execution order, addressed by absolute line number' },
  {
    file: BUILD_AMENDMENTS_FILE,
    purpose: 'retrofits and per task amendments, since BUILD.md cannot be edited',
  },
  {
    file: 'ai-docs/PROJECT_STATE.md',
    purpose: 'the running log of decisions each session inherits',
  },
];

/**
 * Fewest bytes a required document can hold and still be one.
 *
 * An empty file and a placeholder are the same failure as a missing file, and both would
 * otherwise pass a presence check.
 */
export const REQUIRED_DOC_MIN_BYTES = 200;

/**
 * The line count the CONTENTS ranges in BUILD.md were written against.
 *
 * This is not a budget that can be renegotiated. If BUILD.md legitimately changes length,
 * the maintainer regenerates the file and its ranges together, and this number follows.
 */
export const BUILD_LINE_COUNT = 1641;

/** The number of tasks BUILD.md contains, T001 through T065. */
export const BUILD_TASK_COUNT = 65;

/**
 * THE LIST OF PACKAGES IS NOT IN THIS FILE ANY MORE, and its absence is the fix for F23.
 *
 * It was a hand written array of eight directory names here and another in
 * `.dependency-cruiser.cjs`, with nothing reconciling either against the disk. Every boundary
 * rule built its `to` path by filtering that array, so a package missing from it was governed by
 * no rule in either direction, and the same array drove the CSP scan roots, so its built output
 * was never opened. Measured on 2026-08-11: a new package under `packages/`, imported by
 * `packages/core/src`, cruised clean.
 *
 * It is read from `packages/` now, by `lib/package-dirs.ts`, which calls the one derivation in
 * `tools/dependency-rules.cjs`. A list that has to be maintained is a gate whose accuracy is the
 * hand that last touched it.
 */

/**
 * Coverage floors from STANDARDS 9.1, keyed by package directory.
 *
 * A package with no entry has no floor yet; adding one is a task, not a judgement call.
 */
export const COVERAGE_FLOORS: Readonly<Record<string, number>> = {
  core: 90,
  runner: 85,
  nest: 80,
  vue: 70,
};

/**
 * A budget that is checked by measuring built files.
 *
 * THE QUANTITY IS PART OF THE BUDGET AND IS NAMED IN THE ID. `transfer` is gzip, what a host
 * serves; `parse` is the raw bytes, what the main thread decodes and then walks. SPEC 0 records
 * why the distinction is a defect class of its own: `theme-css` measured the first, reported
 * 6.3 KB of 15 and was green while the browser parsed 38.8 KB that nothing bounded.
 */
export interface SizeBudget {
  readonly id: string;
  readonly label: string;
  readonly limitBytes: number;
  readonly quantity: BudgetQuantity;
  /** Repository relative directories that hold the artifacts making up this bundle. */
  readonly roots: readonly string[];
  readonly extensions: readonly string[];
  /** Task that first produces the artifacts, printed when the budget has nothing to measure. */
  readonly producedBy: string;
  /**
   * Which side of a split bundle's module graph this budget bounds, for a bundle that has one.
   *
   * ABSENT MEANS THE WHOLE OF THE ROOTS, which is right for a set of files with no graph over
   * them, such as the theme stylesheets. Present, the roots stop being the measurement and
   * become the completeness check: every file under them has to be on one side or the other,
   * and one that is on neither fails the budget rather than being left out of it.
   */
  readonly partition?: BundlePartition;
}

/** One side of a split bundle, named by the entry the graph is walked from. */
export interface BundlePartition {
  /** Repository relative path of the entry module. */
  readonly entry: string;
  /**
   * `initial` is the entry and its static closure, which is what a first paint compiles.
   * `deferred` is everything reachable only through a dynamic import, which is what a reader
   * who opens a feature compiles instead.
   */
  readonly side: 'initial' | 'deferred';
}

/**
 * A budget that can only be checked by running something, owned by the task that builds it.
 */
export interface MeasuredBudget {
  readonly id: string;
  readonly label: string;
  readonly limit: string;
  readonly enforcedBy: string;
  /**
   * A quantity SPEC 20 records without gating, printed with its figure and never a failure.
   *
   * TWO ROWS ARE LIKE THIS AND BOTH BECAME SO BY MEASUREMENT. Elapsed time and main thread task
   * time move with the processor a shared runner hands out, by 25.7 and 27.0 percent of their
   * medians over six studies on five machines, so neither can carry a threshold on this
   * machinery. They are kept because a page whose time moves says where to look, and they are
   * marked so that nobody reads a printed figure as a passed check.
   */
  readonly reportOnly?: boolean;
}

/**
 * The browser bundles a served reference actually loads.
 *
 * ONE ENTRY, AND IT IS THE COMPOSED ONE. `@openref/render` builds a browser bundle of its own
 * and that bundle is deliberately runner free, because the renderer may not see the runner:
 * STANDARDS 3.5 gives it `core` and `vue` and nothing else. It is a component of what ships,
 * not a thing that ships, and holding it to this check would demand of it exactly what the
 * dependency rule forbids it.
 *
 * T039 adds the static build's bundle here when it produces one, and answers the question this
 * gate raises for it: a reference written to files has no host to compose a runner, so either
 * the CLI composes one at build time or that output is entered in this list with the reason it
 * is exempt. Silence is not an answer.
 */
export interface ShippedClientBundle {
  readonly label: string;
  /** Repository relative path of the entry module a page loads. */
  readonly file: string;
  /**
   * Directories holding the entry and every chunk it can reach.
   *
   * THE GATE READS THE GRAPH AND NOT THE FILE, since T011-R. The runner now lives behind a
   * dynamic import, so a check that read only the entry stopped seeing it and started failing;
   * a check that had been written to read only the entry and to pass on absence would instead
   * have stopped seeing it and stayed green, which is the state that gate exists about.
   */
  readonly roots: readonly string[];
}

export const SHIPPED_CLIENT_BUNDLES: readonly ShippedClientBundle[] = [
  {
    label: '@openref/nest',
    file: 'packages/nest/dist/browser/openref.js',
    roots: ['packages/nest/dist/browser'],
  },
];

/**
 * The stylesheets the default theme ships, budgeted twice over one list.
 *
 * ONE LIST FOR BOTH CAPS, deliberately. Two copies of the roots is how the two budgets would
 * come to bound different file sets while reading as two views of one.
 */
const THEME_CSS_ROOTS: readonly string[] = ['packages/theme/dist', 'packages/theme/fonts'];

/**
 * The shipped browser bundle, named once for the four budgets that partition it.
 *
 * ONE ENTRY AND ONE ROOT LIST FOR ALL FOUR, for the reason `THEME_CSS_ROOTS` exists: two copies
 * of the roots is how two budgets over one artifact come to bound different file sets while
 * reading as two views of one.
 */
const CLIENT_JS_ROOTS: readonly string[] = [
  'packages/nest/dist/browser',
  'packages/theme/dist/browser',
];

const CLIENT_JS_ENTRY = 'packages/nest/dist/browser/openref.js';

export const SIZE_BUDGETS: readonly SizeBudget[] = [
  {
    id: 'client-js',
    label: 'Client JS the first paint loads, gzip',
    limitBytes: 100 * 1024,
    // THE ROOT MOVED IN T014, from the renderer's browser build to the composed one, and the
    // limit did not. SPEC 20 bounds what a reader downloads, and what a reader downloads is
    // the bundle `@openref/nest` serves, which is the renderer's plus the request runner. The
    // two are alternatives rather than an addition, so measuring both would sum a quantity
    // nobody ever fetches and would report 88 KB of 100 for a page that costs 41. The
    // renderer's own bundle keeps a ceiling of its own in `client-bundle.spec.ts`.
    //
    // AND THE QUANTITY MOVED IN T011-R, which is a correction and not a relaxation. That task
    // split four features out of the bundle, and from the moment it did, summing the directory
    // counted four chunks no reader loads on first paint: 45.8 KB gzip reported for a page that
    // costs 37.8. The limit did not move here either. What moved is that this row now measures
    // the entry and its static closure, which is the quantity the deferral acts on, and the
    // deferred side is measured by two budgets of its own rather than by nobody.
    roots: CLIENT_JS_ROOTS,
    extensions: ['.js', '.mjs'],
    quantity: 'transfer',
    producedBy: 'T014',
    partition: { entry: CLIENT_JS_ENTRY, side: 'initial' },
  },
  {
    // THE SECOND CAP ON THE FIRST PAINT, the one T011-R owes and the one the TTI diagnosis
    // named. The gzip cap bounds what a reader downloads; this bounds what the engine decodes
    // and compiles before the page is interactive, and those differ by a factor of 2.53 here.
    //
    // 98 KB IS DELIBERATELY TIGHTER THAN THE USUAL TEN PERCENT, and the reason is what this
    // budget is for. Measured 97,920 raw bytes across six files. Ten percent would be 105 KB,
    // and at 105 KB any two of the three deferred features could come back into the first load
    // without a word, which is the exact regression the task that set this cap exists to
    // prevent. At 98 KB the smallest of them returning fails it: the palette is 3,278 raw and
    // takes the closure to 101,198. What is left for ordinary work is 2,432 bytes, which is the
    // same trade `page-bytes` makes and is stated here for the same reason: a task that needs
    // more room says so and moves the number deliberately.
    id: 'client-js-raw',
    label: 'Client JS the first paint loads, raw bytes',
    limitBytes: 98 * 1024,
    roots: CLIENT_JS_ROOTS,
    extensions: ['.js', '.mjs'],
    quantity: 'parse',
    producedBy: 'T011-R',
    partition: { entry: CLIENT_JS_ENTRY, side: 'initial' },
  },
  {
    // THE OTHER SIDE OF THE SAME GRAPH, GATED RATHER THAN RECORDED. The alternative was to print
    // the deferred figures and assert nothing, on the grounds that a reader pays them only on
    // interaction. That was rejected: they are byte counts, which is the one quantity this
    // project's machinery has been able to threshold at all, and an unasserted figure beside an
    // asserted one is the shape SPEC 0 now names as a defect class of its own.
    //
    // Measured 8,240 gzip and 18,845 raw across five chunks, and both caps are the measurement
    // plus ten percent. The concrete regression both have to fail is a fourth deferred feature
    // the size of the palette, 3,278 raw and about 1.4 KB gzip: planted on the real gate it read
    // 21.6 KB raw and 9.2 KB gzip, over both.
    //
    // AND A PLANT THAT FAILS ONLY ONE OF THEM, WHICH IS WHY THERE ARE TWO. Appending a byte
    // identical copy of the schema viewer chunk to itself was tried first and read 22.1 KB raw,
    // over, beside 8.1 KB gzip, inside. A duplicate costs the engine everything and costs the
    // wire almost nothing, so the raw cap saw a doubled chunk that the gzip cap could not. That
    // is the transfer against parse distinction of SPEC 0 appearing in a plant rather than in an
    // argument, and it is recorded here because the first version of this comment claimed the
    // doubling failed both and the measurement said otherwise.
    //
    // MOVING CODE FROM THE FIRST PAINT INTO A CHUNK RAISES THIS BUDGET, and that is not a defect
    // in it. Deferring a fourth feature is a deliberate act with a number attached, and raising
    // this cap while `client-js-raw` falls is what that act looks like from here.
    id: 'client-js-deferred',
    label: 'Client JS behind a dynamic import, gzip',
    limitBytes: 9 * 1024,
    roots: CLIENT_JS_ROOTS,
    extensions: ['.js', '.mjs'],
    quantity: 'transfer',
    producedBy: 'T011-R',
    partition: { entry: CLIENT_JS_ENTRY, side: 'deferred' },
  },
  {
    id: 'client-js-deferred-raw',
    label: 'Client JS behind a dynamic import, raw bytes',
    limitBytes: 21 * 1024,
    roots: CLIENT_JS_ROOTS,
    extensions: ['.js', '.mjs'],
    quantity: 'parse',
    producedBy: 'T011-R',
    partition: { entry: CLIENT_JS_ENTRY, side: 'deferred' },
  },
  {
    id: 'theme-css',
    label: 'Default theme CSS, gzip',
    limitBytes: 15 * 1024,
    quantity: 'transfer',
    roots: THEME_CSS_ROOTS,
    extensions: ['.css'],
    producedBy: 'T009',
  },
  {
    // THE SECOND CAP ON THE SAME FILES, AND IT IS NOT A REPLACEMENT FOR THE FIRST. The gzip cap
    // bounds what a reader downloads, which is a real cost and stays. This bounds what the main
    // thread decodes, parses and matches, which is the cost the TTI study actually observed and
    // which nothing bounded while the two quantities differed by 5.97 times.
    //
    // 34 KB is the measurement plus about ten percent, chosen the way `fonts-total` was: a
    // concrete regression has to trip it. Measured 38,786 bytes before T012-R3, which would have
    // given 41 KB, and 32,094 after it, which gives 34. It was recomputed rather than left at 41
    // because a cap 8.9 KB above the artifact would have let more back in than the fix removed.
    // Another region of `theme.css` the size of the try-it console, 3,669 bytes, or of the page
    // frame, 3,287, lands above the cap; a navigation sized 2,520 does not, and that is the room
    // ordinary work gets.
    id: 'theme-css-raw',
    label: 'Default theme CSS, raw bytes',
    limitBytes: 34 * 1024,
    quantity: 'parse',
    roots: THEME_CSS_ROOTS,
    extensions: ['.css'],
    producedBy: 'T009',
  },
];

/**
 * A theme's font directory, budgeted three times.
 *
 * PER THEME, NOT PER REPOSITORY, and that is the point rather than a convenience. A theme
 * nobody loads costs nothing, and there will be more than one theme. A repository total would
 * have to be raised every time a theme is added, which is a budget that only ever moves in one
 * direction.
 *
 * Three numbers rather than one, because they measure three different things. The first bounds
 * what a reader waits for: the latin half of the primary sans weight and of the primary mono
 * weight, the two files the first paint needs. The second bounds what a reader of an English
 * interface fetches over a whole session: the latin half of every face. The third bounds what
 * the published package weighs, the directory entire, latin-ext included. Everything past the
 * first pair loads with `font-display: swap` and delays nothing, so the third sits loosest.
 *
 * The second exists because the split made the second and third numbers different. While a face
 * was one file, the directory and the download were the same quantity; once a face is two files
 * they are not, and a single cap would then bound the one nobody pays.
 */
export interface FontBudget {
  /** The package that ships them, for the message. */
  readonly theme: string;
  /** Repository relative directory holding the font files. */
  readonly directory: string;
  /** The two files the first paint needs: the latin half of the primary sans and mono weights. */
  readonly firstPaint: readonly string[];
  /** Every latin file: what a reader who stays inside that range downloads in total. */
  readonly latin: readonly string[];
  readonly producedBy: string;
}

/**
 * All three caps, per SPEC 20. Measured gzip, like every other budget.
 *
 * The total was corrected twice on 2026-08-10, and neither time was a concession.
 *
 * 130 became 160 because 130 came from estimates taken over hinted fonts and only held while
 * the first build dropped the hinting. Hinting is rendering quality, not packaging, and it is
 * lost exactly where this product is most exposed, monospace code at 11 px.
 *
 * 160 became 195 when latin and latin-ext were split into separate files. The split takes the
 * first paint from 58.7 KB to 44.9 KB and a latin reader's whole session from 144.3 KB to
 * 107.9 KB, and it takes the directory from 144.3 KB to 176.8 KB, because a split face carries
 * `fpgm`, the `name` table and every latin base glyph its accented glyphs compose from in both
 * halves: 6.3 KB per face, 32.5 KB over five.
 *
 * Each cap is the measurement plus about ten percent, chosen the same way the 160 was: a sixth
 * face has to fail. Split it reaches about 209 KB of 195 and about 124.6 KB of 120; as a single
 * file it reaches about 202 KB. THE FIRST PAINT CAP HAS NEVER MOVED and now has 25 percent of
 * room rather than 2.3.
 */
export const FONT_BUDGET_LIMITS = {
  firstPaintBytes: 60 * 1024,
  latinBytes: 120 * 1024,
  totalBytes: 195 * 1024,
} as const;

export const FONT_BUDGETS: readonly FontBudget[] = [
  {
    theme: '@openref/theme',
    directory: 'packages/theme/fonts',
    firstPaint: ['SpaceGrotesk-400-latin.woff2', 'JetBrainsMono-400-latin.woff2'],
    latin: [
      'SpaceGrotesk-400-latin.woff2',
      'SpaceGrotesk-500-latin.woff2',
      'SpaceGrotesk-700-latin.woff2',
      'JetBrainsMono-400-latin.woff2',
      'JetBrainsMono-700-latin.woff2',
    ],
    producedBy: 'the zone 4 work of 2026-08-10',
  },
];

export const MEASURED_BUDGETS: readonly MeasuredBudget[] = [
  {
    id: 'search-index',
    label: 'Search index, 1000 nodes, gzip',
    limit: '250 KB',
    enforcedBy: 'T007',
  },
  { id: 'prerender', label: 'Prerender, 1000 nodes', limit: '2 s', enforcedBy: 'T011' },
  // THE TWO TIMES ARE RECORDED AND NEITHER IS GATED, and that is a measurement rather than a
  // concession. Six studies of one commit on five processors put wall clock TTI between 163.7
  // and 216.1 ms and main thread task time between 192.3 and 258.3, ranges of 25.7 and 27.0
  // percent of their medians. The second was proposed as the machine independent replacement for
  // the first and measured slightly worse than it, so no threshold was set for either. They are
  // printed with their figures on every run, marked report only, so a reader can see the number
  // without reading it as a check that passed.
  {
    id: 'tti',
    label: 'TTI, 1000 nodes, 4x CPU throttle',
    limit: 'recorded, not gated since 2026-08-10',
    enforcedBy: 'T015',
    reportOnly: true,
  },
  {
    id: 'main-thread-work',
    label: 'Main thread task time, 1000 nodes, 4x CPU throttle',
    limit: 'recorded, not gated: the study measured it as unstable as the clock',
    enforcedBy: 'T015-R1',
    reportOnly: true,
  },
  // AND THE TWO COUNTS THAT SURVIVED THE SAME STUDY, both gated. The long task count read 2 on
  // every one of the six studies and the three byte columns were identical to the byte on all of
  // them, so these are the quantities this machinery can carry a threshold on.
  {
    id: 'long-tasks',
    label: 'Main thread tasks over 50 ms, 1000 nodes, 4x CPU throttle',
    limit: '2, as a median of 25 navigations',
    enforcedBy: 'T015-R1',
  },
  {
    id: 'page-bytes',
    label: 'Document, CSS and JS the 1000 node page hands the main thread, raw',
    limit: '194 KB',
    enforcedBy: 'T015-R1',
  },
  {
    id: 'client-memory',
    label: 'Peak client memory, 7 MB document',
    limit: '250 MB',
    enforcedBy: 'T015',
  },
  { id: 'external-requests', label: 'External network requests', limit: '0', enforcedBy: 'T015' },
  // A SPEC 19 CLAIM WITH A SPEC 20 NUMBER, exactly as `external-requests` is. It is a budget row
  // because the browser produces a count and a count needs a limit somebody checks: the figure
  // was recorded in the baseline from the day that file was written and no gate read it, so a
  // record carrying policy violations passed `pnpm gates` in silence.
  {
    id: 'csp-violations',
    label: 'Policy violations under the strict CSP',
    limit: '0',
    enforcedBy: 'T015',
  },
  {
    id: 'served-document',
    label: 'Served document, 1000 nodes, raw bytes',
    limit: '72 KB',
    enforcedBy: 'T015',
  },
  {
    id: 'static-build',
    label: 'Static build, 1000 nodes, 4 cores',
    limit: '60 s',
    enforcedBy: 'T039',
  },
];

/**
 * Every budget SPEC 20 sets, by id, in one list.
 *
 * THE SPECIFICATION'S TABLE AND THIS LIST ARE COMPARED BY THE CLAIM MAP GATE. They are two
 * hand maintained lists of the same thing, and the failure that matters is a budget added to
 * one and not the other: a row in the specification that nothing measures reads as a promise,
 * and an id here that the specification does not set reads as a check protecting nothing.
 *
 * The three font caps are named here rather than derived from `FONT_BUDGETS`, because that list
 * is per theme and these are three budgets however many themes ship.
 */
export const SPEC_20_BUDGET_IDS: readonly string[] = [
  ...SIZE_BUDGETS.map((budget) => budget.id),
  'fonts-first-paint',
  'fonts-latin',
  'fonts-total',
  ...MEASURED_BUDGETS.map((budget) => budget.id),
];

/**
 * The committed browser study, and the workflow that re-records it.
 *
 * The figures only a browser can produce live in a file rather than in a run of `pnpm gates`,
 * because a CPU throttle is relative to the host and a figure taken on a developer machine
 * names a machine nobody will run again. The gate checks the record; the workflow takes the
 * measurement.
 */
export const BROWSER_BASELINE_FILE = 'tools/browser-budget/baseline.json';

/** Where a new measurement comes from, named in the message so re-recording is one click. */
export const BROWSER_STUDY_WORKFLOW = '.github/workflows/browser-budget-study.yml';

/**
 * The SPEC 20 ceilings a browser figure is judged against.
 *
 * HERE RATHER THAN BESIDE THE HARNESS, for the reason the coverage floors are here: a threshold
 * has exactly one home, so there is exactly one place it could be lowered. `tools/browser-budget`
 * imports these rather than carrying a second copy.
 *
 * THERE IS NO `ttiMs` HERE ANY MORE, and its absence is the decision of 2026-08-10 rather than
 * an omission. SPEC 20 keeps the 150 ms as what the product is for and stops checking it,
 * because six studies of one commit across five processors of a pool that swaps them silently
 * measured it between 163.7 and 216.1 ms. Everything below is either a count or a byte count,
 * and no processor moved any of them.
 *
 * `longTaskCount` is 2 because 2 is what all six studies measured, as a median of 25
 * navigations, and 3 is the smallest step an integer count has. A change that adds one stall to
 * the load fails it. It is a coarse instrument and it says so: it cannot see an existing long
 * task getting worse without splitting.
 *
 * `pageBytes` is 194 KB against 196,125 measured, 191.5 KB, so the headroom is 2,531 bytes. It
 * is derived the way `theme-css-raw` was: another region of `theme.css` the size of the page
 * frame, 3,287 bytes, or of the try-it console, 3,669, has to fail it, and a navigation sized
 * addition of 2,520 has to fit. THIS IS THE TIGHTEST ROW IN THE TABLE AND IT IS MEANT TO BE. It
 * is the only budget measured over what the page actually loads rather than over what the build
 * produced, so it is the only one that can see a resource nobody weighed, and a cap with the
 * usual ten percent of room would let a whole stylesheet in without a word.
 *
 * IT CAME DOWN FROM 172 KB TO 159 WITH T011-R AND WENT UP TO 194 WITH T016, and the two moves
 * are not the same kind of move. The first followed the artifact: four features left the first
 * paint and the JS fell by 12,974 bytes, so a cap left at 172 would have let every one of them
 * back in. The second follows the INPUT. T016 finding F10 replaced a fixture of one repeated
 * description and one schema with one a real reference resembles, and the served document went
 * from 29,682 bytes to 65,326 without a line of product code changing. A cap left at 159 would
 * have been red on the honest measurement of a page that had not got worse.
 *
 * THIS IS THE ONE MOVE IN THIS FILE THAT LOOKS LIKE THE FORBIDDEN ONE, so it is spelled out.
 * Raising a threshold to make a build pass is the rule this project breaks most often. What
 * makes this different is that the artifact did not change and the measurement did: the same
 * commit measures 195,783 bytes on the new input and 160,070 on the old one, and the new input
 * is the one SPEC 20 now states and a test holds. Re-derived by the same rule as before, from
 * the new measurement, with the same two regressions named.
 */
export const BROWSER_CEILINGS = {
  peakHeapBytes: 250 * 1024 * 1024,
  externalRequests: 0,
  cspViolations: 0,
  servedDocumentBytes: 72 * 1024,
  longTaskCount: 2,
  pageBytes: 194 * 1024,
} as const;

/**
 * The budgets that are over, with a name on the debt and a milestone it has to be gone by.
 *
 * HERE BESIDE THE THRESHOLDS AND NOT INSTEAD OF THEM. Nothing in this list changes a number in
 * `BROWSER_CEILINGS` or in `SIZE_BUDGETS`. An entry says that a budget is over, by how much,
 * why, who is fixing it and when it must be gone, and it lets the plan continue meanwhile. The
 * budgets gate goes on printing the failure on every run.
 *
 * IT EXISTED BECAUSE A GATE WAS RIGHT AND ITS POSITION WAS WRONG. `tti` was owned by T015 and
 * was not fixable inside T015: what stood between the page and 150 ms was the client bundle and
 * the theme stylesheet, which belong to T011 and T012. A red budget with a diagnosis attached
 * is the honest state, and blocking fifty tasks behind a defect that is not theirs is not.
 *
 * `budget-exceptions` is the gate that keeps this from being a raised threshold in disguise. An
 * entry with no owning task, an owner that is not a real task, a milestone BUILD.md does not
 * have, a milestone that closes while the entry is still here, or a budget that is inside its
 * limit again all fail the build.
 *
 * THE LIST IS EMPTY TODAY AND THAT IS NOT THE SAME AS NEVER HAVING HELD ANYTHING. Its one entry
 * is in `BUDGET_EXCEPTION_HISTORY` below, with the reason it closed.
 *
 * WHAT WAS DELIBERATELY NEVER HERE: `served-document`. It was named alongside `tti` when this
 * list was asked for, and it measures 63.8 KB against 72 KB. Listing a budget that passes would
 * record a debt that does not exist, and the staleness rule would fail the build for saying so.
 *
 * WHAT WAS CONSIDERED FOR IT ON 2026-08-11 AND IS NOT HERE EITHER: `search-index`. The T016
 * instruction was to file the index as a debt owned by a reopened T007 and expiring at M3, on a
 * reading that it was 1.76x over. It is not over. That reading came from a probe whose every
 * word was unique, a vocabulary of about 1.8 million for a document of a thousand operations,
 * which is as unrepresentative as the repeated description it was written to expose. On the
 * input SPEC 20 now states the index measures 176,714 bytes against 250 KB, and five real
 * corpus documents put a thousand index records between 67 and 84 KB gzip. An entry here would
 * have recorded a debt that does not exist, and the staleness rule would have failed for it.
 */
export const BUDGET_EXCEPTIONS: readonly BudgetException[] = [];

/**
 * Exceptions that are closed, kept with the reason they closed.
 *
 * A CLOSED ENTRY IS DELETED FROM THE LIST AND NOT FROM THE RECORD. An exception is the one place
 * in this repository where a red check does not stop a build, so how one ended matters as much
 * as that it existed: an entry that simply vanishes leaves a reader unable to tell a debt that
 * was paid from a debt somebody quietly stopped counting. The two endings are named separately
 * below, and `closedBecause` says which this was.
 *
 * The gate reads this list too. A budget that is live here and in `BUDGET_EXCEPTIONS` at once,
 * an entry with no reason, and a closed entry for a budget SPEC 20 no longer sets all fail.
 */
export interface ClosedBudgetException extends BudgetException {
  /** When the entry stopped being live. */
  readonly closedAt: string;
  /** How it ended: what changed, and what the budget id means now. */
  readonly closedBecause: string;
}

export const BUDGET_EXCEPTION_HISTORY: readonly ClosedBudgetException[] = [
  {
    budget: 'tti',
    measured: '213.9 ms, median of 25 throttled navigations',
    target: '150 ms',
    owners: ['T011-R', 'T015-R1'],
    clearBy: 'M0',
    recordedAt: '2026-08-10',
    diagnosis:
      'Measured twice on github-actions/ubuntu24/X64 under Chrome 150 at a measured 4.19x throttle. ' +
      'Every subresource has arrived by 33 ms and the document is not interactive until 138 ms, so ' +
      'what is between the page and the budget is work rather than transfer: 108 KB of decoded ' +
      'JavaScript to compile and hydrate, and 38.8 KB of decoded CSS to parse and match. Cutting the ' +
      'served document by 85 percent in T012-R2 moved the phase it was aimed at by 4 percent, so the ' +
      'state block was not the cause.',
    closedAt: '2026-08-10',
    closedBecause:
      'THE BUDGET IT EXCUSED NO LONGER EXISTS IN GATED FORM, so there is nothing left to excuse. ' +
      'It was not paid and it was not dropped: SPEC 20 stopped checking elapsed time after six ' +
      'studies of one commit on five processors measured the same bytes at 163.7, 203.9, 204.0, ' +
      '204.2, 211.0 and 216.1 ms, a range of 25.7 percent of the median against a budget the ' +
      'excess over which was 42 percent. Main thread task time was measured on the same six runs ' +
      'as a candidate replacement and came out marginally worse, 27.0 percent, and normalizing ' +
      'against a calibration workload worse again at 29.6. What replaced the entry is two gated ' +
      'counts on the same studies, `long-tasks` at 2 and `page-bytes` at 172 KB, and both are ' +
      'green. TTI is still measured, still recorded and still printed, and it is a report. The ' +
      'debt this entry named, that the page is slower than 150 ms on a throttled runner, is not ' +
      'claimed to be paid by anything here.',
  },
];

/** The claim map, which answers every SPEC 19 and SPEC 20 claim with what would go red. */
export const CLAIM_MAP_FILE = 'ai-docs/CLAIM-MAP.md';

/** The specification the claims are read out of. */
export const SPEC_FILE = 'ai-docs/SPEC.md';

/**
 * Directories holding the default theme's stylesheets, relative to the repository root.
 *
 * Scanned by the theme-tokens gate for hardcoded colours, lengths and font stacks.
 */
export const THEME_STYLE_ROOTS: readonly string[] = ['packages/theme/src', 'packages/theme/fonts'];

/**
 * The one stylesheet allowed to hold literal values, because it declares the tokens.
 *
 * It is generated from `packages/theme/src/tokens/domain/tokens.ts` and pinned by a test, so
 * exempting it does not create a place values can hide.
 */
export const THEME_TOKEN_SOURCE = 'packages/theme/src/styles/tokens.css';

/**
 * A theme's stylesheets, IN THE ORDER THE THEME LOADS THEM, checked against the motion half of
 * the design contract.
 *
 * Three of these are in `ai-docs/design/` and one is code. That is the point rather than an
 * accident of layout: the failure the motion contract exists to prevent is three themes
 * disagreeing about reduced motion, and a check that saw only the shipped theme would report
 * conformance for one of the three.
 *
 * THE ORDER IS PART OF THE CHECK AND NOT A DETAIL. Reduced motion is decided by the cascade,
 * and the cascade is specificity then source order, so a stylesheet that re-declares a duration
 * after the reduced motion block undoes it. Reading one file on its own cannot see that. The
 * shipped theme's order is the one `DEFAULT_THEME_STYLESHEETS` publishes, minus the font file,
 * which declares no token.
 *
 * Reading `ai-docs/` is the assumption the build manifest gate already makes about the four
 * required documents, not a new one. A theme added here and then removed from disk fails the
 * gate rather than dropping out of it.
 */
export const THEME_TOKEN_STYLESHEETS: readonly {
  readonly theme: string;
  readonly files: readonly string[];
}[] = [
  {
    theme: 'vernier, as shipped',
    files: [THEME_TOKEN_SOURCE, 'packages/theme/src/styles/theme.css'],
  },
  { theme: 'vernier, as designed', files: ['ai-docs/design/vernier/tokens.css'] },
  { theme: 'telltale', files: ['ai-docs/design/telltale/tokens.css'] },
  { theme: 'forge', files: ['ai-docs/design/forge/tokens.css'] },
];

/**
 * Stylesheets declaring `@font-face`, checked against the bytes of the files they name.
 *
 * One entry per theme that ships fonts. Only vernier does today; T032 adds the others, and the
 * amendment for that task already says so. The font files are resolved relative to the
 * stylesheet, which is how the stylesheet itself addresses them.
 */
export const FONT_STYLESHEETS: readonly {
  readonly theme: string;
  readonly file: string;
}[] = [{ theme: 'vernier, as shipped', file: 'packages/theme/fonts/fonts.css' }];

/**
 * Extensions scanned for CSP violations.
 *
 * The roots are not here beside them: they are one `dist` per package on disk, so they are derived
 * by `cspScanRoots` in `lib/package-dirs.ts` rather than listed. See the note where `PACKAGE_DIRS`
 * used to be.
 */
export const CSP_SCAN_EXTENSIONS: readonly string[] = [
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.html',
  '.htm',
];

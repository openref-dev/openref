/**
 * Gate configuration: the budgets and floors from SPEC 20 and STANDARDS 9.1 and 12.
 *
 * Nothing in this file is ever raised or lowered to make a build pass. If a value here is
 * genuinely wrong, `ai-docs/SPEC.md` changes first.
 */

import { ASSET_ALLOWED_LICENSES, FIXTURE_ALLOWED_LICENSES } from './lib/fixtures.js';
import type { BudgetException } from './lib/budget-exceptions.js';
import type { CapabilityDebt } from './lib/capability-debts.js';
import type { BudgetQuantity } from './lib/budgets.js';
import type { DeferredGesture } from './lib/module-graph.js';
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
  // THE VERSION HISTORY IS A SECOND ROOT RATHER THAN MORE CORPUS DOCUMENTS. The corpus is one
  // version of many documents and every file in it gets a normalization snapshot; the history is
  // many versions of one document and is read pairwise by the T038 diff suite. Mixing them would
  // put twenty four near identical petstore snapshots into the corpus for nothing.
  {
    directory: 'packages/core/test/history',
    producedBy: 'T038',
    filesDirectory: 'documents',
    noticeFile: 'NOTICE',
    manifestKey: 'documents',
    allowedLicenses: FIXTURE_ALLOWED_LICENSES,
    extensions: ['.json', '.yaml', '.yml'],
    readsLicenseText: false,
    label: 'version(s)',
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
  // FONTS ARE PER PACKAGE AND DUPLICATED ON PURPOSE, per the T032 amendment. The four JetBrains
  // Mono files here are byte identical to the four above and are a copy rather than a link: byte
  // deduplication holds in this repository and in `node_modules` and does not hold in a published
  // tarball, and attribution that lived one package away would stop travelling with the bytes.
  {
    directory: 'packages/theme-telltale/fonts',
    producedBy: 'T032',
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
  /**
   * Which gesture's download this budget bounds, out of the deferred side.
   *
   * Absent on the deferred side would be the whole of it, and since 2026-08-12 no budget is
   * written that way: see `CLIENT_JS_GESTURES` for why one cap over everything behind a dynamic
   * import stopped describing one thing.
   */
  readonly gesture?: string;
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
  /**
   * True for a bundle that inlined its gestures on purpose, the Web Component outputs first.
   *
   * The deferral audit does not apply to it: everything is in the first paint because the
   * artefact is one file by design, an embed with no asset catalog to rewrite chunk names
   * through, and what bounds that trade is its own whole cost budget rather than the split.
   * The presence half of the audit still applies in full.
   */
  readonly inlined?: boolean;
}

export const SHIPPED_CLIENT_BUNDLES: readonly ShippedClientBundle[] = [
  {
    label: '@openref/nest',
    file: 'packages/nest/dist/browser/openref.js',
    roots: ['packages/nest/dist/browser'],
  },
  // The Web Component outputs, since T033: one file each in a directory each, because the
  // registry models an entry plus its chunk closure per directory, and their deferred side is
  // empty by construction, the honest reading of a bundle that inlined its gestures.
  {
    label: '@openref/nest, Web Component',
    file: 'packages/nest/dist/browser-wc/openref-element.js',
    roots: ['packages/nest/dist/browser-wc'],
    inlined: true,
  },
  {
    label: '@openref/nest, Web Component IIFE',
    file: 'packages/nest/dist/browser-iife/openref-element.iife.js',
    roots: ['packages/nest/dist/browser-iife'],
    inlined: true,
  },
  // The themed entry of telltale, since T033: the same closure as the default entry plus the
  // theme, split the same way, so the same gesture roots divide its deferred side.
  {
    label: '@openref/theme-telltale/entry',
    file: 'packages/theme-telltale/dist/entry/entry.js',
    roots: ['packages/theme-telltale/dist/entry'],
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

/**
 * The deferred half, divided by the gesture that pays for it.
 *
 * ONE CAP OVER "EVERYTHING BEHIND A DYNAMIC IMPORT" STOPPED DESCRIBING ONE THING, and that is why
 * this list exists. Written 2026-08-12 at the close of T026, replacing `client-js-deferred` and
 * `client-js-deferred-raw`. Those two were derived in T011-R as measured plus ten percent over an
 * M0 artefact: three small components, one of them the console as it was before the serialization
 * matrix existed. SPEC 14.1 then puts the full matrix, every remaining auth scheme, the same
 * origin proxy and streaming into M2, and every one of them lands on one side of this list, the
 * Send side, by construction. A cap over the union would have gone red on `T026` through `T030`
 * for a reason that has nothing to do with the reader who opens the palette, and the sentence it
 * printed, "the deferred half grew", would have been true and useless.
 *
 * SO THE DIVISION FOLLOWS THE READER AND NOT THE DIRECTORY. A press on Send downloads one set of
 * chunks, opening the palette another, expanding a schema a third, and each cap now says what
 * gesture pays for it. What a budget going red means afterwards is a sentence somebody can act
 * on: pressing Send costs more than it did.
 *
 * THE HEALTH PANEL IS NOT A FOURTH, and it was named as one when this split was asked for. It has
 * had no chunk since 2026-08-12: it has no state, no handler and no client render, so it became
 * server markup the client adopts, and its chunk left the bundle with the copy of its findings.
 * A gesture declared for it would name a root that matches nothing, which this list fails on.
 *
 * ONE ENTRY PER BUNDLE, and there is one bundle. When T039 adds the static build's own, it says
 * what gestures divide it or records that it has none, for the reason `SHIPPED_CLIENT_BUNDLES`
 * gives: silence is not an answer.
 */
export const CLIENT_JS_GESTURES: readonly DeferredGesture[] = [
  {
    // THE RUNNER IS ON THIS SIDE BY DECLARATION, BECAUSE THE GRAPH PUTS IT SOMEWHERE ELSE. Since
    // T033 the entry's dynamic import is `runner-factory.ts`, the module that reads `proxyPath`
    // off the page model and constructs the runner, and the runner's own chunk merged into it,
    // which is the shape the T033 amendment measured as cheaper on both sides. The only thing
    // that ever calls the factory is the console's own loader, one line before it returns the
    // panel, so a reader who presses Send downloads both and a reader who opens the palette
    // downloads neither.
    //
    // `runner-factory` IS WHAT THE BUNDLER CALLS THAT CHUNK, from its source module's name, and
    // it is written here rather than made prettier because renaming it would be a second copy
    // of a name esbuild already decides. If the factory module ever moves, this root matches
    // nothing and the budget fails loudly, which is the failure mode this was chosen for.
    id: 'send',
    roots: ['TryItPanel', 'runner-factory'],
  },
  { id: 'palette', roots: ['CommandPalette'] },
  { id: 'schema', roots: ['SchemaView'] },
  {
    // THE FIFTH GESTURE IS THE VALUE DRIVEN FORM, added at TX-SHAPES: a reader who reaches
    // into the filling half of a shapes page downloads the engine, and nobody else does. The
    // reading half is server markup the client adopts, so it is deliberately not here: it has
    // no chunk, the Health panel precedent.
    id: 'shapes',
    roots: ['ShapesFillPanel'],
  },
  {
    // THE FOURTH GESTURE IS THE ONE A READER MAKES ON A DIFFERENT PAGE LOAD, added at T028. An
    // authorization server returns the reader to the callback route, which sends them back to the
    // page they started from; that load carries a marker in its url, and the entry fetches this
    // chunk to finish the exchange. Every other load does not, which is what makes it a gesture
    // rather than part of the first paint, and the entry pays one string comparison for the
    // difference.
    //
    // WHAT THIS DOES NOT COUNT IS THE RUNNER, AND THE REASON IS THE SAME ONE THE SEND ENTRY GIVES
    // ABOUT IT. Finishing an exchange needs the runner, which the landing reaches through the
    // `loadRunner` function the host handed over rather than through an import of its own, so no
    // graph shows the edge. It is declared under `send`, is the same chunk either way, and a
    // reader who comes back from a sign in has pressed Sign in in the console already, so it is
    // a chunk they have.
    id: 'sign-in-return',
    roots: ['oauth-landing'],
  },
];

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
    // IT IS DELIBERATELY TIGHTER THAN THE USUAL TEN PERCENT, and the reason is what this budget
    // is for. T011-R measured 97,920 raw bytes across six files and set 98 KB rather than the
    // 105 KB ten percent would have given, because at 105 KB any two of the three deferred
    // features could come back into the first load without a word.
    //
    // 103 KB SINCE `TX-SLOTWIRE`, RE-DERIVED FROM ITS OWN MEASUREMENT AND ITEMISED, which is the
    // move this comment already described as the allowed one: a task that needs more room says so
    // and moves the number deliberately, with the artefact change named. Measured 104,503 raw
    // bytes across six files with the slot registry wired into the shipped renderer, against
    // 100,352 before it. The 4,151 bytes are, in order:
    //
    // - 2.9 KB, the positions of the registry extracted into components. `OperationHeader`,
    //   `ParamTable`, `ResponseList`, `DriftCard`, `ProvenanceTag`, `StateNotice`, `AppShell`,
    //   `DocumentOverview` and `SchemaPage` were markup inside four render functions and are now
    //   components a theme can replace. This is the feature: before it, an L1 override changed
    //   nothing on any page a reader opens
    // - 0.7 KB, the call samples block of SPEC 18, which is a position that did not exist. The
    //   registry carried the name `CodeSample` and nothing resolved it
    // - 0.5 KB, the registry and the layout resolution on the client. It was 1.2 KB until the
    //   theme validation was split out of the browser path, per `resolveSlots`: a theme is
    //   refused where it is authored and on the server, and the refusals are not bytes a reader
    //   downloads
    // - 0.2 KB, the twelve `useSlot` lookups themselves, which is the cheapest part of it
    //
    // 102 KB SINCE T031, AND THIS ONE IS A CAP COMING DOWN RATHER THAN GOING UP. T031 took 962
    // bytes out of the first paint by moving `useRunner` off the barrel `@openref/render` imports
    // and onto `@openref/vue/runner`, which no page reaches until a reader opens the console;
    // measured 103,541 raw across the same six files, against 104,503. A cap left at 105,472 with
    // that measurement under it stops holding the property it was chosen for, which is the
    // sentence below, so it moves with the artefact rather than banking the slack.
    //
    // THE PROPERTY, AND IT IS WHAT DERIVES THE NUMBER RATHER THAN TEN PERCENT: the smallest
    // deferred feature returning to the first load fails this budget. `sign-in-return` is 1,323
    // raw, so any cap at or above 104,864 would let it back in silently, and 102 KB is 104,448.
    // What is left for ordinary work is 907 bytes, against the 969 `TX-SLOTWIRE` left and the
    // 2,432 T011-R left, and that is stated rather than smoothed over. The one named way to pay
    // bytes back is `TX-ADOPT` in `ai-docs/BUILD-AMENDMENTS.md`: the static positions of a node
    // page have no client state and no handler, so the browser could adopt their markup the way
    // it has adopted the Health panel since session 40.
    //
    // 105 KB SINCE `TX-ADOPT`, RE-DERIVED FROM ITS OWN MEASUREMENT BY THE SAME PROPERTY, and it
    // is the payment landing rather than the debt growing. Measured 107,110 raw across six
    // initial files, against 117,424 when the exception was filed: adoption took the header,
    // the runtime panel with its cards and marks, the description and security sections, the
    // parameters table, the responses section with the contracts grid, the overview article and
    // the states catalogue out of the first paint, 10,314 bytes paid. What remains above the
    // pre TX baseline of 103,834 is live by necessity and named: the remembered operation's
    // handlers, the schema page's view segment, the sample tabs, the frame with the rail, and
    // the adoption's own stubs and walk. 105 KB is 107,520; `sign-in-return` returning gives
    // 108,433 and fails it, 104 KB is 106,496 and the artefact does not fit, so 105 is the one
    // whole KB step the property allows. Ordinary work has 410 bytes, stated rather than
    // smoothed over; the next byte of first paint growth meets this budget, which is what it
    // is for.
    id: 'client-js-raw',
    label: 'Client JS the first paint loads, raw bytes',
    limitBytes: 105 * 1024,
    roots: CLIENT_JS_ROOTS,
    extensions: ['.js', '.mjs'],
    quantity: 'parse',
    producedBy: 'T011-R, re-derived in TX-SLOTWIRE, T031 and TX-ADOPT',
    partition: { entry: CLIENT_JS_ENTRY, side: 'initial' },
  },
  // THE DEFERRED SIDE IS GATED RATHER THAN RECORDED, and that decision is older than the split
  // below it. The alternative was to print the deferred figures and assert nothing, on the
  // grounds that a reader pays them only on interaction. It was rejected: they are byte counts,
  // which is the one quantity this project's machinery has been able to threshold at all, and an
  // unasserted figure beside an asserted one is the shape SPEC 0 names as a defect class.
  //
  // WHAT CHANGED ON 2026-08-12 IS THE SUBJECT, NOT THE POLICY. `client-js-deferred` and
  // `client-js-deferred-raw` bounded the union of everything behind a dynamic import, at 9 KB
  // gzip and 21 KB raw, both derived in T011-R from an M0 artefact. See `CLIENT_JS_GESTURES` for
  // why one cap over the union stopped measuring anything a reader could act on.
  //
  // EACH OF THE SIX IS THE MEASUREMENT PLUS TEN PERCENT, ROUNDED DOWN TO A HUNDRED BYTES. Taken
  // first on the commit that closed T026 with the whole SPEC 14.2 matrix in the runner: Send
  // 17,035 raw and 6,748 gzip over three chunks, the palette 3,552 and 1,737 over two, the schema
  // tree 3,874 and 1,666 over one. The shared chunk is in both the Send and the palette figures,
  // because a reader who makes one of those gestures and no other downloads it.
  //
  // THE SEND PAIR WAS RE-DERIVED AT T027 AND THE OTHER TWO WERE NOT, which is the split doing its
  // job on the first task after it was made. Request bodies took the runner's chunk from 11,694
  // to 16,020 and the console's from 5,067 to 7,269: the six body forms of SPEC 14.3, the
  // multipart encoder, and three editors in place of one textarea. Send now measures 23,651 raw
  // and 9,125 gzip, so the pair is 26,000 and 10,000. The palette moved by the 88 bytes its share
  // of the shared chunk grew and the schema tree did not move at all, and neither cap was
  // touched: the sentence a red budget prints is still about one gesture.
  //
  // T030 WAS THE LAST OF THE FOUR, AND IT IS THE ONE THAT MOVED THE PAIR MOST. Streaming took the
  // runner's chunk from 36,326 to 43,013 and the console's from 12,995 to 15,420, so the gesture
  // measures 59,940 raw and 20,295 gzip and the pair is 65,900 and 22,300. The palette and the
  // schema tree have not been touched once across four tasks, which is what the split promised.
  //
  // AND THE SEND PAIR IS EXPECTED TO MOVE THROUGH T030, WHICH IS THE POINT OF SPLITTING. SPEC
  // 14.1 puts request bodies, the remaining auth schemes, the proxy and streaming in this
  // milestone, and every one of them is runner code that arrives when a reader presses Send. A
  // task that adds one re-derives this pair from its own measurement and says so in its own
  // words; T034 argues the number the milestone ends on. That is a threshold moving with a named
  // artefact change and a figure attached, which is not the forbidden move: what is forbidden is
  // moving it to make a build pass, and it stays forbidden for the other two pairs, which no M2
  // task is scoped to grow.
  {
    id: 'client-js-send',
    label: 'Client JS a press on Send downloads, gzip',
    // RE-DERIVED AT T030 FROM ITS OWN MEASUREMENT, per SPEC 20: 20,295 measured, plus ten percent,
    // rounded down to a hundred bytes. Streaming is the fourth and last of the M2 tasks that grow
    // this pair by construction, and the sentence a red budget prints is still about one gesture.
    limitBytes: 22_300,
    roots: CLIENT_JS_ROOTS,
    extensions: ['.js', '.mjs'],
    quantity: 'transfer',
    producedBy: 'T011-R, split by gesture in T026, re-derived in T027, T028 and T030',
    partition: { entry: CLIENT_JS_ENTRY, side: 'deferred', gesture: 'send' },
  },
  {
    id: 'client-js-send-raw',
    label: 'Client JS a press on Send downloads, raw bytes',
    // 59,940 measured at T030, plus ten percent, rounded down to a hundred bytes. THE ITEMISATION
    // IS THE POINT OF RE-DERIVING RATHER THAN RAISING: the runner's chunk went 36,326 to 43,013,
    // which is the incremental decoder for both wire formats, the bounded item check of SPEC 14.6,
    // the stream service with its six endings, and the fetch stream adapter; the console's went
    // 12,995 to 15,420, which is the Stream and Stop controls, the bounded window, and the six
    // sentences that tell a reader which ending they got. A third of the runner's growth is
    // message text, which is what "a broken stream is diagnosable" costs and does not minify.
    //
    // AND IT IS EXPECTED TO FALL BY ABOUT 1,258 BYTES AT T033, measured rather than hoped: with
    // the runner built in a module the entry imports dynamically, its chunk merges into that one
    // and one chunk's worth of export and import glue leaves the gesture. The number here is
    // derived on the artefact that exists, not on that one.
    limitBytes: 65_900,
    roots: CLIENT_JS_ROOTS,
    extensions: ['.js', '.mjs'],
    quantity: 'parse',
    producedBy: 'T011-R, split by gesture in T026, re-derived in T027, T028 and T030',
    partition: { entry: CLIENT_JS_ENTRY, side: 'deferred', gesture: 'send' },
  },
  {
    // THE TWO QUANTITIES ARE KEPT ON EVERY GESTURE, and the reason is a plant rather than
    // symmetry. In T011-R appending a byte identical copy of the schema viewer chunk to itself
    // read 22.1 KB raw, over, beside 8.1 KB gzip, inside: a duplicate costs the engine everything
    // and the wire almost nothing. A gesture with one cap would be blind in whichever direction
    // it dropped.
    id: 'client-js-palette',
    label: 'Client JS opening the command palette downloads, gzip',
    // 2,055 measured at `TX-SLOTWIRE`, plus ten percent, rounded down to a hundred bytes. The
    // palette had not moved once across four M2 tasks, and what moved it is the same decision the
    // first paint paid for: the overlay is the `CommandPalette` slot and the state and the search
    // stayed in the host, so a theme replaces the markup without acquiring the index or the
    // shortcut. The split is 578 raw bytes and it is the whole of the change.
    limitBytes: 2_200,
    roots: CLIENT_JS_ROOTS,
    extensions: ['.js', '.mjs'],
    quantity: 'transfer',
    producedBy: 'T011-R, split by gesture in T026, re-derived in TX-SLOTWIRE',
    partition: { entry: CLIENT_JS_ENTRY, side: 'deferred', gesture: 'palette' },
  },
  {
    id: 'client-js-palette-raw',
    label: 'Client JS opening the command palette downloads, raw bytes',
    // 4,478 measured at `TX-SLOTWIRE`, plus ten percent, rounded down to a hundred bytes. See the
    // gzip cap above for what the 578 bytes are.
    limitBytes: 4_900,
    roots: CLIENT_JS_ROOTS,
    extensions: ['.js', '.mjs'],
    quantity: 'parse',
    producedBy: 'T011-R, split by gesture in T026, re-derived in TX-SLOTWIRE',
    partition: { entry: CLIENT_JS_ENTRY, side: 'deferred', gesture: 'palette' },
  },
  {
    id: 'client-js-sign-in-return',
    label: 'Client JS coming back from an authorization server downloads, gzip',
    // 712 measured at T028, plus ten percent, ROUNDED UP to a hundred bytes rather than down. The
    // other seven caps here round down because ten percent of them is thousands of bytes and the
    // rounding is noise; ten percent of 712 is 71, and rounding that down to a hundred lands at
    // 700, which is under the measurement. A budget that is red the day it is written measures
    // nothing.
    limitBytes: 800,
    roots: CLIENT_JS_ROOTS,
    extensions: ['.js', '.mjs'],
    quantity: 'transfer',
    producedBy: 'T028',
    partition: { entry: CLIENT_JS_ENTRY, side: 'deferred', gesture: 'sign-in-return' },
  },
  {
    id: 'client-js-sign-in-return-raw',
    label: 'Client JS coming back from an authorization server downloads, raw bytes',
    // 1,373 measured at T028, plus ten percent, rounded down to a hundred bytes.
    limitBytes: 1_500,
    roots: CLIENT_JS_ROOTS,
    extensions: ['.js', '.mjs'],
    quantity: 'parse',
    producedBy: 'T028',
    partition: { entry: CLIENT_JS_ENTRY, side: 'deferred', gesture: 'sign-in-return' },
  },
  {
    id: 'client-js-schema',
    label: 'Client JS expanding a schema downloads, gzip',
    // 1,977 measured at `TX-MARKUP`, plus ten percent, rounded down to a hundred bytes. What
    // moved it is a capability arriving in this chunk: the permanent field anchor, its
    // mount-time walk that expands the ancestors of a fragment, and the view the segment
    // narrows, per SPEC 11. The old 1,800 held 1,782 until then.
    limitBytes: 2_100,
    roots: CLIENT_JS_ROOTS,
    extensions: ['.js', '.mjs'],
    quantity: 'transfer',
    producedBy: 'T011-R, split by gesture in T026, re-derived in TX-MARKUP',
    partition: { entry: CLIENT_JS_ENTRY, side: 'deferred', gesture: 'schema' },
  },
  {
    id: 'client-js-schema-raw',
    label: 'Client JS expanding a schema downloads, raw bytes',
    // 4,296 measured at `TX-SLOTWIRE`, plus ten percent, rounded down to a hundred bytes. 96 bytes
    // of it: `SchemaView` resolves the position and `SchemaTree` draws it, which is what lets the
    // tree be a slot handed a root and an expander rather than a slice of the document.
    //
    // RE-DERIVED AT `TX-MARKUP`: 4,847 measured, plus ten percent, rounded down to a hundred.
    // The 551 bytes over the old measurement are the anchors and the walk, per the gzip cap
    // beside this one, and they are the feature: a permanent address that expands nothing is a
    // link to the top of the page.
    limitBytes: 5_300,
    roots: CLIENT_JS_ROOTS,
    extensions: ['.js', '.mjs'],
    quantity: 'parse',
    producedBy: 'T011-R, split by gesture in T026, re-derived in TX-SLOTWIRE and TX-MARKUP',
    partition: { entry: CLIENT_JS_ENTRY, side: 'deferred', gesture: 'schema' },
  },
  {
    id: 'client-js-shapes',
    label: 'Client JS reaching into the shapes form downloads, gzip',
    // 4,642 measured at TX-SHAPES on the first build of the engine, over three files, the
    // panel's chunk plus its share of two chunks the console also reaches, counted here for
    // the recorded reason: a reader who makes this gesture and no other downloads them. Plus
    // ten percent, rounded down to a hundred bytes, the T011-R derivation every gesture cap
    // uses.
    //
    // RE-DERIVED AT T039 FROM ITS OWN MEASUREMENT BY THE SAME PROCEDURE: 5,285 measured over
    // the same three files, plus ten percent, rounded down to a hundred bytes. It moved
    // because a capability arrived, not drift, and the movement is itemised on the raw cap
    // beside this one: 182 bytes of T035 pattern safety that landed inside the cap, and 461
    // bytes of the scope machinery the T039 filing in `ai-docs/BUILD-AMENDMENTS.md` mandated.
    limitBytes: 5_800,
    roots: CLIENT_JS_ROOTS,
    extensions: ['.js', '.mjs'],
    quantity: 'transfer',
    producedBy: 'TX-SHAPES, re-derived in T039',
    partition: { entry: CLIENT_JS_ENTRY, side: 'deferred', gesture: 'shapes' },
  },
  {
    id: 'client-js-shapes-raw',
    label: 'Client JS reaching into the shapes form downloads, raw bytes',
    // 13,527 measured at TX-SHAPES over the same three files, plus ten percent, rounded down
    // to a hundred bytes. The engine is the derivation, the conditions translator and the
    // announce logic; the reading half costs this gesture nothing because it is adopted
    // server markup with no chunk at all.
    //
    // RE-DERIVED AT T039, SAME PROCEDURE: 15,384 measured, plus ten percent, rounded down to
    // a hundred bytes. The whole movement is the panel's own chunk, 13,347 to 14,722; the two
    // shared chunks did not move a byte. 482 bytes arrived at T035 inside the cap:
    // `patternVerdict` over core's `isSafePattern` and the `unusable` third verdict, so a
    // document's pattern is refused rather than compiled raw on the render thread. The 1,375
    // of T039 are the scope machinery its filing mandated, named by what it buys: the two
    // walk derivation whose first walk's drawn paths are the second walk's scope,
    // `readCondition` carrying the undrawn fields as the third answer so an unanswerable
    // condition is reported on the row and applies neither branch, an object declaring both
    // `properties` and `patternProperties` drawing both key kinds in both halves, the open
    // tuple that says its tail exists, and a hidden branch's values outside the scope by
    // construction so they can no longer satisfy a visible condition.
    limitBytes: 16_900,
    roots: CLIENT_JS_ROOTS,
    extensions: ['.js', '.mjs'],
    quantity: 'parse',
    producedBy: 'TX-SHAPES, re-derived in T039',
    partition: { entry: CLIENT_JS_ENTRY, side: 'deferred', gesture: 'shapes' },
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
    //
    // RECOMPUTED AT T033, 34 TO 35 KB, FOR THE SANCTIONED REASON: the input changed. The Web
    // Component emits `oref-embed-error`, a class the renderer did not have, and the rule that
    // styles it is 267 bytes the sweep in `theme.spec.ts` requires to exist. Measured 35,083
    // after it; 35 KB keeps the property above, a console sized region still lands over the cap.
    //
    // RECOMPUTED AT TX-GUTTER, 35 TO 41 KB, FOR THE SAME SANCTIONED REASON AT A LARGER SCALE:
    // it moved because the renderer emits a class family the two way sweep must style, which is
    // a capability arriving, not drift. The parity scale of SPEC 6.3 is a class family the
    // renderer did not have, the maintainer ordered the region by name, and the sweep in
    // `theme.spec.ts` requires every emitted class styled, so no amount of theme work removes
    // the requirement. Measured 39,312 after it, with the dead labelled row rules already taken
    // back out: 26,979 theme.css, 8,122 tokens.css, 4,211 fonts.css. WHY A RECOMPUTED CAP AND
    // NOT A LEDGER ENTRY, since the exceptions doctrine sends artefact growth to the ledger: an
    // exception must name a payer who can clear it, and no future task deletes required
    // styling, so an entry here would be a debt nobody can pay, which is a raised threshold
    // wearing a ledger entry.
    //
    // RECOMPUTED AT TX-FRAME, 41 TO 46 KB, SAME REASON, SAME WORDS: it moved because the
    // renderer emits a class family the two way sweep must style, which is a capability
    // arriving, not drift. The frame of SPEC 11 arrived: the app bar with back, crumb and the
    // tab bar, the rail statistics and drift counters, the four page articles, and the
    // container query collapse of the parity scale at the measured 500px threshold. Measured
    // 44,179 after it: 31,659 theme.css, 8,309 tokens.css, 4,211 fonts.css. 46 KB is 47,104
    // and keeps the derived property exactly: a navigation sized region, 2,520, still fits,
    // 46,699 under the cap; a page frame sized one, 3,287, and a console sized one, 3,669,
    // still land over it.
    //
    // RECOMPUTED AT TX-MARKUP, 46 TO 53 KB, SAME REASON, SAME WORDS: it moved because the
    // renderer emits a class family the two way sweep must style, which is a capability
    // arriving, not drift. The cheap markup of the layout arrived: the kicker, the drift box
    // and the bench link, the merged responses with the flagged undocumented row, the error
    // contracts grid with its three provenance edged groups, the schema page's dialect line,
    // view segment and field anchors, the rail's method badge and path, and the key chip; and
    // the syntax group of 13 landed in tokens.css, per CONTRACT.md. Measured 51,576 after it:
    // 37,658 theme.css, 9,707 tokens.css, 4,211 fonts.css. 53 KB is 54,272 and is the one
    // whole KB step that keeps the derived property exactly: a navigation sized region,
    // 2,520, still fits, 54,096 under the cap; a page frame sized one, 3,287, and a console
    // sized one, 3,669, still land over it.
    //
    // RECOMPUTED AT TX-PARITY-UI, 53 TO 56 KB, SAME REASON, SAME WORDS, FOURTH ARRIVAL: it
    // moved because the renderer emits a class family the two way sweep must style, which is
    // a capability arriving, not drift. The parity report's remaining markup arrived: the SSE
    // badge, the header meta line, the parameter table's runtime columns and drift row, the
    // compact response row's phrase and schema link, the health page's KPI triple, rule
    // sentence and zero row, the schema tree's read only mark, the anchor explanation, the
    // bench kicker and its actions row with Reset. Measured 54,560 after it: 40,642
    // theme.css, 9,707 tokens.css, 4,211 fonts.css. 56 KB is 57,344 and is the one whole KB
    // step that keeps the derived property exactly: a navigation sized region, 2,520, still
    // fits, 57,080 under the cap; a page frame sized one, 3,287, and a console sized one,
    // 3,669, still land over it.
    //
    // RECOMPUTED AT TX-SHAPES, 56 TO 61 KB, SAME REASON, SAME WORDS, FIFTH ARRIVAL: it moved
    // because the renderer emits a class family the two way sweep must style, which is a
    // capability arriving, not drift. The shapes page of SPEC 11 arrived: the two column
    // grid with its container query collapse, the reading rows with their requiredness and
    // condition cells, the seven nesting steps, the status line, the field, hint and mark
    // families of the filling half, and the chooser, pattern and tuple blocks. Measured
    // 59,412 after it: 45,494 theme.css, 9,707 tokens.css, 4,211 fonts.css. 61 KB is 62,464
    // and is the one whole KB step that keeps the derived property exactly: a navigation
    // sized region, 2,520, still fits, 61,932 under the cap; a page frame sized one, 3,287,
    // and a console sized one, 3,669, still land over it.
    id: 'theme-css-raw',
    label: 'Default theme CSS, raw bytes',
    limitBytes: 61 * 1024,
    quantity: 'parse',
    roots: THEME_CSS_ROOTS,
    extensions: ['.css'],
    producedBy: 'T009, recomputed at TX-GUTTER, TX-FRAME, TX-MARKUP, TX-PARITY-UI and TX-SHAPES',
  },

  // THE WEB COMPONENT OUTPUTS OF SPEC 10.3, both files of one directory under one cap pair,
  // since T033. Single file each, deliberately: an embed has no asset catalog to rewrite chunk
  // names through, so the element pays its whole cost once, and the cap says what that cost may
  // be. Derived the way T011-R derived its caps: measured on the first build, 353,710 raw and
  // 124,942 gzip for the pair, plus ten percent headroom, rounded to a whole KiB.
  //
  // RE-DERIVED AT TX-SHAPES FROM ITS OWN MEASUREMENT, the named artefact change being the one
  // an inlined bundle cannot avoid: every gesture is in the file by design, so the frame, the
  // markup and the collectors columns of TX-FRAME through TX-PARITY-UI and now the shapes
  // engine and reading rows all landed inside both formats. Measured 410,322 raw and 141,982
  // gzip for the pair, plus ten percent, whole KiB. The trade the comment above names is
  // unchanged: what bounds an embed is its whole cost, and this is that cost, measured.
  {
    id: 'client-wc',
    label: 'Web Component outputs, both formats, transfer',
    limitBytes: 153 * 1024,
    quantity: 'transfer',
    roots: ['packages/nest/dist/browser-wc', 'packages/nest/dist/browser-iife'],
    extensions: ['.js'],
    producedBy: 'T033, re-derived at TX-SHAPES',
  },
  {
    id: 'client-wc-raw',
    label: 'Web Component outputs, both formats, raw',
    limitBytes: 441 * 1024,
    quantity: 'parse',
    roots: ['packages/nest/dist/browser-wc', 'packages/nest/dist/browser-iife'],
    extensions: ['.js'],
    producedBy: 'T033, re-derived at TX-SHAPES',
  },

  // THE THEMED ENTRY OF `@openref/theme-telltale`, the whole directory, entry and chunks, since
  // T033: what a page under that theme downloads across every gesture. Derived the same way:
  // 198,034 raw and 72,088 gzip measured on the first build, plus ten percent, whole KiB.
  //
  // RE-DERIVED AT TX-SHAPES, same move as the pair above: the directory holds every gesture's
  // chunk, so the shapes engine's chunk and the entry growth of the TX work land here by
  // construction. Measured 226,778 raw and 81,562 gzip, plus ten percent, whole KiB.
  {
    id: 'theme-entry',
    label: 'telltale themed entry, whole directory, transfer',
    limitBytes: 88 * 1024,
    quantity: 'transfer',
    roots: ['packages/theme-telltale/dist/entry'],
    extensions: ['.js'],
    producedBy: 'T033, re-derived at TX-SHAPES',
  },
  {
    id: 'theme-entry-raw',
    label: 'telltale themed entry, whole directory, raw',
    limitBytes: 244 * 1024,
    quantity: 'parse',
    roots: ['packages/theme-telltale/dist/entry'],
    extensions: ['.js'],
    producedBy: 'T033, re-derived at TX-SHAPES',
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
  // THE FIRST PAINT PAIR IS ONE FACE FROM EACH FAMILY HERE, AND THAT IS WHY THE PAIR IS NAMED PER
  // THEME RATHER THAN DERIVED. vernier waits on its sans regular and its mono regular; telltale is
  // all one mono, and what it also waits on is the display face every strip heading is set in.
  // Which faces a first paint waits on is a fact about a design, and a rule that guessed it from a
  // position in a list would have been right once.
  {
    theme: '@openref/theme-telltale',
    directory: 'packages/theme-telltale/fonts',
    firstPaint: ['JetBrainsMono-400-latin.woff2', 'MartianMono-700-latin.woff2'],
    latin: [
      'JetBrainsMono-400-latin.woff2',
      'JetBrainsMono-700-latin.woff2',
      'MartianMono-700-latin.woff2',
    ],
    producedBy: 'T032',
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
    limit: '203 KB',
    enforcedBy: 'T015-R1, re-derived at the close of M2',
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
 * `pageBytes` is 203 KB against 204,818 measured on the runner over the committed tree at
 * commit 74510c5, three studies of one dispatch and the workstation identical to the byte:
 * 37,894 document, 59,582 CSS, 107,342 JS. The headroom is 3,054 bytes, and it is derived the
 * way `theme-css-raw` was: another region of `theme.css` the size of the page frame, 3,287
 * bytes, or of the try-it console, 3,669, has to fail it, and a navigation sized addition of
 * 2,520 has to fit; 203 KB is the one whole KB step that keeps the property, 207,338 under
 * 207,872 and 208,105 over it. THIS IS THE TIGHTEST ROW IN THE TABLE AND IT IS MEANT TO BE. It
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
 *
 * IT WENT OVER ON 2026-08-11 AND STAYED AT 194 KB FOR THE WHOLE OF M2, which is the point of
 * the sentence above being written before the budget was ever exceeded. T020 through T023 took
 * the record to 199,612 bytes on the same input, the deficit was 956, and the number here did
 * not move: the debt was an entry in `BUDGET_EXCEPTIONS`, owned by T012-R4 and due to clear by
 * M2, and the budgets gate printed the failure on every run until the entry closed.
 *
 * RE-DERIVED AT THE CLOSE OF M2, 194 TO 203 KB, FOR THE SANCTIONED REASON AT THE PAGE LEVEL,
 * by the maintainer's decision recorded in SPEC 20 and in T012-R4: it moved because the
 * renderer emits class families the two way sweep must style, which is a capability arriving,
 * not drift. The TX-GUTTER through TX-SHAPES chain grew the stylesheet 24,329 bytes over the
 * T033 runner record, the parity scale, the page frame, the layout markup, the parity report
 * and the shapes page, and every arrival was sanctioned at its landing by a `theme-css-raw`
 * recomputation, so this cap was counting a quantity whose largest component already had its
 * own budget and its own sanctioned growth path: two budgets over one thing, one moving by
 * rule and one not. TX-ADOPT paid what adoption can reach, 12,494 page bytes, and adoption
 * cannot pay for stylesheet bytes by construction: it takes components off the first paint,
 * and the stylesheet loads whole regardless of what the browser draws. The six mark rules
 * that carry provenance and severity without colour stand untouched per T012-R4's own terms;
 * spending them to hit a number is the pressure that entry exists to name. The remainder,
 * 6,162 over the old cap, is the stylesheet price of shipped capability and is inside the
 * re-derived one. The exception is closed into the history below as paid by its payer and
 * closed by this re-derivation.
 *
 * `longTaskCount` STAYS AT 2 AND HAS NO ROOM LEFT, recorded here because a count with no
 * headroom is one change away from a red build and nothing else in this file would say so. The
 * six studies of 2026-08-12 read 2, 2, 2, 0, 1 and 2 against a cap of 2, where the same page
 * without the runtime block read 1. Nothing is over, so there is no entry: an exception for a
 * budget that is inside its limit fails the staleness rule, and rightly.
 */
export const BROWSER_CEILINGS = {
  peakHeapBytes: 250 * 1024 * 1024,
  externalRequests: 0,
  cspViolations: 0,
  servedDocumentBytes: 72 * 1024,
  longTaskCount: 2,
  pageBytes: 203 * 1024,
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
 * THE LIST IS EMPTY SINCE 2026-08-14, THE CLOSE OF M2. It has held three entries in its life,
 * and all three are in `BUDGET_EXCEPTION_HISTORY` below with the reason each closed. The
 * paragraphs that follow are the recorded rationale of the third, `page-bytes`, kept here
 * because the doctrine they state is the list's and not the entry's.
 *
 * WHY AN ENTRY AND NOT A RECOMPUTED CAP, since `page-bytes` was recomputed once already and the
 * two moves look alike from a distance. The direction is what tells them apart. In T016 the
 * INPUT changed: a fixture of one repeated description was replaced by one a real reference
 * resembles, the served document went from 29,682 bytes to 65,326 with no product code touched,
 * and a cap left where it was would have been red on the honest measurement of a page that had
 * not got worse. Here the ARTEFACT changed: the input is the same document, and the page grew
 * 3,487 bytes because it now carries the runtime block and the Health panel. Recomputing the cap
 * to fit a heavier page is loosening a threshold under a result, which is the move ABSOLUTE RULE
 * 3 names and the one this repository breaks most often. How the entry nevertheless ended in a
 * re-derivation without breaking that rule is recorded in its `closedBecause`: the component
 * that remained over was stylesheet bytes already governed and grown by rule under
 * `theme-css-raw`, so the page cap was bounding the same bytes twice.
 *
 * WHY NOT A NARROWER PANEL EITHER, which was the third option and is the worst of the three.
 * 1,224 of the 1,716 bytes the stylesheet grew are six rules that give provenance and severity an
 * edge style, so that the three confidence levels of SPEC 6.1 and the three severities of SPEC
 * 7.2 are legible with no colour seen at all. Cutting them buys the kilobyte by taking the
 * accessibility claim the whole runtime surface rests on. The closed entry says so, and T012-R4
 * says it again in the words of the fix.
 *
 * AN ENTRY CITING A BASELINE FIGURE CARRIES THE COMMIT ALONGSIDE THE NUMBER, in
 * `measuredAtCommit`, since 2026-08-14 and enforced by the gate for live entries over recorded
 * budgets. Twice in this record a recorded figure was acted on while the tree had moved past
 * it, T026 through T033 first and the TX chain second, and both times the wrong number was the
 * one being read. The commit beside the number is what lets a reader see at a glance that a
 * figure predates the work.
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
  {
    budget: 'client-js-raw',
    measured: '117,424 bytes, 114.7 KB, over by 12,976',
    target: '102 KB, 104,448 bytes',
    owners: ['TX-ADOPT'],
    clearBy: 'M3',
    recordedAt:
      '2026-08-14, at TX-GUTTER, grown at TX-FRAME, TX-MARKUP, TX-PARITY-UI and TX-SHAPES ' +
      'the same day',
    diagnosis:
      'The first paint gained the parity scale of SPEC 6.3: eleven paired rows with verdicts, ' +
      'the FixBar and the empty side treatment, ordered by the maintainer in the TX-GUTTER ' +
      'split. Measured 105,786 bytes across the six initial chunks against a baseline of ' +
      '103,834 at commit 83ba06f, so the scale costs 1,952 raw of which 614 fit the headroom ' +
      'that existed. THE CHEAP BYTES WERE SPENT BEFORE THIS WAS FILED: the labelled rows branch ' +
      'left the default RuntimePanel, because no channel can carry facts before M5 builds the ' +
      'event collectors, and the provenance glyph and code maps were merged. WHAT IS LEFT COSTS ' +
      'THE FEATURE: the paired cells, the gutter verdicts and the FixBar are the product ' +
      'surface the maintainer named. WHY NOT A RECOMPUTED CAP: the cap is derived so that the ' +
      'smallest deferred feature, sign-in-return at 1,323 raw, cannot silently rejoin the first ' +
      'paint, and the artefact grew rather than the input, which the page-bytes doctrine above ' +
      'sends here rather than to the cap. THE PAYER IS THE ONE THE CAP COMMENT ALREADY NAMES: ' +
      'TX-ADOPT adopts the static half of a node page instead of redrawing it, the parity ' +
      'scale is static markup with one link and no handler, exactly the Health panel shape the ' +
      'browser already adopts, and TX-ADOPT is accepted for early M3, so the entry clears by ' +
      'M3 or fails the build asking why not. GROWN AT TX-FRAME, same day: the frame of SPEC 11 ' +
      'entered the first paint, the tab bar with resolved targets, the rail statistics and ' +
      'drift counters, and the page kinds of SPEC 13.3. Measured 109,584 across the same six ' +
      'chunks, so the frame costs 3,798 raw on top of the scale. The frame is the same ' +
      'adoptable shape: links and static markup, one toggle handler set, and the same payer ' +
      'covers it under the same terms. ONE NAMED RESIDUE rather than a hidden one: the states ' +
      'showcase panel rides the entry statically although only its own address draws it; a ' +
      'page-kind gated deferral is new machinery, and TX-ADOPT restructures exactly this ' +
      'boundary, so the residue is named here instead of half built now. GROWN AT TX-MARKUP, ' +
      'same day: the cheap markup of the layout entered the first paint, the header kicker, ' +
      'drift box and bench link, the merged responses with the error contracts grid, the ' +
      'rail method badges, the key chip and the schema page head. Measured 113,261 across ' +
      'the same six chunks, so the markup costs 3,677 raw on top of the frame. It is the ' +
      'same adoptable shape again, static markup and links whose one client handler set is ' +
      'the schema page view segment, and the same payer covers it under the same terms. ' +
      'GROWN AT TX-PARITY-UI, same day: the remembered operation of SPEC 11 entered the ' +
      'first paint, the sessionStorage memory, the frame merge and the rail expansion, plus ' +
      'the badge table, the parameter columns and the compact response row, which also took ' +
      'the response media blocks back out. Measured 117,011 across the same six chunks, so ' +
      'the net is 3,750 raw on top of the markup. The memory is the one part with live ' +
      'handlers; the rest is the same adoptable shape, and the same payer covers it under ' +
      'the same terms. GROWN AT TX-SHAPES, same day, by the smallest step of the five: the ' +
      'shapes page entered the registry, and what the first paint pays is only the gate, ' +
      'the deferral spec of the filling half and the adopt of the reading half, because the ' +
      'engine rides its own gesture chunk and the reading rows are server markup with no ' +
      'chunk at all. Measured 117,424 across seven initial chunks, 413 raw on top of the ' +
      'memory, and the same payer covers it under the same terms.',
    closedAt: '2026-08-14',
    closedBecause:
      'PAID BY THE PAYER IT NAMED, AND CLOSED BY THE RE-DERIVATION ITS OWNER OWED. TX-ADOPT ' +
      'adopted the static half of a node page: the header, the runtime panel with its cards ' +
      'and marks, the description and security sections, the parameters table, the responses ' +
      'section with the contracts grid made single root, the overview article and the states ' +
      'catalogue are server markup the browser adopts through childless elements, and none of ' +
      'their components ride the first paint. Measured 107,110 raw across six initial files ' +
      'against the 117,424 recorded here: 10,314 bytes paid. The cap was then re-derived from ' +
      'that measurement by the property SPEC 20 states, 102 KB to 105 KB, because what remains ' +
      'above the pre TX baseline is live by necessity and named in the cap comment; the ' +
      'sign-in-return chunk returning to the first load still fails the budget, and ordinary ' +
      'work has 410 bytes. The artefact is inside the cap, so the debt is paid rather than ' +
      're-worded; what the adoption could not touch, the stylesheet price of the same ' +
      'capability, stands in the page-bytes entry above with its own figures.',
  },
  {
    budget: 'page-bytes',
    measured: '203,654 bytes, 198.9 KB, over by 4,998',
    measuredAtCommit: '53027c9',
    target: '194 KB, 198,656 bytes',
    owners: ['T012-R4'],
    clearBy: 'M2',
    recordedAt: '2026-08-11, re-measured on the runner 2026-08-14',
    diagnosis:
      'Measured on the runner at commit f457f52, and the same three columns came back identical ' +
      'to the byte on six studies across two dispatches, three processors and a workstation: ' +
      '65,234 document, 34,304 CSS, 100,074 JS. Against the record it replaces the page grew ' +
      '3,487 bytes, CSS up 1,698 and JS up 1,881 while the document fell 92, and what it gained ' +
      'is the runtime block and the Health panel of T023. THE CHEAP BYTES WERE ALREADY SPENT ' +
      'BEFORE THIS WAS FILED: the block is one list of labelled rows rather than five shapes, ' +
      'worth 1.4 KB of the first paint for the same information; every branch that could move to ' +
      'the server did; the panel is behind a dynamic import gated on the one page in a thousand ' +
      'that draws it; and seven pairs of rules in theme.css with identical bodies became one rule ' +
      'each, which is 787 of the bytes. WHAT IS LEFT COSTS THE FEATURE: 1,224 of the 1,716 bytes ' +
      'the stylesheet grew are the six rules that give provenance and severity an edge style, ' +
      'which is how the levels of SPEC 6.1 and SPEC 7.2 are told apart with no colour seen at ' +
      'all. This entry is not an instruction to delete them and T012-R4 states the same in its ' +
      'own terms. It clears by M2 because T031 and T032 rework the theme surface, and a second ' +
      'theme is the first thing that can answer whether a level can be carried by fewer ' +
      'declarations without losing what the declarations do. RE-MEASURED ON THE RUNNER at the ' +
      'close of T033, 2026-08-14, commit 53027c9: 203,654 bytes, 64,741 document, 35,253 CSS, ' +
      '103,660 JS, identical across three studies. The growth over the 2026-08-12 record is ' +
      'the recorded work of T026 through T033, the slot wiring first among it, minus the 493 ' +
      'bytes T005-R1 took back off the document; the entry stays owned by T012-R4 and due by ' +
      'M2, and the figure here is the runner figure rather than a workstation one. ' +
      'RE-MEASURED AT TX-ADOPT, 2026-08-14, on the workstation, whose three byte columns this ' +
      'record has twice proven identical to the runner: 217,312 before the adoption and ' +
      '204,818 after it, 37,894 document, 59,582 CSS, 107,342 JS, over by 6,162. THE ADOPTION ' +
      'PAID 12,494 BYTES, two and a half times the 4,998 this entry recorded, and the record ' +
      'was stale: the TX-GUTTER through TX-SHAPES chain shipped after the last runner study, ' +
      'which is the exact failure the baseline note already names about T026 through T033. ' +
      'Against the runner record the document fell 26,847, the compact response index and the ' +
      'state block redaction; the JS is net up 3,682, the TX capability minus the adoption; ' +
      'and the CSS is up 24,329, the class families the two way sweep must style, sanctioned ' +
      'at each arrival under theme-css-raw and untouchable by adoption by construction. WHAT ' +
      'REMAINS IS THE STYLESHEET PRICE OF SHIPPED CAPABILITY, and how it clears is the ' +
      "maintainer's decision rather than this entry's: the six mark rules stay per the " +
      "entry's own terms, the cap stays 194 KB, and the close requires a study taken on the " +
      'runner over the committed work.',
    closedAt: '2026-08-14',
    closedBecause:
      'PAID BY ITS PAYER FOR EVERYTHING ADOPTION CAN REACH, AND CLOSED BY THE RE-DERIVATION ' +
      'THE MAINTAINER ORDERED FOR WHAT IT CANNOT. TX-ADOPT took the page from 217,312 bytes ' +
      'to 204,818, 12,494 paid, two and a half times the 4,998 recorded here. The remainder ' +
      'was not this entry to cut: against the T033 runner record the document fell 26,847, ' +
      'the JS is net up 3,682, and the CSS is up 24,329, the class families the two way sweep ' +
      'must style, each arrival sanctioned under theme-css-raw, so what stayed over the old ' +
      'cap was stylesheet bytes already governed and grown by rule under their own budget, ' +
      'counted a second time by the page cap. The maintainer took the first of the three ' +
      'moves the entry offered: the cap was re-derived for the sanctioned stylesheet ' +
      'arrivals the way theme-css-raw was re-derived five times, 194 to 203 KB, by the same ' +
      'property with the same two named regressions, with SPEC 20 moved first and the ' +
      'movement itemised there. The close is on a study taken on the runner over the ' +
      'committed work, per the entry first term: commit 74510c5, three studies of one ' +
      'dispatch and the workstation identical to the byte, 204,818 = 37,894 document + ' +
      '59,582 CSS + 107,342 JS, inside the re-derived cap with 3,054 bytes to spare. All six ' +
      'mark rules are in the shipped stylesheet, each still setting an edge style, and the ' +
      'colour independence test is unchanged and green: the marks are not what paid, and ' +
      'this record is not an instruction to delete them. The untouched-cap term the entry ' +
      'carried bound the payment of the recorded 4,998, and the session 63 paragraph in the ' +
      'entry handed the remainder to the maintainer by name, which is the decision this ' +
      'closure records.',
  },
];

/**
 * Capabilities that are built and that no shipped path reaches, per the eighth class of SPEC 0.
 *
 * A FEATURE DEFERRED AND VISIBLE IS NOT ONE OF THESE. The Health panel spent M0 behind a dynamic
 * import and a reader who opened it got it; the schema tree still does. What belongs here is the
 * other thing: a capability a reader cannot obtain by any gesture, on any page this module
 * serves, because the code that would choose it was never written. The difference is not degree.
 * One is a decision about when bytes arrive, the other is a decision about whether a feature
 * exists, and SPEC 0 forbids a budget from being allowed to make the second one.
 *
 * AN ENTRY IS NOT PERMISSION AND IT IS NOT A PLAN. It is the record that the repository knows,
 * plus the two things that keep the knowledge from decaying: a task that owns the wiring and a
 * milestone that cannot close over it. Both are checked against BUILD.md, so an owner that stops
 * existing and a milestone that closes early are failures rather than notes.
 */
export const CAPABILITY_DEBTS: readonly CapabilityDebt[] = [
  {
    id: 'full-text-search',
    capability:
      'the full text search index of T007 is built, budgeted and served with an etag at ' +
      '<mount>/_search-index, and no file this module ships ever requests it; the palette ' +
      'matches navigation labels and hints only',
    owners: ['T042'],
    reachableBy: 'M3',
    recordedAt: '2026-08-13',
    roots: ['packages/nest/dist/browser'],
    marker: '_search-index',
    diagnosis:
      'T007 built the index in @openref/search and measured it honestly, 176,714 of 256,000 ' +
      'gzip bytes on the representative fixture SPEC 0 fourth instance exists to require. ' +
      'reference.service.ts serves it on every reference, cached behind the document etag. ' +
      'Nothing downstream asks for it: the index reaches a page through ISearchPort, which ' +
      '@openref/vue defines and whoever wires the application supplies, and the shipped browser ' +
      'entry supplies none, so useSearch answers available: false on every page this module ' +
      'serves. What the palette does instead is nav-search.ts, a match over the navigation rows ' +
      'the page already holds, which covers a path, a method or part of a summary and nothing ' +
      'of descriptions, parameters or schema text. T012 declined to ship the index into the ' +
      'page deliberately, 250 KB for a feature one keystroke deep, and the right shape was ' +
      'always the fetch the palette already performs for the navigation payload: the browser ' +
      'bundle carries _navigation today and not _search-index, which is what makes the segment ' +
      'usable as the marker. T039 wrote the index into the static output as one file, ' +
      '_search-index beside the navigation payload, and stopped at serving it: no page this ' +
      'module ships requests it, so the capability is unreachable exactly as recorded here. ' +
      'The wiring moved rather than being paid, which is what the T039 filing in ' +
      'ai-docs/BUILD-AMENDMENTS.md provides for when the task that first serves the index is ' +
      'not the one named, the paragraph moves with the work rather than being deleted. T042 ' +
      'owns it now because it is the gates task of the milestone this entry must be reachable ' +
      'by, so the debt is answered before M3 closes or it fails there. Whoever pays the ' +
      'wiring also derives a raw cap beside the gzip one for the search chunk, per the T039 ' +
      'amendment paragraph that moves with the work, the way theme-css-raw was derived from ' +
      'its own measurement.',
  },
];

/** The claim map, which answers every SPEC 19 and SPEC 20 claim with what would go red. */
export const CLAIM_MAP_FILE = 'ai-docs/CLAIM-MAP.md';

/** The specification the claims are read out of. */
export const SPEC_FILE = 'ai-docs/SPEC.md';

/**
 * Directories holding a shipped theme's stylesheets, relative to the repository root.
 *
 * Scanned by the theme-tokens gate for hardcoded colours, lengths and font stacks. One pair of
 * entries per theme package that ships CSS, which is two since T032.
 */
export const THEME_STYLE_ROOTS: readonly string[] = [
  'packages/theme/src',
  'packages/theme/fonts',
  'packages/theme-telltale/src',
  'packages/theme-telltale/fonts',
];

/**
 * The stylesheets allowed to hold literal values, because they declare the tokens.
 *
 * ONE PER SHIPPED THEME, AND IT BECAME A LIST AT T032. vernier's is generated from
 * `packages/theme/src/tokens/domain/tokens.ts` and pinned by a test; telltale's is written out from
 * its design handoff and held to the contract by `packages/theme-telltale/test/unit/tokens.spec.ts`.
 * Either way the file is the one place values are defined and everything else reads them, so
 * exempting these two creates no place a value can hide that a test is not already looking at.
 */
export const THEME_TOKEN_SOURCES: readonly string[] = [
  'packages/theme/src/styles/tokens.css',
  'packages/theme-telltale/src/styles/tokens.css',
];

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
    files: ['packages/theme/src/styles/tokens.css', 'packages/theme/src/styles/theme.css'],
  },
  {
    theme: 'telltale, as shipped',
    files: [
      'packages/theme-telltale/src/styles/tokens.css',
      'packages/theme-telltale/src/styles/theme.css',
    ],
  },
  { theme: 'vernier, as designed', files: ['ai-docs/design/vernier/tokens.css'] },
  { theme: 'telltale, as designed', files: ['ai-docs/design/telltale/tokens.css'] },
  { theme: 'forge', files: ['ai-docs/design/forge/tokens.css'] },
];

/**
 * Stylesheets declaring `@font-face`, checked against the bytes of the files they name.
 *
 * One entry per theme that ships fonts, which is two since T032. The font files are resolved
 * relative to the stylesheet, which is how the stylesheet itself addresses them.
 */
export const FONT_STYLESHEETS: readonly {
  readonly theme: string;
  readonly file: string;
}[] = [
  { theme: 'vernier, as shipped', file: 'packages/theme/fonts/fonts.css' },
  { theme: 'telltale, as shipped', file: 'packages/theme-telltale/fonts/fonts.css' },
];

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

/**
 * Extensions a browser loads as an ES module, scanned for specifiers it could not resolve.
 *
 * `.cjs` is not among them and its absence is the check: a browser cannot load CommonJS at all, so
 * one appearing under a browser root would be a different failure than an unresolvable specifier
 * and is not what this scan is about. The roots are derived by `browserScanRoots`, for the reason
 * given above the CSP extensions.
 */
export const BROWSER_MODULE_EXTENSIONS: readonly string[] = ['.js', '.mjs'];

/**
 * Where source lives, for the check that every file of it reads as text.
 *
 * `packages` and `tools` rather than the whole repository, because those are the trees a sweep
 * searches when it asks a question about this project's code. `ai-docs` is not among them: it is
 * not in a clone, so a gate over it could only skip, and the documents are read by people rather
 * than swept by tools.
 */
export const TEXT_SOURCE_ROOTS: readonly string[] = ['packages', 'tools'];

/**
 * Extensions expected to read as text.
 *
 * A LIST RATHER THAN AN EXCLUSION, for the same reason the format allowlist is one. The fonts in
 * `packages/theme/fonts` are binary and correct, and a scan built on "everything except what we
 * decided to ignore" would grow an entry for them and then for the next legitimate binary, until
 * the entry that hides a defect is indistinguishable from the ten that do not.
 */
export const TEXT_SOURCE_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.vue',
  '.css',
  '.html',
  '.json',
  '.md',
  '.yaml',
  '.yml',
];

/**
 * How few files scanned reads as a scan that never ran.
 *
 * The repository holds several hundred source files, so any figure in the low hundreds separates
 * a real walk from a mistyped root. It is a floor and not a count: a count would be a second thing
 * to maintain on every file added, which is how a check comes to be edited to keep it passing.
 */
export const TEXT_SOURCE_MIN_FILES = 200;

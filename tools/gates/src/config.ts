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
import type { BudgetJobExpectation, StaticCoverage } from './lib/static-suites.js';
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
  // THE EVENT CORPUS IS A THIRD ROOT FOR A THIRD REASON. Every file of the first root is read by
  // `normalizeOpenApiDocument` and every file of this one by `normalizeAsyncApiDocument`. One
  // directory would need a per file switch naming the reader, and a document filed under the wrong
  // reader would be refused rather than mis-read only by luck.
  {
    directory: 'packages/core/test/events-corpus',
    producedBy: 'T049',
    filesDirectory: 'documents',
    noticeFile: 'NOTICE',
    manifestKey: 'documents',
    allowedLicenses: FIXTURE_ALLOWED_LICENSES,
    extensions: ['.json', '.yaml', '.yml'],
    readsLicenseText: false,
    label: 'event document(s)',
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
 * The conventions document, whose section 9.1 is the prose half of the floors below.
 *
 * IT IS UNDER `ai-docs/` LIKE THE OTHER THREE, so the gate that reads it skips where the
 * directory is absent rather than reporting a missing private document as a defect.
 */
export const STANDARDS_FILE = 'ai-docs/00-overview/PROJECT-STANDARDS.md';

/**
 * Coverage floors from STANDARDS 9.1, keyed by package directory.
 *
 * A package with no entry has no floor yet; adding one is a task, not a judgement call.
 *
 * RECONCILED AGAINST THAT TABLE BY THE COVERAGE GATE, IN BOTH DIRECTIONS, SINCE THE POST-`T054`
 * REVIEW. Before it, this record and STANDARDS 9.1 were two copies of one five row table with no
 * runner over either, which is the shape the claims gate exists for on SPEC 20's numbers: a floor
 * lowered here and left standing there, or a row written there and never enforced here, would read
 * as agreement from whichever side a person opened. The `federation` row arriving at `T054` is the
 * exact move that would have gone wrong, and it went right by hand.
 */
export const COVERAGE_FLOORS: Readonly<Record<string, number>> = {
  core: 90,
  runner: 85,
  nest: 80,
  vue: 70,
  // ADDED AT `T054`, WHICH IS THE TASK THE DECISION WAS ADDRESSED TO. `packages/federation` was
  // built across the whole of M4 with no floor, and the carry that said so was a `PROJECT_STATE`
  // sentence until `T047` converted it into a boxed section here's own doctrine demands: a package
  // with no entry has no floor yet, and adding one is a task rather than a judgement call a gates
  // session makes in passing. 90 rather than the measurement, by the margin doctrine the four
  // floors above already follow: it holds the property with room for the ordinary work of a
  // milestone. Readings, each measured rather than carried: 97.36 lines / 94.98 statements at the
  // close of M4, 98.42 at `T053`, and the figure at the close of M5 is stated with its date in
  // `ai-docs/PROJECT_STATE.md` for that session.
  federation: 90,
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
  {
    // THE SEARCH FACTORY IS ON THIS SIDE FOR THE REASON `runner-factory` IS ON THE SEND SIDE:
    // one reader action downloads both chunks. Added at T042, paying the `full-text-search`
    // capability debt. Opening the palette now loads the index loader as well as the palette, and
    // nothing else in the page reaches either, so a reader who presses Ctrl-K downloads both and a
    // reader who never does downloads neither.
    //
    // IT IS NOT A GESTURE OF ITS OWN, AND THAT WAS THE ALTERNATIVE. A separate `search` entry
    // would have read better in the report, 5,773 of palette against 19,081 of index loader, and
    // it would have been a lie about the mechanism: this list divides the deferred half by the
    // gesture that pays for it, and there is no reader action that fetches the loader without
    // opening the palette. The itemisation lives in the budget comment instead, where it says the
    // same thing without inventing a gesture nobody makes.
    id: 'palette',
    roots: ['CommandPalette', 'search-factory'],
  },
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

/**
 * The SPEC 20 row each budget answers, by the label the table's first cell writes.
 *
 * WITHOUT IT THE COMPARISON WAS A MULTISET OF VALUES, WHICH THE PRE-M4 REVIEW MEASURED AS
 * AMBIGUOUS TWICE. `compareBudgetValues` matched every threshold the configuration enforces
 * against every threshold the table states, as bags of numbers with no tie between a row and the
 * budget it is about, on the stated argument that the table has no ids. Measured over the
 * thirty three budgets: thirty one distinct values and two collisions, `tti` with
 * `main-thread-work` on "no threshold" and `external-requests` with `csp-violations` on zero. In
 * a colliding pair the check cannot tell which row is about which budget, so the two rows can
 * swap subjects, or one can be relaxed while the other tightens by the same amount, and the bags
 * still match. That is SPEC 0's class of a check comparing an assertion's shape rather than its
 * value, on the two rows this project's security claims rest on.
 *
 * THE LABEL IS QUOTED IN THE TABLE'S OWN RUSSIAN, exactly as `STATIC_SUITE_COVERAGE` quotes SPEC
 * 21's cell, and for the same reason: a translation here would be a second thing to keep in step.
 * The list is hand written and it is reconciled in both directions, so a row the table states and
 * no budget claims, a budget naming a row the table does not have, and a budget whose row states
 * another number are three separate findings rather than one silent pass.
 */
export const BUDGET_SPEC_ROWS: Readonly<Record<string, string>> = {
  'client-js': 'Клиентский JS, который грузит первая отрисовка, gzip',
  'client-js-raw': 'Клиентский JS, который грузит первая отрисовка, сырые байты',
  'client-js-send': 'Клиентский JS, который скачивает нажатие Send, gzip',
  'client-js-send-raw': 'Клиентский JS, который скачивает нажатие Send, сырые байты',
  'client-js-palette': 'Клиентский JS, который скачивает открытие палитры команд, gzip',
  'client-js-palette-raw': 'Клиентский JS, который скачивает открытие палитры команд, сырые байты',
  'client-js-sign-in-return':
    'Клиентский JS, который скачивает возвращение от сервера авторизации, gzip',
  'client-js-sign-in-return-raw':
    'Клиентский JS, который скачивает возвращение от сервера авторизации, сырые байты',
  'client-js-schema': 'Клиентский JS, который скачивает разворачивание схемы, gzip',
  'client-js-schema-raw': 'Клиентский JS, который скачивает разворачивание схемы, сырые байты',
  'client-js-shapes': 'Клиентский JS, который скачивает обращение к форме страницы форм, gzip',
  'client-js-shapes-raw':
    'Клиентский JS, который скачивает обращение к форме страницы форм, сырые байты',
  'theme-css': 'CSS дефолтной темы, gzip',
  'theme-css-raw': 'CSS дефолтной темы, сырые байты',
  'client-wc': 'Выходы Web Component, оба формата, gzip',
  'client-wc-raw': 'Выходы Web Component, оба формата, сырые байты',
  'theme-entry': 'Вход темы telltale, каталог целиком, gzip',
  'theme-entry-raw': 'Вход темы telltale, каталог целиком, сырые байты',
  'fonts-first-paint': 'Шрифты первой отрисовки, на тему, gzip',
  'fonts-latin': 'Шрифты латиницы, на тему, gzip',
  'fonts-total': 'Шрифты всего, на тему, gzip',
  'search-index': 'Поисковый индекс на 1000 узлов, gzip',
  'search-index-raw': 'Поисковый индекс на 1000 узлов, сырые байты',
  prerender: 'Пререндер, 1000 узлов',
  tti: 'TTI, 1000 узлов, throttling 4× CPU',
  'main-thread-work': 'Работа главного потока, 1000 узлов, throttling 4× CPU',
  'long-tasks': 'Длинные задачи дольше 50 мс, 1000 узлов, throttling 4× CPU',
  'page-bytes': 'Документ, CSS и JS, отданные главному потоку, 1000 узлов, сырые байты',
  'client-memory': 'Пиковая память клиента, документ 7 МБ',
  'external-requests': 'Внешние сетевые запросы',
  'csp-violations': 'Нарушения строгой CSP',
  'served-document': 'Отданный документ браузеру, как его собирает хост, 1000 узлов, сырые байты',
  'overview-document': 'Обзорная страница, федерация всего корпуса, сырые байты',
  'static-build': 'Статическая сборка, 1000 узлов, 4 ядра',
};

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
    // 106 KB SINCE T042, AND THE PROPERTY IS RE-CHECKED RATHER THAN THE MARGIN RESTORED. Measured
    // 108,139 raw across the same six files against 107,450 at the head of this task: 689 bytes,
    // and they are the seam of the two capability debts this task paid rather than the features
    // behind them. The search seam is `loadSearch` on `HydrateOptions`, the closure that binds the
    // page's hash and mount point to it, the fetch of `<mount>/_search-index`, and the prop
    // `ReferenceApp` forwards; the index loader and `minisearch` are 19,081 bytes and are behind
    // the palette gesture, where they belong. The static proxy seam is the `staticProxy` field the
    // factory reads, and the transport itself is 1,748 bytes behind the Send gesture.
    //
    // AND THE HEADROOM THIS COMMENT CLAIMED HAD ALREADY GONE. The paragraph above says 410 bytes
    // remain for ordinary work, measured at TX-ADOPT against 107,110. The head of T042 measured
    // 107,450, so 70 bytes remained: T036 through T041 grew the first paint by 340 bytes without
    // anyone re-deriving, which is the budget absorbing ordinary work exactly as intended and is
    // also why the next arrival had nowhere to go.
    //
    // THE FIGURE IS THE SHIPPED ARTEFACT'S AND IT WAS RE-TAKEN AT THE CLOSE OF T042, for the reason
    // `TEXT_SOURCE_MIN_FILES` was re-taken in the same task: the first reading this comment carried
    // said 108,085, and the work that landed after it left the tree 54 bytes heavier, so the
    // arithmetic beside the cap described a bundle that no longer existed. The cap did not move and
    // does not need to. 108,544 leaves 405 bytes, and the property still holds: `sign-in-return` is
    // 1,451 raw, so it returning to the first load reads 109,590 and fails this budget.
    //
    // 107 KB SINCE THE PRE-M4 REVIEW, AND THE ARRIVAL IS NAMED BECAUSE IT IS NOT A FEATURE A READER
    // OF THE FIRST PAINT USES. The path suffix guard and the address policy stopped being three
    // hand written copies and became one implementation in `@openref/core/security`, called by the
    // same origin proxy, the static generator, the OAuth flows and the rewriting transport. The
    // first paint runs none of it. What it pays is the bundler's: the guard is reached by several
    // deferred chunks, so esbuild places it in the chunk they share, and the entry already loads
    // that chunk for the error classes. Measured 108,870 raw across the same six files against
    // 108,544, so 326 over; measured again with the transport's import taken out, 108,643, which
    // is how the route was identified rather than guessed. A second entry point was built first,
    // on the `@openref/vue/runner` precedent, and it does not move the grouping, so the cost is
    // real rather than avoidable from here.
    //
    // THE PROPERTY IS RE-CHECKED AND STILL HOLDS, which is what allows the step at all. 107 KB is
    // 109,568: the artefact fits with 698 bytes, and `sign-in-return` at 1,451 raw returning to the
    // first load reads 110,321 and fails it. 106 KB does not fit, so 107 is the one whole KB step
    // available. WHAT WOULD REVERSE THIS rather than the cap: the runner keeping its own copy of
    // the two predicates with a case holding it byte equal to this one, which is what the three
    // generated artefacts already do and which would take the 326 bytes back out of the first
    // paint at the price of a copy.
    //
    // 108 KB SINCE T046, AND THE ARRIVAL IS A FEATURE THE FIRST PAINT USES BY CONSTRUCTION: the
    // federated page of SPEC 15.3. Measured 109,778 raw across the same six files against 108,850
    // at the head of this task: 928 bytes, itemised as 743 in the entry, which is the rail's
    // service card links and status marks, the card's adoption stub, the `service` page branch
    // and the `_federation` snapshot fetch that marks a degraded remote from anywhere on a page
    // whose bytes are cached by document hash and therefore cannot carry the mark themselves, and
    // the rest in the shared chunks for the two addresses and the navigation's `serviceId`. WHAT
    // WAS TRIED BEFORE MOVING THE NUMBER: the fetch lost its header and 503 branches and the
    // selector its escaping, needless over the service id alphabet, worth 116 raw; what is left
    // is the feature, and a deferred chunk was refused because the fetch runs on load, so its
    // bytes are this budget's material whichever file carries them.
    //
    // THE PROPERTY IS RE-CHECKED AND STILL HOLDS. 108 KB is 110,592: the artefact fits with 814
    // bytes, and `sign-in-return` at 1,451 raw returning to the first load reads 111,229 and
    // fails it. 107 KB does not fit, so 108 is the one whole KB step available.
    limitBytes: 108 * 1024,
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
    //
    // RE-DERIVED AGAIN AT T042, 22,300 to 24,900, BY THE SAME RULE ON A NEW ARRIVAL. The comment
    // above scoped the moves to M2 because SPEC 14.1 put the runner's features there. SPEC 16.2
    // puts one more in M3: a static build's console had no transport that a platform rewrite rule
    // can read, which is the `static-proxy-transport` capability debt, and paying it is runner
    // code that arrives when a reader presses Send. Measured 22,654 gzip after the arrival against
    // 22,052 before it, so the console downloads 602 bytes more, and the pair moves by the rule
    // this budget has always been derived by rather than to the figure that would just fit. The
    // figure is the shipped artefact's, re-taken at the close of T042 against the 22,657 first
    // written here, three bytes of work that landed after the first reading.
    limitBytes: 24_900,
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
    //
    // RE-DERIVED AT T042, 65,900 to 73,200, AND THE ITEMISATION IS AGAIN THE POINT. Measured 66,595
    // raw after the arrival against 64,847 before it: 1,748 bytes, all of them one file,
    // `path-rewrite-transport.adapter.ts`. The figure is the shipped artefact's, re-taken at the
    // close of T042 against the 66,604 first written here, nine bytes of work that landed after the
    // first reading. It resolves the target url against the pinned upstream
    // list the static build wrote into the page, rewrites it onto that upstream's own `u<N>` path
    // under the reader's origin, and refuses anything the list does not pin, which is what makes a
    // static console unable to address an arbitrary host at all. About 483 characters of it are
    // the refusal sentences, which do not minify and are the price of a refused Send being
    // diagnosable, and about 110 are the two suffix guard expressions copied from the generated
    // artefacts so the client half cannot form a request the server half would 403.
    //
    // WHAT WAS TRIED BEFORE MOVING THE NUMBER, because the headroom was 1,053 raw and the arrival
    // was 1,748: the surplus `timeoutMs` and `maxResponseBytes` options came off the adapter and
    // two refusals were folded into one, worth 234 raw and 67 gzip. What is left is the feature.
    limitBytes: 73_200,
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
    //
    // RE-DERIVED AT T042, 2,200 to 9,800, AND THE ITEMISATION IS WHY THE NUMBER IS THAT BIG. This
    // pays the `full-text-search` capability debt: the index has been built, budgeted and served
    // at `<mount>/_search-index` since T007 and no file this module shipped had ever asked for
    // it, so the palette matched navigation labels and hints and nothing of descriptions,
    // parameters or schema text. Measured 9,069 gzip after against 2,129 before, and the whole of
    // the 6,940 is two things: 495 is the palette itself learning to prefer index hits and to say
    // which state it is in, and 6,445 is the new `search-factory` chunk, which is the index loader
    // and the `minisearch` it stands on. It arrives on Ctrl-K and on no other gesture.
    //
    // THE FIGURE IS THE SHIPPED ARTEFACT'S AND IT WAS RE-TAKEN AT THE CLOSE OF T042. The first
    // reading here said 8,992, of which 418 was the palette's own share, and the work that landed
    // after it left this gesture 77 bytes heavier: the chunk the index loader is in did not move at
    // all, still 6,445, so the whole of the drift is the palette component. The cap did not move
    // and does not need to, and it is tighter than the rule would give: ten percent over 9,069
    // rounded down to a hundred bytes is 9,900.
    limitBytes: 9_800,
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
    //
    // RE-DERIVED AT T042, 4,900 to 27,300. Measured 25,152 raw after the search wiring against
    // 4,711 before it: 1,360 is the palette component and 19,081 is the `search-factory` chunk,
    // which is where `minisearch` now lives. The figure is the shipped artefact's, re-taken at the
    // close of T042 against the 24,854 first written here, and as in the gzip cap above the loader
    // chunk did not move, so all 298 bytes of the drift are the palette component. Ten percent over
    // 25,152 rounded down to a hundred bytes is 27,600, so the cap stands where it is and is
    // tighter than the rule would give. IT LIVES THERE BY A CORRECTION RATHER THAN BY
    // DEFAULT: the first build of this left `import"minisearch"` as a bare specifier in that
    // chunk, so a browser would never have evaluated it and the palette would have gone on
    // matching navigation rows with nothing anywhere reporting the loss. `browser-resolution`
    // failed on it, `packages/nest/tsup.config.ts` now inlines the package, and this figure is
    // the artefact that ships rather than the one that was measured first.
    limitBytes: 27_300,
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
    //
    // RE-READ AT `T054`, AND THE DERIVED PROPERTY THE FIVE PARAGRAPHS ABOVE RESTATE IS RETIRED
    // RATHER THAN RESTORED. They are kept exactly as they were written, because what a later
    // reader needs is when the property stopped holding rather than when somebody noticed.
    //
    // WHAT WAS FOUND, MEASURED AND DATED. The clause every recompute closes with is that the cap
    // is the one whole KB step keeping the headroom exactly one small capability wide: a
    // navigation sized region of 2,520 bytes fits under it, a page frame sized one of 3,287 and a
    // console sized one of 3,669 do not. Measured before `T050`: 61,157 bytes built, headroom
    // 1,307, so the clause was already false and 2,520 had not fitted since some point before
    // that slice. Measured after `T050`: 62,018, headroom 446. Measured 2026-08-29 at `T054`, on
    // this tree: 62,298 bytes, split 48,380 theme.css, 9,707 tokens.css, 4,211 fonts.css, headroom
    // 166. The cap binds, every slice since is inside it, and the sentence under it describes a
    // stylesheet that stopped existing three slices ago.
    //
    // WHY RETIRED AND NOT RESTORED, WHICH WAS THE OTHER BRANCH THE SECTION ADDRESSED TO `T054`
    // OFFERS. Restoring it means the whole KB step that puts the headroom back between 2,520 and
    // 3,287, and on 62,298 that is exactly one step, 64 KB, which is 65,536 and hands the
    // stylesheet 3,072 bytes of new room. No capability is waiting for that room. The section
    // itself opens by saying the cap is correct as committed and must not move, and a cap raised
    // to make a sentence true again is `ABSOLUTE RULES 3` with its own argument turned around: the
    // five recomputes each moved this number because a named capability landed with its bytes
    // measured at the landing, and nothing landed here.
    //
    // WHAT REPLACES IT, AND IT IS A DERIVATION RATHER THAN A ROUND NUMBER. The cap is the smallest
    // whole KB step the built stylesheet fits under. Measured 2026-08-29: 62,298 fits under 61 KB,
    // which is 62,464, and does not fit under 60 KB, which is 61,440. So 61 is not a number with
    // room deliberately left in it; it is the tightest step available, which is what this project
    // wants from a ceiling and what the old clause was a proxy for. It forbids slack instead of
    // allowing one capability's worth, and it says plainly what a future arrival owes: measure
    // what it costs, and bring that number and this cap to the maintainer as two choices, rather
    // than presenting the raise as a consequence of the arrival.
    //
    // WHAT KEEPS IT FROM DECAYING THE WAY THE OLD CLAUSE DID. That one had no runner and no
    // cadence, so it went false and stayed false across five slices. The figure above is dated,
    // and re-reading it is a section of `ai-docs/BUILD-AMENDMENTS.md` addressed to `T059`, the M6
    // closing gates task, which is the mechanism this repository uses for an obligation that has
    // to survive the session that wrote it.
    id: 'theme-css-raw',
    label: 'Default theme CSS, raw bytes',
    limitBytes: 61 * 1024,
    quantity: 'parse',
    roots: THEME_CSS_ROOTS,
    extensions: ['.css'],
    producedBy:
      'T009, recomputed at TX-GUTTER, TX-FRAME, TX-MARKUP, TX-PARITY-UI and TX-SHAPES, ' +
      're-derived at T054 without moving',
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
  // THE SECOND CAP OVER THE SAME ARTEFACT, AND IT IS THE ONE THAT BINDS. Filed by the T039
  // amendment against whoever first serves the index into a page, which is T042: the gzip row is
  // honest about transfer and says nothing about the parse, the defect `theme-css` had and fixed.
  // Measured 946,269 raw against 177,080 gzip on the same fixture, a ratio of 5.34, so an index at
  // the 250 KB transfer cap would be about 1.37 MB of JSON for a client to parse. Derived from the
  // measurement plus ten percent, rounded up to the megabyte.
  {
    id: 'search-index-raw',
    label: 'Search index, 1000 nodes, the bytes a client parses, raw',
    limit: '1 MB',
    enforcedBy: 'T042',
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
  // WHOSE QUANTITY THIS IS, NAMED IN THE LINE ITSELF, per TX-SERVED and the SPEC 0 rule that the
  // quantity a budget names is part of its assertion. There are two served document figures and
  // they measure two things: this one is the document as a host assembles it, with a base path in
  // every link, the real asset catalogue in the head and a nonce on every script element, and it
  // is checked in the browser because that is where a reader pays. The jsdom ceiling in
  // `client-cost.spec.ts` measures the shell without any of the three and is 41 KB of its own.
  {
    id: 'served-document',
    label: 'Served document as a host assembles it, 1000 nodes, raw bytes, in the browser',
    limit: '72 KB',
    enforcedBy: 'T015',
  },
  // THE OVERVIEW PAGE HAD NO BUDGET AT ALL UNTIL 2026-08-29, WHICH IS WHY THIS ROW EXISTS. SPEC
  // 9.5.1 measured the topology section at 346.1 bytes per edge and said in the same paragraph that
  // no recorded threshold has that page as its subject: the browser study loads an operation page,
  // and the `served-document` pair is stated for the 1000 node fixture and promises nothing about
  // any other document. A page nothing measures grows until somebody notices.
  //
  // THE INPUT IS THE WHOLE CORPUS RATHER THAN A NUMBER SOMEBODY PICKED. One document cannot be the
  // input, because the section exists for a composition of services: the largest event document in
  // the corpus, `everest-system-api.yaml`, carries 25 edges and its overview page is 14,556 bytes.
  // The upper shape the corpus gives is every one of its forty documents, both families, federated
  // into one estate: 40 services, 1,310 nodes, 2,582 schemas, 95 edges over 68 groups.
  //
  // THE FIRST EDITION TOOK THE EVENT HALF ALONE, and the re-derivation is recorded rather than
  // silently applied. On 2026-08-29 the input was the 23 event documents, 91 edges over 64 groups,
  // 80 nodes, 221 schemas, measured 63,951 bytes for a cap of 69 KB. The forty document estate read
  // 77,328, over that cap by 6,672, and almost none of the overrun was the graph: four more edges
  // took the section from 45,792 to 48,046 while the page with no edges at all went from 18,159 to
  // 29,282. A cap derived on a document an order smaller is measuring something other than what it
  // was set for, so the maintainer re-derived it on 2026-08-30 by the standing rule. A BOUNDED VIEW
  // OF THE OVERVIEW PAGE WAS REFUSED IN THE SAME RULING, and the reason is the rule itself:
  // choosing a product shape under budget pressure is the move this project forbids, and if the
  // page needs a bounded view later that is a design decision taken on its own merits.
  //
  // MEASURED 77,328 BYTES on the same serving path SPEC 9.5.1 measured the section on, which is the
  // shell the renderer produces with one stylesheet and one module and a markdown renderer built
  // with the highlighter. Plus ten percent is 85,060.8, so up to the whole KB is 84 KB, which is
  // 86,016, and the headroom is 8,688. THE PROPERTY, checked rather than the ten percent taken on
  // trust: this page costs 505.7 bytes an edge, so seventeen more rows read 85,926 and fit while
  // eighteen read 86,431 and do not, and a second service the size of the corpus's largest event
  // document is not extrapolated at all but measured, at 41 services, 120 edges and 89,647 bytes,
  // which fails. THAT FIGURE WAS TAKEN AT THE COPY ID `everest-system-api-two` AND THE ID IS NAMED
  // BECAUSE THE FIGURE DEPENDS ON ITS LENGTH: the same copy under an id of length `len` reads
  // 88,239 + 64 x len, which is 89,647 at twenty two characters, 88,559 at five and 89,775 at
  // twenty four. The 64 is both ends of twenty five section rows plus a rail row and a state
  // record. The conclusion holds at every length, since even an empty id would read 88,239 and
  // fail: an estate that grew by a whole event service is re-derived with a figure attached rather
  // than passing in silence.
  //
  // WHAT MOVED THE CAP IS DOCUMENT SCALE AND NOT SECTION GROWTH, itemised because "scale" on its
  // own is a word rather than a reading. Of the 13,377 bytes between the two derivations, 2,254 is
  // the section and 11,123 is the base page; inside the base page, 7,051 is the markup, all of it
  // navigation rail rows since nothing else in the markup changed, 4,069 is the `navigation` array
  // of the embedded state, and the remaining 3 bytes are two counters gaining a digit. Both halves
  // of the navigation carry one entry per service rather than one per node, and
  // the nodes are nearly free: a forty first service bringing 589 nodes and no edges measures 256
  // bytes, its own rail row included. THAT ONE WAS TAKEN AT THE COPY ID `stripe-two`, named for the
  // same reason: the same copy under an id of length `len` reads 77,544 + 4 x len, which is 77,584
  // at ten characters, 77,564 at five and 77,592 at twelve. A service id is prefixed onto every
  // node id per SPEC 15.1, so it lands in both ends of every section row and in both halves of the
  // navigation; neither conclusion here depends on the length, but neither figure reproduces
  // without it.
  //
  // IT MEASURES THE RENDERER'S SHELL AND NOT THE DOCUMENT A HOST ASSEMBLES, the same quantity as
  // the 41 KB jsdom half of `served-document` and with the same known direction of error: it always
  // understates, because every term of the difference is something a host adds and the harness does
  // not. The browser study was deliberately not extended to this page, since that is a fixture, an
  // app and a Chrome navigation, none of which the threshold needs.
  {
    id: 'overview-document',
    label: 'Overview page of the federated corpus, raw bytes, as the renderer produces it',
    limit: '84 KB',
    enforcedBy: 'packages/nest/test/integration/overview-budget.spec.ts',
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
export const CAPABILITY_DEBTS: readonly CapabilityDebt[] = [];

/**
 * The Static row of SPEC 21, wired coverage by coverage to the suites that answer it.
 *
 * ONE ENTRY PER NAME THE ROW STATES, and the names are the specification's own words rather than a
 * translation, because the gate compares this list with that row in both directions. A coverage
 * added to SPEC 21 and not wired here fails; a coverage wired here that the row does not state
 * fails as well, since it would be a check nobody asked for wearing the authority of the table.
 *
 * THE CASE TITLES ARE THE PART THAT SURVIVES A SUITE BEING EMPTIED. A file path proves the file is
 * there, which is the same limit `ai-docs/CLAIM-MAP.md` states about itself; a title proves the
 * property still has a case with its name on it. Neither proves the case asserts anything, and the
 * defence against that is the one used everywhere here, which is that a check is planted and
 * watched to fail before it is trusted.
 */
export const STATIC_SUITE_COVERAGE: readonly StaticCoverage[] = [
  {
    id: 'determinism',
    spec: 'детерминированность',
    files: [
      'packages/static/test/unit/build-site.spec.ts',
      'packages/static/test/unit/proxy-files.spec.ts',
      'packages/static/test/unit/site-base.spec.ts',
    ],
    cases: [
      'should write byte identical output for two builds of one document, generated files included',
      'should name every asset by the digest of its bytes',
      'should be deterministic: two generations produce identical bytes',
      'should carry no timestamp, so two builds of one document agree',
    ],
  },
  {
    id: 'incrementality',
    spec: 'инкрементальность',
    files: [
      'packages/static/test/unit/build-site.spec.ts',
      'packages/static/test/unit/page-key.spec.ts',
      'packages/static/test/integration/build-output.spec.ts',
    ],
    cases: [
      'should re-render only the pages a changed operation affects',
      'should produce a carried page byte identical to a rendered one',
      'should re-render everything when a change reaches the navigation every page draws',
      'should render everything when the manifest cannot be read',
      'should write the same bytes for a carried file when one node changes',
      'should move for the changed node and stand still for its sibling',
    ],
  },
  {
    id: 'seo-markup',
    spec: 'SEO-разметка',
    files: [
      'packages/static/test/unit/build-site.spec.ts',
      'packages/static/test/unit/site-base.spec.ts',
    ],
    cases: [
      'should carry a canonical link, og tags and json-ld when the base has an origin',
      'should omit the two that need an origin, and say so, when the base is a path',
      'should write one absolute loc per page',
      'should write nothing at all without an origin, rather than a sitemap of paths',
      'should name the document and link every operation and schema',
    ],
  },
  {
    id: 'proxy-configs',
    spec: 'конфиги прокси',
    files: [
      'packages/static/test/unit/build-proxy.spec.ts',
      'packages/static/test/unit/proxy-files.spec.ts',
      'packages/static/test/unit/proxy-runners.spec.ts',
      'packages/static/test/unit/proxy-upstreams.spec.ts',
      'packages/static/test/unit/proxy-target.spec.ts',
      'packages/static/test/integration/proxy-config-tools.spec.ts',
    ],
    cases: [
      'should write the netlify rules into the output, tracked as build files',
      'should write one rule per unique upstream, per SPEC 16.2',
      'should weave the base path into every rule, and none when the base is the root',
      'should pin an absolute http(s) server as one upstream, trailing slash normalized',
      'should refuse every request that tries to name a target, without sending anything',
      'should parse with no errors, every rule a proxy to a pinned host',
      'should transform with no error, every destination host pinned',
    ],
  },
];

/** The first cell of the SPEC 21 row the wiring above answers. */
export const STATIC_SUITE_ROW = 'Static';

/** The first cell of the SPEC 21 row the federation wiring answers. */
export const FEDERATION_SUITE_ROW = 'Federation';

/**
 * The Federation row of SPEC 21, wired coverage by coverage, by the mechanism above.
 *
 * THE ROW IS RUN RATHER THAN READ, FOR THE REASON THE `Static` ROW IS, and this is the second row
 * to get a runner because M4 is the milestone that closes it. `T047` asks for the federation
 * suites to be wired into `pnpm gates`, and wiring them by file path alone would prove the files
 * are there; what the row states is three coverages, so what has to be checked is that each of
 * those three has a case with its name on it and that the three are the three the table states.
 *
 * ALL THREE ARE ANSWERABLE AT M4 AND NONE OF THEM IS OWED FORWARD, which was worth checking before
 * this list was written. `смешанный HTTP+events` reads as M5 work, since the AsyncAPI normalizer is
 * `T048`; the merge takes normalized IR rather than a specification, and an event document is IR
 * the fixtures build today, so the mixed case is a merge case and it exists. What M5 adds is a
 * normalizer that produces such a document from a file, and `T053` merges mixed documents from
 * real sources, at which point this list gains files rather than its first ones.
 */
export const FEDERATION_SUITE_COVERAGE: readonly StaticCoverage[] = [
  {
    id: 'conflicts',
    spec: 'конфликты',
    files: [
      'packages/federation/test/unit/merge-documents.spec.ts',
      'packages/federation/test/unit/name-allocation.spec.ts',
      'packages/federation/test/unit/adversarial-m4.spec.ts',
    ],
    cases: [
      // The three modes of SPEC 15 on one contested address, which is the conflict the section is
      // written about, plus the losslessness that makes two of them differ from dropping a service.
      'should keep both operations and move both addresses under namespace',
      'should let the first service keep the address and move the rest under first-wins',
      'should refuse the merge under fail, naming the address and both services',
      'should lose nothing but the address and the id, under every mode',
      // And the conflict that is arithmetic rather than policy: two names that meet after the
      // policy has run, which is the space where an escape is reachable.
      'should move the second claimant of a navigation id and report the move',
      'should carry the merge conflict code and not only the sentence',
    ],
  },
  {
    id: 'unavailable-remote',
    spec: 'недоступный remote',
    files: [
      'packages/federation/test/unit/remote-lifecycle.spec.ts',
      'packages/federation/test/integration/remote-lifecycle.spec.ts',
      'packages/federation/test/unit/adversarial-m4.spec.ts',
      // ADDED BY `T053`. A remote with no version is absent from the composition, and the half
      // nothing held until now is what that absence does to a page: an edge naming something that
      // remote documents has to be drawn as leading outside the known set rather than dropped, and
      // it has to resolve again when the remote comes back.
      'packages/nest/test/integration/mixed-federation.spec.ts',
    ],
    cases: [
      // The done-when sentence of the lifecycle: one bad service does not take the others down.
      'should not let a remote that never answered take down the documentation of the others',
      'should degrade a remote that dies mid session, visibly, without breaking the page',
      'should serve the fast remotes without waiting for a hung one',
      // Over a real socket, with a process that is really killed and really comes back.
      'should degrade a killed remote, keep its page content, and recover when it returns',
      // And the two ways a remote is unavailable while answering, which `T047` attacked.
      'should hold a bounded amount of a 400 MB answer and degrade like a remote that is down',
      'should stop reading a trickling body when the lifecycle gives up on it',
      // And what an unavailable remote does to the graph, which is `T053`'s clause.
      'should draw an edge into an unavailable remote as unknown rather than dropping it',
      'should resolve that same edge once the remote comes back, which is the control',
    ],
  },
  {
    id: 'mixed-http-events',
    spec: 'смешанный HTTP+events',
    files: [
      'packages/federation/test/unit/merged-document.spec.ts',
      // ADDED BY `T049`, AND IT IS THE HALF THE FIRST FILE CANNOT PROVE. That one hands the merge
      // two fixtures whose `kind` the fixture builder wrote, which proves `mergeKind` and not the
      // chain. This one starts from a real HTTP corpus document and a real event corpus document
      // and normalizes both, which is the only way `kind: 'mixed'` is reached from bytes on disk:
      // no specification format writes HTTP operations and channels together, so both normalizers
      // answer with one kind each by construction and this merge is the sole producer of the third.
      'packages/federation/test/integration/mixed-corpus.spec.ts',
      // ADDED BY `T053`, WHICH IS THE TASK THIS ROW WAS WAITING FOR. The two files above merge two
      // services of two kinds; this one merges three of three, a mixed service among them, and it
      // holds the half that no fixture pair can reach: a relationship whose two ends live in two
      // services, which is the cross service resolution SPEC 15.1 records.
      'packages/federation/test/unit/cross-service-edges.spec.ts',
      // AND THE SAME THING AT THE LIFECYCLE, which is where `mixed` stops being a merge property
      // and becomes a page. It is a `packages/nest` suite because the renderer may not see the
      // merge and the merge may not see the renderer; it boots no process, so running it here
      // costs a second rather than a demo.
      'packages/nest/test/integration/mixed-federation.spec.ts',
      // AND THE WIRE. Every file above reaches `mixed` through a fetcher this repository wrote,
      // so none of them proves an AsyncAPI body survives a real socket, a real `fetch` adapter and
      // a real cache file. This one does, and the file is listed here as well as under
      // `unavailable-remote` because the two rows want two different cases out of it.
      'packages/federation/test/integration/remote-lifecycle.spec.ts',
    ],
    cases: [
      // An HTTP service and an event service in one merge: ids, kind, and the address rule that
      // makes a topic stay a topic rather than become a path no broker has.
      'should prefix every node id with the id of its service',
      'should report the kind as mixed when the services do not agree',
      'should join a channel address that is not a path with a separator',
      // And the same three questions asked of two documents this repository did not write.
      'should report the merged kind as mixed, with both node kinds in one map',
      'should keep the channel a channel, address, parameters, servers and all',
      'should give one hash whichever order the two services are configured in',
      // `T053`: three kinds at once, and the edge that spans two of them. The determinism case is
      // named here too, because a merge of mixed kinds that reads the configured order is the one
      // failure this row's own sentence cannot survive.
      'should merge one of each kind into one document that holds every node',
      'should give one hash and one report whichever order the three are configured in',
      // THE FIRST TITLE MOVED AT `T053-R1` BECAUSE THE PROPERTY DID, and the case is the same
      // case: an event end used to be moved onto the merged address of the target channel, and it
      // is now resolved onto that channel's node, because a merged address is a value the merge
      // invented while a node id names the channel itself. Nothing is dropped from this row.
      'should resolve the event end onto the channel node the federation answers with',
      'should leave an event name alone when two services answer the same address',
      'should record the move so the report still inverts the merge',
      // ADDED BY `T053-R1`: the merged address that read exactly like a name no source document
      // declared, which resolved into another service's channel and drew a link nobody authored.
      'should refuse to resolve a name no source document declares, however the merge spells it',
      'should span services in the topology, which is the reason the feature exists',
      // And at the lifecycle, where an events remote is fetched at all and the page is one page.
      'should fetch an events remote at all, which the OpenAPI only reader refused',
      'should merge the four into one document of every kind, and render it as one page',
      // ADDED BY THE BLIND REVIEW OF `T053-R1`. SPEC 15.1 records a measurement whose runner is
      // this case, and it was the one case in its file no row named, so deleting the ratio was
      // silent to every gate. A figure with no runner is what this row exists to prevent.
      'should carry exactly two of the class of edge no corpus document can produce',
      // And over a real socket, which is the only place the fetch, the parse, the reader dispatch
      // and the cache file are all the real ones. Named here because listing the file alone left
      // this case deletable with the gate still green.
      'should read an AsyncAPI remote off the wire, merge it as mixed, and revive it from disk',
    ],
  },
];

/** Where `PageKind` is declared, which is the union SPEC 13.3's reader page list has to agree with. */
export const PAGE_KIND_SOURCE = 'packages/vue/src/page/domain/page-model.types.ts';

/** The line SPEC 13.3 writes its reader page list behind, in the specification's own words. */
export const READER_PAGES_PREFIX = 'Страницы читателя:';

/**
 * Every route SPEC 13.3 lists as a reader page, and the `PageKind` member that serves it.
 *
 * WHAT THIS TABLE IS FOR, AND WHICH DIRECTION IS THE ONE THAT FAILED. `sweptPages()` in
 * `packages/theme-telltale` is a total `Readonly<Record<PageKind, ...>>`, so a kind added to the
 * union does not compile until somebody places it, and `PAGE_KIND_CARDINALITY` in
 * `packages/static` is a second total record over the same union. Both tie the sweep and the build
 * plan to `PageKind`. Neither ties `PageKind` to SPEC 13.3, which is where the reader page family
 * is actually declared and which is a prose list no runner read: a page added to the
 * specification and never given a member was invisible to every check in the tree, and the first
 * symptom was a theme serving a page it never styled. That happened twice, with `shapes` and
 * `states`, and once more with `service`.
 *
 * THE TABLE IS RECONCILED IN BOTH DIRECTIONS AND IT IS NOT THE SUBJECT OF EITHER. A route SPEC
 * 13.3 lists that this table does not map fails, a kind `PageKind` declares that no route here
 * names fails, and a mapping naming a kind the union does not declare fails as well. The subject
 * of the comparison is always the specification's own line and the union's own declaration, so
 * this table is the join between them rather than a third copy of either.
 *
 * A KIND MAY BE DELIBERATELY ABSENT FROM SPEC 13.3, and then it carries its reason here rather
 * than being missing. Nothing is in that state today, which is measured rather than assumed: the
 * eight routes and the eight members correspond one to one.
 */
export const READER_PAGE_KINDS: readonly { readonly route: string; readonly kind: string }[] = [
  { route: '<route>', kind: 'overview' },
  { route: '<route>/{nodeId}', kind: 'node' },
  { route: '<route>/schema/{schemaId}', kind: 'schema' },
  { route: '<route>/bench/{nodeId}', kind: 'bench' },
  { route: '<route>/health', kind: 'health' },
  { route: '<route>/shapes/{schemaId}', kind: 'shapes' },
  { route: '<route>/states', kind: 'states' },
  { route: '<route>/service/{serviceId}', kind: 'service' },
];

/** The first cell of the SPEC 21 row the M5 wiring answers. */
export const EVENTS_SUITE_ROW = 'Events';

/**
 * The Events row of SPEC 21, wired coverage by coverage, by the mechanism above.
 *
 * THE THIRD ROW TO GET A RUNNER, AND M5 IS THE MILESTONE THAT CLOSES IT. `T054` asks for the
 * event corpus, channel rendering, collector and topology suites to be wired into `pnpm gates`,
 * which is four coverages, and until this slice SPEC 21 named none of them: the row was added by
 * `T054` before this list, so what is reconciled is the specification's own cell rather than a
 * list this file both declares and checks.
 *
 * THE FILES SPAN FOUR PACKAGES AND THAT IS THE POINT OF THE ROW. An event document is normalized
 * in `core`, drawn in `render`, discovered in `nest` and merged in `federation`, and a coverage
 * that stopped at one package would be answered by whichever half happened to survive. So each
 * coverage names the suites that hold it wherever they live, and the gate runs them.
 */
export const EVENTS_SUITE_COVERAGE: readonly StaticCoverage[] = [
  {
    id: 'events-corpus',
    spec: 'корпус событий',
    files: [
      'packages/core/test/unit/events-corpus-snapshot.spec.ts',
      'packages/core/test/unit/asyncapi-normalizer.spec.ts',
    ],
    cases: [
      // The corpus itself, its size and its protocol spread, which is SPEC 21's own sentence
      // about AsyncAPI documents, plus the two properties a snapshot harness exists for.
      'should hold at least five documents across different protocols, per SPEC 21',
      'should normalize every document without error',
      'should produce the same IR on two consecutive runs of every document',
      'should give a document the hash it records for itself',
      // And the half the corpus is the only witness to: every member the documents write is
      // carried, counted by a reader independent of the normalizer.
      'should match the recorded report, which is where both field lists live with their counts',
      // The two versions SPEC 8.1 admits, read into one IR, and the refusals either side of them.
      'should produce one IR from a 3.0 document and the same document declaring 3.1',
      'should refuse AsyncAPI 2.x by naming the conversion rather than by failing to parse',
    ],
  },
  {
    id: 'channel-rendering',
    spec: 'рендер каналов и сообщений',
    files: ['packages/render/test/unit/channel-page.spec.ts'],
    cases: [
      // A channel is the node page through the same address space, per `T050`, so the model half
      // is what says a channel page is a channel page rather than an operation page.
      'should carry a channel on a channel node and nothing on an HTTP operation',
      'should draw the three channel sections and none of the operation ones',
      // The message half, which is the second noun of the row's own words.
      'should draw the payload, the headers, the correlation id and the example of one message',
      'should render an Avro payload as readable annotated source',
      'should read a JSON Schema payload as rows, requiredness and links included',
      // And the two rules a rendered page of this project may never break.
      'should offer no control a reader could press, because nothing would hydrate it',
      'should write no inline style and no script into any of the three sections',
    ],
  },
  {
    id: 'event-collectors',
    spec: 'коллекторы событий',
    files: [
      'packages/nest/test/unit/event-discovery.spec.ts',
      'packages/nest/test/integration/events.spec.ts',
    ],
    cases: [
      // The three sources of SPEC 8.3's table, each read off the real decorator's own metadata.
      'should read a message pattern and an event pattern off the same controller',
      'should resolve a gateway namespace and path into one channel address',
      'should let a declared channel outrank the metadata it stands beside',
      // The rule that keeps this from being runtime magic: what cannot be read is reported.
      'should report a gateway with no subscribe message rather than inventing a channel',
      'should report a pattern no address can be made from rather than rendering what it is',
      'should report a transport number outside the table rather than inventing a protocol',
      // And the synthesized document going through the same reader a written file goes through,
      // proven over real HTTP on a booted application rather than against a fake container.
      'should build a document the AsyncAPI reader accepts, with no file anywhere',
      'should build an events document from the application with no file anywhere',
    ],
  },
  {
    id: 'topology',
    spec: 'топология',
    files: [
      'packages/core/test/unit/topology.spec.ts',
      'packages/render/test/unit/topology-section.spec.ts',
      'packages/nest/test/unit/topology-relationships.spec.ts',
    ],
    cases: [
      // The graph: the two directions of SPEC 9.2, the reply edge, and the resolution rule that
      // refuses to guess between two channels answering one address.
      'should turn a send and a receive into the two directions of SPEC 9.2',
      'should turn a reply channel into one calls edge and not into a second direction',
      'should resolve an event name to the one channel that answers the address',
      'should leave an event name unresolved when two channels answer the address',
      // The two facts SPEC 9.5 insists a reader be able to tell apart.
      'should tell a dead end and an outside end apart, since they are different facts',
      // The cycle, which is the shape a real estate has and the one a walk would hang on.
      'should arrange a cycle as three groups rather than walking it',
      'should draw a cycle as three groups and finish',
      // The declared-only policy of SPEC 9, at the one place a decorator produces an edge.
      'should draw one declared edge from the handler node to the event it names',
      'should report a decorator that names nothing and draw no edge for it',
      'should lower a declared edge to the level the direction was actually read at',
    ],
  },
];

/** The milestone whose definition of done the events wiring below answers, as SPEC 22 spells it. */
export const EVENTS_MILESTONE = 'M5';

/**
 * The M5 definition of done, wired clause by clause to the cases that answer each.
 *
 * TWO CLAUSES, AND THE FIRST ONE IS THREE CLAIMS. "An application with RabbitMQ and a WebSocket
 * gateway is documented on one page together with HTTP" asks for a booted application whose
 * channels come from decorators and not from a file, for a transport that is really RabbitMQ
 * rather than the one transport that happened to be easiest, and for one page rather than two.
 *
 * THE GATEWAY HALF IS ANSWERED BY A UNIT CASE AND THAT IS STATED RATHER THAN GLOSSED. A
 * `@WebSocketGateway` in the providers list makes Nest load a websocket adapter at boot, which
 * needs `socket.io` installed, and an application that cannot boot proves nothing about a
 * reference; `events.spec.ts` says so in its own header. So the gateway is exercised against the
 * real `@WebSocketGateway` and `@SubscribeMessage` decorators in `event-discovery.spec.ts`, which
 * is where the metadata this package reads is actually written, and the booted half carries
 * RabbitMQ and Kafka. Whether `socket.io` becomes a dev dependency so the booted half can carry a
 * gateway too is with the maintainer, recorded at `T051`; until it is answered, this list names
 * what really runs rather than a case that would claim more than it proves.
 *
 * AND IT IS BOXED SINCE THE SECOND POST-`T054` REVIEW, WHICH IS WHAT THIS COMMENT WAS MISSING. A
 * milestone closing over a clause answered by a double, disclosed in a comment and in a narrative
 * and in no place a gate reads, is SPEC 0's ninth class; the comment was the disclosure and nothing
 * was the obligation. The section is "`T059` The WebSocket gateway half of the M5 clause, answered
 * by a unit double" in `ai-docs/BUILD-AMENDMENTS.md`, it carries the dependency question as
 * escalated, and its box keeps `T059` from being ticked over it.
 *
 * NOT RUN BY THIS GATE, per `checkMilestoneClauses` and for the reason the M3 and M4 clauses are
 * held that way: the cases are `packages/nest` suites that `pnpm test:integration` already runs,
 * and running them here would report one red twice.
 */
export const EVENTS_MILESTONE_CLAUSES: readonly StaticCoverage[] = [
  {
    id: 'one-page-with-http',
    spec: 'приложение с RabbitMQ и WS-гейтвеем документируется одной страницей вместе с HTTP',
    files: [
      'packages/nest/test/integration/events.spec.ts',
      'packages/nest/test/unit/event-discovery.spec.ts',
      'packages/nest/test/integration/mixed-page.spec.ts',
    ],
    cases: [
      // The booted application, its brokers, and the page a reader opens.
      'should build an events document from the application with no file anywhere',
      'should attribute each channel to the broker of its own transport',
      'should serve the channel page and the asyncapi document, and refuse the openapi one',
      // The gateway half, against the real decorators, for the reason above.
      'should resolve a gateway namespace and path into one channel address',
      // And one page rather than two, which is the clause's own last word.
      'should put operations and channels in one navigation tree rather than two',
      'should reach every node of the merged document from the one navigation',
    ],
  },
  {
    id: 'endpoint-event-consumers-graph',
    spec: 'виден граф «эндпоинт → событие → потребители»',
    files: [
      'packages/render/test/unit/topology-section.spec.ts',
      'packages/nest/test/integration/topology.spec.ts',
      'packages/federation/test/unit/cross-service-edges.spec.ts',
    ],
    cases: [
      // The graph is drawn, and the two ends of the arrow are told apart on the page.
      'should link an end that resolved to a node and leave an unresolved one as text',
      'should carry the graph on the overview and on no other page',
      // On a booted application, which is the only place the confidence of an edge is real.
      'should carry each edge at the confidence its direction was actually read at',
      // And the consumers half, which needs more than one service to exist at all.
      'should span services in the topology, which is the reason the feature exists',
    ],
  },
];

/** The milestone whose definition of done the federation wiring below answers. */
export const FEDERATION_MILESTONE = 'M4';

/**
 * The M4 definition of done, wired to the case that answers it.
 *
 * ONE CLAUSE, AND WHAT IT OWES IS THE WHOLE OF IT. "The three service demo works as one page" is
 * three claims: the demo of three services boots, it is one page rather than three, and it is the
 * whole federation rather than the part that answered first. The case named here reads one mount's
 * page, its live snapshot and its search index off the running demo, so a mount that started
 * serving three documents, or one that dropped the local service, fails it.
 *
 * IT IS NOT RUN BY THIS GATE, for the reason `checkMilestoneClauses` gives about the M3 clauses:
 * it is a `packages/nest` integration suite that `pnpm test:integration` already runs, and running
 * it here would boot the demo a second time to report the same red twice.
 */
export const FEDERATION_MILESTONE_CLAUSES: readonly StaticCoverage[] = [
  {
    id: 'three-service-demo',
    spec: 'демо из трёх сервисов работает как одна страница',
    files: ['packages/nest/test/integration/federation.spec.ts'],
    cases: ['should serve the three services as one document, which is the M4 definition of done'],
  },
];

/**
 * The suite T047 adds beyond the two documents, wired so its removal goes red.
 *
 * THE SPEC 20 BUDGETS RE-CHECKED ON A MERGED DOCUMENT THREE TIMES THE SIZE ARE THE HALF OF `T047`
 * THAT NO SPECIFICATION SENTENCE NAMES: SPEC 21's Federation row states three coverages and the
 * M4 done-when states one clause, and the tripled budget suite answers neither, so neither list
 * above can carry it without failing its own reconciliation. Named by no list at all, it sat in
 * the defect class this gate exists on: the post-close review of `T047` found that deleting the
 * file would have left `pnpm gates` green with nothing saying so.
 *
 * SO IT IS WIRED BY THE REPOSITORY HALF ALONE, `checkSuiteFiles`, the same check the two lists
 * above share: the named file must be there, every named case must be present, and a named case
 * must assert something. There is no specification half because no specification sentence names
 * this suite; the `spec` field carries the suite's own describe title rather than a SPEC cell,
 * and it is compared with nothing.
 *
 * CHECKED AND NOT RUN, for the reason the milestone clause is: it is a `packages/nest`
 * integration suite that `pnpm test:integration` already runs, and a gate run of a three
 * thousand node merge would spend that time to report the same red twice.
 */
export const FEDERATION_BUDGET_SUITE: readonly StaticCoverage[] = [
  {
    id: 'tripled-budgets',
    spec: 'the SPEC 20 budgets on a merged document three times the size',
    files: ['packages/nest/test/integration/federation-budget.spec.ts'],
    cases: [
      'should merge three thousand node services into one document of three thousand nodes',
      'should keep the search index of the merged document inside three times its row',
      'should prerender a page of the merged document inside three times its row',
    ],
  },
];

/** The milestone whose definition of done the wiring below answers, as SPEC 22 spells it. */
export const MILESTONE_UNDER_GATE = 'M3';

/**
 * Each clause of the M3 definition of done, wired to the cases that answer it.
 *
 * THE DONE-WHEN OF T042 IS "CI PROVES THE M3 DoD WITHOUT MANUAL STEPS", and until this list existed
 * that was met for one clause out of three. The static build clause got a named case saying which
 * sentence it answers; the other two ran in CI through suites that happened to exist, carried no
 * clause name, and were tied to the milestone by nobody. A rename of either would have left SPEC 22
 * promising a proof with nothing behind it, which is exactly what `STATIC_SUITE_COVERAGE` above
 * exists to prevent for a row of SPEC 21, so the same mechanism is pointed at the milestone.
 *
 * ONE ENTRY PER CLAUSE, IN THE SPECIFICATION'S OWN WORDS, and reconciled in both directions: a
 * clause SPEC 22 states and this list does not answer fails, and a clause this list answers that
 * SPEC 22 does not state fails as well.
 *
 * WHAT EACH ENTRY OWES IS THE WHOLE CLAUSE AND NOT ITS EASIER HALF. "on a real specification
 * history" is a git history and not a pair of files, and "fails the pipeline" is an exit code that
 * leaves the process and not an outcome object, so each list carries the case that proves the part
 * a reader would otherwise assume.
 */
export const MILESTONE_CLAUSE_COVERAGE: readonly StaticCoverage[] = [
  {
    id: 'diff-over-history',
    spec: '`diff` ловит ломающие изменения на реальной истории спеки',
    files: [
      'packages/cli/test/unit/diff-command.spec.ts',
      'packages/cli/test/unit/git-ref-adapter.spec.ts',
      'packages/cli/test/integration/cli-binary.spec.ts',
    ],
    cases: [
      // The history half: two commits of one specification file in a real repository, read
      // through the same git ref sides a caller types, with the breaking change between them.
      'should catch a breaking change between two commits of one specification, which is the M3 definition of done',
      // The findings half, at the SPEC 17.1 wording, and the exit code leaving the process.
      'should print the SPEC 17.1 example verbatim on the pair built to produce it, and exit 1',
      'should carry exit code 1 out of the process for a diff with breaking changes',
      'should read a committed file at HEAD',
    ],
  },
  {
    id: 'static-from-the-example',
    spec: 'статика разворачивается из примера',
    files: ['packages/cli/test/integration/cli-binary.spec.ts'],
    cases: [
      'should deploy the static site out of the example application, which is the M3 definition of done',
    ],
  },
  {
    id: 'doctor-fails-the-pipeline',
    spec: '`doctor` роняет пайплайн при дрейфе',
    files: [
      'packages/cli/test/unit/doctor-command.spec.ts',
      'packages/cli/test/integration/cli-binary.spec.ts',
    ],
    cases: [
      // The pipeline half: a spawned process, whose exit code is the only thing CI reads.
      'should carry a non zero exit code out of the process for doctor on drift, which is the M3 definition of done',
      // And the threshold half, both ways round, so "fails on drift" is not "fails on anything".
      'should fail at --fail-on=drift on a warning severity finding',
      'should never fail when --fail-on is omitted, whatever it finds',
    ],
  },
];

/**
 * The CI job that gives the SPEC 20 elapsed budget a machine.
 *
 * THE NUMBER MEANS NOTHING WITHOUT ONE, which is what T042 is asked to fix. SPEC 20 bounds the
 * static build of 1000 nodes on four cores at sixty seconds; a suite run wherever it lands measures
 * a machine nobody declared, and T039 already recorded that this made the assertion a hang catcher
 * rather than a budget. The job below pins the runner and tells the suite what size it is; the
 * suite refuses to certify on a machine of another size and says so rather than passing quietly.
 */
export const STATIC_BUDGET_JOB: BudgetJobExpectation = {
  workflow: '.github/workflows/ci.yml',
  job: 'static-build-budget',
  suite: 'packages/static/test/integration/build-budget.spec.ts',
  coresVariable: 'OPENREF_STATIC_BUDGET_CORES',
  cores: 4,
};

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
 * The top level trees the text scan must reach, each of which a reader can run or read.
 *
 * THE SCAN HAS NO ROOT LIST ANY MORE AND THIS IS NOT ONE, which is the difference the T035 finding
 * turned on. It walked `packages` and `tools`, so `examples/`, `compat/`, `.github/` and every root
 * level file including `vitest.shared.ts` were scanned by nothing, and a root dropped from the list
 * would have taken its whole tree out of the scan with the gate still green. The walk now starts at
 * the repository root, so nothing is outside it and there is no list to drop from.
 *
 * What this list is instead: the trees whose disappearance from the scan would be a defect rather
 * than a deletion. Each must yield at least one file, and a tree that yields none fails by name.
 * A tree genuinely removed from the repository is removed from here in the same commit, which is
 * a decision somebody makes rather than a count that quietly drops.
 */
export const TEXT_SOURCE_EXPECTED_TREES: readonly string[] = [
  '.changeset',
  '.github',
  'compat',
  'examples',
  'packages',
  'tools',
];

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
 * RE-DERIVED AT T042 FROM ITS OWN MEASUREMENT, 200 to 800, because 200 was a figure the tree had
 * long outgrown. T035 filed it: the floor stood at 200 against a real 697, so most of the
 * repository could have stopped being scanned with the gate still green.
 *
 * THE MEASUREMENT IS RE-TAKEN AT THE CLOSE OF T042 AND THE FIGURES BELOW ARE THAT READING, because
 * the first ones this comment carried, 907 with `packages` at 732 and `tools` at 135, were already
 * fourteen files stale by the end of the task that wrote them, and a derivation whose warrant no
 * longer describes the tree is a number nobody can check. The second reading, 922 with `tools` at
 * 139, went stale the same way and inside the same task: the browser case that closes the
 * `static-proxy-transport` debt is a file under `tools`, and it landed after that reading. Measured
 * on the whole checkout: 923 files, of which `packages` is 743 and `tools` is 140, with `examples`
 * 15, `<root file>` 16, `.github` 4, `compat` 3 and `.changeset` 2.
 *
 * THE PROPERTY THAT DERIVES THE NUMBER, rather than a fraction: losing either of the two large
 * trees fails it. Without `packages` the walk yields 180 and without `tools` it yields 783, so any
 * floor above 783 and below the measured 923 holds the property, and 800 still is, with room for
 * the ordinary work of one milestone. It is a floor and not a count: a count would be a second
 * thing to maintain on every file added, which is how a check comes to be edited to keep it
 * passing, and it is why a figure moving by fourteen is a comment to re-take rather than a
 * threshold to move. The per tree counts are printed beside it on every run and
 * `TEXT_SOURCE_EXPECTED_TREES` names the small trees, whose loss no total can see.
 */
export const TEXT_SOURCE_MIN_FILES = 800;

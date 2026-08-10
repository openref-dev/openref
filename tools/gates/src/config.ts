/**
 * Gate configuration: the budgets and floors from SPEC 20 and STANDARDS 9.1 and 12.
 *
 * Nothing in this file is ever raised or lowered to make a build pass. If a value here is
 * genuinely wrong, `ai-docs/SPEC.md` changes first.
 */

import { ASSET_ALLOWED_LICENSES, FIXTURE_ALLOWED_LICENSES } from './lib/fixtures.js';
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
    file: 'ai-docs/BUILD-AMENDMENTS.md',
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

/** Directory names under `packages/`, in dependency order. */
export const PACKAGE_DIRS: readonly string[] = [
  'core',
  'vue',
  'render',
  'runner',
  'search',
  'nest',
  'theme',
  'cli',
];

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
 */
export interface SizeBudget {
  readonly id: string;
  readonly label: string;
  readonly limitBytes: number;
  /** Repository relative directories that hold the artifacts making up this bundle. */
  readonly roots: readonly string[];
  readonly extensions: readonly string[];
  /** Task that first produces the artifacts, printed when the budget has nothing to measure. */
  readonly producedBy: string;
}

/**
 * A budget that can only be checked by running something, owned by the task that builds it.
 */
export interface MeasuredBudget {
  readonly id: string;
  readonly label: string;
  readonly limit: string;
  readonly enforcedBy: string;
}

export const SIZE_BUDGETS: readonly SizeBudget[] = [
  {
    id: 'client-js',
    label: 'Client JS, core plus default theme, gzip',
    limitBytes: 100 * 1024,
    roots: ['packages/render/dist/browser', 'packages/theme/dist/browser'],
    extensions: ['.js', '.mjs'],
    producedBy: 'T011',
  },
  {
    id: 'theme-css',
    label: 'Default theme CSS, gzip',
    limitBytes: 15 * 1024,
    roots: ['packages/theme/dist', 'packages/theme/fonts'],
    extensions: ['.css'],
    producedBy: 'T009',
  },
];

/**
 * A theme's font directory, budgeted twice.
 *
 * PER THEME, NOT PER REPOSITORY, and that is the point rather than a convenience. A theme
 * nobody loads costs nothing, and there will be more than one theme. A repository total would
 * have to be raised every time a theme is added, which is a budget that only ever moves in one
 * direction.
 *
 * Two numbers rather than one, for the same reason. The first bounds what a reader actually
 * waits for: the primary sans weight and the primary mono weight, which are the two files the
 * first paint needs. Everything else loads with `font-display: swap` and delays nothing, so
 * the second number bounds the whole directory and sits looser. A single cap would fail on
 * arrival: the heaviest of the three designs fills almost all of it, and a font version bump
 * would then break the build while saying nothing about whether a reader is worse off.
 */
export interface FontBudget {
  /** The package that ships them, for the message. */
  readonly theme: string;
  /** Repository relative directory holding the font files. */
  readonly directory: string;
  /** The two files the first paint needs: the primary sans weight and the primary mono weight. */
  readonly firstPaint: readonly string[];
  readonly producedBy: string;
}

/** Both caps, per SPEC 20. Measured gzip, like every other budget. */
export const FONT_BUDGET_LIMITS = {
  firstPaintBytes: 60 * 1024,
  totalBytes: 130 * 1024,
} as const;

export const FONT_BUDGETS: readonly FontBudget[] = [
  {
    theme: '@openref/theme',
    directory: 'packages/theme/fonts',
    firstPaint: ['SpaceGrotesk-400.woff2', 'JetBrainsMono-400.woff2'],
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
  { id: 'tti', label: 'TTI, 1000 nodes, 4x CPU throttle', limit: '150 ms', enforcedBy: 'T015' },
  {
    id: 'client-memory',
    label: 'Peak client memory, 7 MB document',
    limit: '250 MB',
    enforcedBy: 'T015',
  },
  { id: 'external-requests', label: 'External network requests', limit: '0', enforcedBy: 'T015' },
  {
    id: 'static-build',
    label: 'Static build, 1000 nodes, 4 cores',
    limit: '60 s',
    enforcedBy: 'T039',
  },
];

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

/** Directories scanned for CSP violations, relative to the repository root. */
export const CSP_SCAN_ROOTS: readonly string[] = PACKAGE_DIRS.map((dir) => `packages/${dir}/dist`);

/** Extensions scanned for CSP violations. */
export const CSP_SCAN_EXTENSIONS: readonly string[] = [
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.html',
  '.htm',
];

/**
 * Gate configuration: the budgets and floors from SPEC 20 and STANDARDS 9.1 and 12.
 *
 * Nothing in this file is ever raised or lowered to make a build pass. If a value here is
 * genuinely wrong, `ai-docs/SPEC.md` changes first.
 */

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
    roots: ['packages/theme/dist'],
    extensions: ['.css'],
    producedBy: 'T009',
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

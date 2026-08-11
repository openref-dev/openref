/**
 * The dependency graph rules for OPENREF, built from what is on disk.
 *
 * The allowed graph, from STANDARDS 3.5:
 *
 *   core   ->  nothing
 *   vue    ->  core
 *   render ->  core, vue
 *   runner ->  core
 *   search ->  core
 *   theme  ->  nothing
 *   nest   ->  core, render, runner, search
 *   cli    ->  core, render, runner, search, static
 *
 * A violation fails the build. Never relax a rule to make a build pass.
 *
 * WHY THIS FILE EXISTS RATHER THAN A CONSTANT IN `.dependency-cruiser.cjs`, AND IT IS F23.
 * The set of packages was a hand written array in two files, and nothing compared either to the
 * disk. `boundary()` builds each rule's `to.path` by filtering that array, so a package missing
 * from it is in no rule's `to` path in either direction: measured on 2026-08-11 by creating
 * `packages/probe2`, having `packages/core/src` import it, and cruising, which reported no
 * violations. `core` reached a new package and all eight boundary rules stayed green. The same
 * array drove `CSP_SCAN_ROOTS`, so a new package's built output was also never scanned for inline
 * styles while the gate printed a count and passed.
 *
 * The set is now read from `packages/` on every run and there is exactly one reader of it in the
 * repository, which `tools/gates/src/lib/package-dirs.ts` calls rather than copying. What cannot
 * be derived is `BOUNDARIES`, because what a package may depend on is a decision rather than a
 * fact about the disk, and that one is reconciled in both directions instead: see `reconcile`.
 *
 * IT IS A SEPARATE FILE SO THAT THE BUILDER CAN BE CALLED ON A ROOT THAT IS NOT THIS ONE. The
 * check that matters is what happens when a ninth package appears, and planting one into the real
 * `packages/` breaks every test that reads the repository in parallel. `buildConfig` takes a root,
 * so `tools/gates/test/unit/package-coverage.spec.ts` builds the committed rules over a synthetic
 * tree and the configuration stays the thing under test.
 */

const { readdirSync } = require('node:fs');
const { join } = require('node:path');

/**
 * What each package under `packages/` may depend on.
 *
 * THE ONLY HAND MAINTAINED LIST LEFT HERE, and it is one because it is policy. A new package
 * cannot be given a boundary by reading the disk: what it is allowed to reach is a decision, and
 * the wrong default is silently permissive. There is deliberately no default at all. A directory
 * under `packages/` with no entry here fails the cruise by name, which is the moment the decision
 * has to be made and the cheapest moment to make it.
 */
const BOUNDARIES = {
  core: [],
  vue: ['core'],
  render: ['core', 'vue'],
  runner: ['core'],
  search: ['core'],
  nest: ['core', 'render', 'runner', 'search'],
  theme: [],
  cli: ['core', 'render', 'runner', 'search'],

  // THE THREE ECOSYSTEM COLLECTORS OF SPEC 4, AND THE EDGE RUNS THE OTHER WAY. `nest` does not
  // depend on any of them and must not: each one exists to read a third party package, and an
  // edge from `nest` would put that package in the closure of the one every consumer installs.
  // They depend on `nest` for the collector contract and on `core` for the IR their `collect`
  // returns, both type-only and both declared as peers, because a host that registers one of these
  // already has both installed. STANDARDS 3.5's table reads `nest -> collectors`, which is the
  // direction a reader expects and is not the direction that ships.
  'collector-throttler': ['core', 'nest'],
  'collector-casl': ['core', 'nest'],
  'collector-access-control': ['core', 'nest'],
};

/**
 * Reads the package directory names under `packages/`.
 *
 * EVERY DIRECTORY COUNTS, WITH NO MANIFEST TEST, and that is deliberate. A `package.json` filter
 * would read as tighter and is looser: a relative import reaches `packages/probe2/src/index.ts`
 * whether or not anything declares it a package, which is exactly how the F23 probe was written.
 * The point of this function is the set of directories a path anchor can match, not the set of
 * things npm would publish.
 *
 * @param {string} repoRoot absolute path to the repository root
 * @returns {string[]} directory names, sorted, or an empty array when there is no `packages/`
 */
function readPackageDirs(repoRoot) {
  let entries;
  try {
    entries = readdirSync(join(repoRoot, 'packages'), { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Compares the packages on disk with the packages `BOUNDARIES` declares, both ways.
 *
 * BOTH DIRECTIONS MATTER AND THEY FAIL FOR DIFFERENT REASONS. A directory with no entry is a
 * package no rule governs, which is F23. An entry with no directory is worse to read than to run:
 * it governs nothing, it cannot fail, and it is indistinguishable from coverage until someone
 * checks the disk.
 *
 * @param {string[]} diskDirs directory names read from `packages/`
 * @returns {string[]} one message per mismatch, empty when the two agree exactly
 */
function reconcile(diskDirs) {
  const declared = Object.keys(BOUNDARIES);
  const problems = [];

  for (const dir of diskDirs) {
    if (!declared.includes(dir)) {
      problems.push(
        `packages/${dir} exists on disk and has no entry in BOUNDARIES. ` +
          'No rule governs it in either direction: nothing may be checked for importing it, and ' +
          'it may import anything. Add an entry saying what it is allowed to depend on.',
      );
    }
  }

  for (const dir of declared) {
    if (!diskDirs.includes(dir)) {
      problems.push(
        `BOUNDARIES declares "${dir}" and packages/${dir} is not on disk. ` +
          'An entry for a package that is not there governs nothing and cannot fail, so it reads ' +
          'as coverage. Remove it.',
      );
    }
  }

  return problems;
}

/**
 * Builds a forbidden rule that allows a package to reach only the listed packages.
 *
 * The forbidden set is every other package on disk, so a package added to the repository is in
 * this rule's `to` path from the moment its directory exists.
 *
 * @param {string} pkg directory name under packages/
 * @param {string[]} allowed directory names this package may depend on
 * @param {string[]} packageDirs every package directory on disk
 * @returns {object} dependency-cruiser rule
 */
function boundary(pkg, allowed, packageDirs) {
  const reachable = [pkg, ...allowed];
  const forbidden = packageDirs.filter((candidate) => !reachable.includes(candidate));

  return {
    name: `boundary-${pkg}`,
    severity: 'error',
    comment: `packages/${pkg} may only depend on: ${allowed.join(', ') || 'nothing'}`,
    from: { path: `^packages/${pkg}/src/` },
    to: { path: `^packages/(${forbidden.join('|')})/` },
  };
}

/**
 * Builds the whole dependency-cruiser configuration for one repository root.
 *
 * @param {string} repoRoot absolute path to the repository root
 * @returns {object} dependency-cruiser configuration
 * @throws {Error} when the packages on disk and the `BOUNDARIES` entries do not agree
 */
function buildConfig(repoRoot) {
  const packageDirs = readPackageDirs(repoRoot);
  const problems = reconcile(packageDirs);

  if (problems.length > 0) {
    throw new Error(
      `tools/dependency-rules.cjs cannot describe ${repoRoot}:\n  ${problems.join('\n  ')}`,
    );
  }

  return {
    forbidden: [
      ...packageDirs.map((pkg) => boundary(pkg, BOUNDARIES[pkg], packageDirs)),
      {
        name: 'core-is-framework-free',
        severity: 'error',
        comment: 'packages/core must not reach Nest, Vue or the DOM',
        from: { path: '^packages/core/src/' },
        to: { path: '(^|node_modules/)(@nestjs/|nest$|vue$|vue/|@vue/|jsdom|happy-dom)' },
      },
      {
        name: 'no-circular',
        severity: 'error',
        comment: 'circular dependencies make build order and hashing non deterministic',
        from: {},
        to: { circular: true },
      },
      {
        name: 'not-to-unresolvable',
        severity: 'error',
        comment: 'a module that cannot be resolved is either a typo or a missing dependency',
        from: {},
        to: { couldNotResolve: true },
      },
      // THE TWO RULES BELOW KEY ON `dependencyTypes`, WHICH ONLY EXISTS ON AN EDGE TO AN NPM
      // PACKAGE, so they are the two that `options.exclude` scoped away from their own material
      // until 2026-08-11. See the note on `exclude`. `tools/gates/test/unit/dependency-rules.spec.ts`
      // plants a violation of each and watches it fail, because a rule of this shape reports the
      // same clean line whether it is working or unreachable.
      {
        name: 'no-dev-dep-in-src',
        severity: 'error',
        comment: 'published source must not name a package the consumer was never told to install',
        from: { path: '^packages/[^/]+/src/', pathNot: '\\.spec\\.ts$' },
        // A PEER IS EXEMPT AND A TYPE-ONLY IMPORT IS NOT, which is the reverse of the pairing the
        // sibling rule uses, and both directions are deliberate. A peer is declared to the consumer
        // and is also a devDependency here so this repository can build and test against a version,
        // which is the sanctioned pattern rather than a defect. A type-only import of a dev only
        // package is erased from the JavaScript and survives in the published `.d.ts`, where it
        // breaks the consumer's typecheck instead of their install, so it stays caught.
        to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['npm-peer'] },
      },
      {
        name: 'no-duplicate-dep-types',
        severity: 'error',
        comment: 'a package must be declared in exactly one dependency group, peers excepted',
        from: {},
        // `npm-peer` excepted for the reason above: peer plus dev is one declaration with two
        // audiences. What is left is the real defect, a package in `dependencies` and
        // `devDependencies` at once, where which copy a consumer gets is the resolver's choice.
        to: { moreThanOneDependencyType: true, dependencyTypesNot: ['type-only', 'npm-peer'] },
      },
    ],
    options: {
      // `doNotFollow` AND `exclude` ARE NOT THE SAME THING, AND F22 WAS THE DIFFERENCE.
      // `doNotFollow` keeps an npm package in the graph as a node and declines to cruise inside it,
      // which is what is wanted: the edge into it is the thing the two `dependencyTypes` rules
      // judge, and its 900 internal files are not. `exclude` deletes the node, and with it the edge,
      // so a rule that keys on `dependencyTypes` has nothing left to fire on and reports a clean
      // graph forever. `node_modules/` was in `exclude` until 2026-08-11, which made both of those
      // rules unreachable from the day they were written.
      //
      // THE REMAINING EXCLUSION IS ANCHORED FOR THE SAME REASON. A bare `(dist|coverage)/` would
      // still delete every npm package whose entry point sits under `dist/`, which is most of them,
      // and would re-open the hole for those packages while looking like it only skipped our own
      // build output. It names the two directories in our own tree and nothing else.
      doNotFollow: { path: 'node_modules' },
      exclude: { path: '^packages/[^/]+/(dist|coverage)/' },
      tsPreCompilationDeps: true,
      tsConfig: { fileName: 'tsconfig.json' },
      enhancedResolveOptions: {
        exportsFields: ['exports'],
        conditionNames: ['source', 'import', 'require', 'node', 'default'],
        mainFields: ['source', 'module', 'main'],
        extensions: ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json'],
      },
      reporterOptions: {
        text: { highlightFocused: true },
      },
    },
  };
}

module.exports = { BOUNDARIES, readPackageDirs, reconcile, buildConfig };

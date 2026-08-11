/**
 * Dependency graph rules for OPENREF.
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
 */

const PACKAGE_DIRS = ['core', 'vue', 'render', 'runner', 'search', 'nest', 'theme', 'cli'];

/**
 * Builds a forbidden rule that allows a package to reach only the listed packages.
 *
 * @param {string} pkg directory name under packages/
 * @param {string[]} allowed directory names this package may depend on
 * @returns {object} dependency-cruiser rule
 */
function boundary(pkg, allowed) {
  const reachable = [pkg, ...allowed];
  const forbidden = PACKAGE_DIRS.filter((candidate) => !reachable.includes(candidate));

  return {
    name: `boundary-${pkg}`,
    severity: 'error',
    comment: `packages/${pkg} may only depend on: ${allowed.join(', ') || 'nothing'}`,
    from: { path: `^packages/${pkg}/src/` },
    to: { path: `^packages/(${forbidden.join('|')})/` },
  };
}

module.exports = {
  forbidden: [
    boundary('core', []),
    boundary('vue', ['core']),
    boundary('render', ['core', 'vue']),
    boundary('runner', ['core']),
    boundary('search', ['core']),
    boundary('theme', []),
    boundary('nest', ['core', 'render', 'runner', 'search']),
    boundary('cli', ['core', 'render', 'runner', 'search']),
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

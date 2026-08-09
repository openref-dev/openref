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
    {
      name: 'no-dev-dep-in-src',
      severity: 'error',
      comment: 'production source must not import a devDependency',
      from: { path: '^packages/[^/]+/src/', pathNot: '\\.spec\\.ts$' },
      to: { dependencyTypes: ['npm-dev'] },
    },
    {
      name: 'no-duplicate-dep-types',
      severity: 'error',
      comment: 'a package must be declared in exactly one dependency group',
      from: {},
      to: { moreThanOneDependencyType: true, dependencyTypesNot: ['type-only'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(dist|coverage|node_modules)/' },
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

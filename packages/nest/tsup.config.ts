import { defineConfig } from 'tsup';

/**
 * Two builds, for two different runtimes.
 *
 * THE SERVER BUILD. `@openref/nest` is what a consumer installs, so it carries the internal
 * packages inside itself: `render`, `runner` and `search` are private and are bundled here.
 *
 * Third party code is not bundled with them. `skipNodeModulesBundle` keeps every published
 * dependency external, and `noExternal` makes the workspace packages the one exception.
 * Inlining the third party tree instead would copy Vue, the sanitizer and the highlighter
 * into this file, which duplicates them for anyone who also depends on them, defeats their
 * own conditional exports, and puts a server side `new Function` from a CSS parser into an
 * artifact that is scanned for exactly that.
 *
 * The consequence is that every third party dependency of a bundled package has to be a
 * dependency of this one. That is honest: those packages are installed because this one is.
 *
 * THE BROWSER BUILD is the artifact a page loads, and it lives here rather than in
 * `@openref/render` because this is the first package that may see the runner. See
 * `src/browser/entry.ts` for why that follows from the dependency rule.
 *
 * IT RESOLVES WORKSPACE PACKAGES THROUGH THEIR `source` CONDITION, which is not a
 * convenience. `@openref/render`'s `./browser` export points its `import` condition at the
 * self hydrating bundle that package ships, and inlining that would hydrate the page before
 * this entry ever got to hand a runner over. The `source` condition points at the library
 * form, which hydrates nothing on load. Third party packages declare no such condition and
 * resolve exactly as they did.
 */
export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    target: 'node20',
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    skipNodeModulesBundle: true,
    noExternal: [/^@openref\//],
    outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
  },
  {
    entry: { openref: 'src/browser/entry.ts' },
    outDir: 'dist/browser',
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: false,
    clean: false,
    minify: true,
    treeshake: true,
    noExternal: [/^vue$/, /^@vue\//, /^@openref\//],
    outExtension: () => ({ js: '.js' }),
    esbuildOptions(options) {
      options.conditions = ['source'];
    },
  },
]);

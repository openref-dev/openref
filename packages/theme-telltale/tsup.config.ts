import { defineConfig } from 'tsup';

/**
 * The stylesheets are entry points so that `dist/styles/*.css` exists for the `exports` map to
 * point at, exactly as `@openref/theme` does it. `fonts/fonts.css` is deliberately NOT here: a
 * stylesheet whose `url()` names a binary beside it survives a bundler only by being kept away
 * from one, and its reasoning is in `fonts/FONTS.md`.
 */
export default defineConfig([
  {
    entry: ['src/index.ts', 'src/styles/tokens.css', 'src/styles/theme.css'],
    format: ['esm', 'cjs'],
    target: 'node20',
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    // ONE OPENREF PACKAGE SINCE `T031-R1`. `@openref/core` left this list with the peer
    // dependency: the four IR types this theme's props are declared in are re-exported by
    // `@openref/vue`, so no file under `src` names the core package any more.
    external: ['vue', '@openref/vue'],
    outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
  },
  {
    // THE ENTRY BUILT WITH THIS THEME, per T033: the browser artefact a host names in
    // `theme.bundle`. It mirrors the settings of `@openref/nest`'s own browser build, because
    // it IS that build plus this theme: everything inlined through the `source` condition, so
    // the page gets one bundle and one `@openref/vue` instance, split so the deferred features
    // stay behind their gestures, and served through the same asset catalog that rewrites the
    // chunk names.
    entry: { entry: 'src/entry.ts' },
    outDir: 'dist/entry',
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: false,
    clean: false,
    minify: true,
    treeshake: true,
    splitting: true,
    noExternal: [/^vue$/, /^@vue\//, /^@openref\//],
    outExtension: () => ({ js: '.js' }),
    esbuildOptions(options) {
      options.conditions = ['source'];
    },
  },
]);

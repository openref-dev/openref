import { defineConfig } from 'tsup';

/**
 * Two builds, and the split is the point.
 *
 * The server build leaves dependencies external, the way a Node package should: whoever
 * installs it resolves `marked`, `shiki` and the sanitizer themselves.
 *
 * The browser build inlines everything it needs and is loaded directly by a page, so its
 * size is the size a visitor pays. It has its own entry, which imports neither the
 * highlighter nor the sanitizer, and a test asserts that against the built file rather
 * than against this configuration: a build setting that is supposed to keep 300 KB out of
 * the client is worth checking by weighing the output.
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
  },
]);

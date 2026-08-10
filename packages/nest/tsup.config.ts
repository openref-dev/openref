import { defineConfig } from 'tsup';

/**
 * `@openref/nest` is what a consumer installs, so it carries the internal packages inside
 * itself: `render`, `runner` and `search` are private and are bundled here.
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
 */
export default defineConfig({
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
});

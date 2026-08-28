import { defineConfig } from 'tsup';

/**
 * The CLI, with its one internal package inside it.
 *
 * `@openref/static` IS BUNDLED IN, per SPEC 4's internal package list: it is private, so a
 * consumer of `openref` cannot install it and must receive it here. Everything published stays
 * external, `@openref/render` and `@openref/search` among them, because they arrive through
 * `@openref/nest`, which this package depends on for the browser bundle a built page loads and
 * for the theme it is styled with.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  format: ['esm', 'cjs'],
  target: 'node20',
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  skipNodeModulesBundle: true,
  noExternal: [/^@openref\/static$/],
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
});

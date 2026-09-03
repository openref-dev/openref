import { defineConfig } from 'tsup';

/**
 * The CLI, with its three internal packages inside it.
 *
 * `@openref/static` IS BUNDLED IN, per SPEC 4's internal package list: it is private, so a
 * consumer of `openref` cannot install it and must receive it here.
 *
 * `@openref/render` AND `@openref/search` JOINED IT AT THE POST T064 REVIEW, and the sentence
 * that used to stand here was wrong in the way that matters. It said the two "stay external,
 * because they arrive through `@openref/nest`". They do not arrive at all: both are private, so
 * neither exists on the registry, and `@openref/nest` does not install them either, it inlines
 * them into its own bundle where nothing outside can name them. So this package declared two
 * dependencies npm cannot resolve, and its shipped JavaScript carried three bare imports of them.
 * `npm install openref` failed before any of it ran. Measured on the packed tarball rather than
 * inferred: `dist` named `@openref/render` and `@openref/search` three times each.
 *
 * `@openref/samples` JOINED THEM AT `TX-PAGE-SAMPLES`, for exactly the reason those two did. It
 * is private, the static build path calls it so that a built page draws the same samples a served
 * page draws, and a bare import of it in the shipped JavaScript would be a name npm cannot
 * resolve.
 *
 * THE PRICE IS THE ONE THE RULE ALREADY NAMES. A bundled package's third party dependencies
 * become this package's, because they are installed on its account: `isomorphic-dompurify`,
 * `marked`, `shiki`, `vue`, `minisearch` and the published `@openref/vue` are declared here for
 * that reason. Adding the two private packages to `dependencies` instead is the move SPEC 4
 * forbids, and it is what was there.
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
  noExternal: [/^@openref\/(static|render|search|samples)$/],
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
});

import { defineConfig } from 'tsup';

/**
 * Two builds, for two different runtimes.
 *
 * THE SERVER BUILD. `@openref/nest` is what a consumer installs, so it carries the internal
 * packages inside itself: `render`, `runner`, `search`, since T046 `federation`, and since T058
 * `agent` are private and are bundled here.
 *
 * Third party code is not bundled with them. `skipNodeModulesBundle` keeps every published
 * dependency external, and `noExternal` makes the four internal workspace packages the one
 * exception. Inlining the third party tree instead would copy Vue, the sanitizer and the
 * highlighter into this file, which duplicates them for anyone who also depends on them,
 * defeats their own conditional exports, and puts a server side `new Function` from a CSS
 * parser into an artifact that is scanned for exactly that.
 *
 * The consequence is that every third party dependency of a bundled package has to be a
 * dependency of this one. That is honest: those packages are installed because this one is.
 *
 * THE THREE INTERNAL PACKAGES ARE NAMED SINCE T031, AND THE PATTERN USED TO BE `@openref/*`.
 * That pattern also caught `@openref/core`, `@openref/theme` and `@openref/vue`, which are
 * published: a consumer installed each of them, because they are declared dependencies, and got
 * a second copy inlined here that nothing imported. It was invisible while nobody stood on the
 * boundary. T031 publishes `@openref/vue` as the package a theme is written against, and a
 * theme's components reach the page through `inject`, whose keys are `Symbol()` values with
 * module identity: with two copies of that module in one process, `provide` writes one key and
 * `inject` reads another, so `useDocState` throws and `useSlot` resolves nothing. That is the
 * eighth class of SPEC 0 arriving from the other side, and it is why the exception list is now
 * the three packages the sentence above always claimed it was.
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
/**
 * What the three browser builds inline rather than leave as a specifier.
 *
 * A BROWSER HAS NO IMPORT MAP, so a bare specifier left in one of these files does not resolve,
 * the module never evaluates, and neither does anything that imports it. `minisearch` joined the
 * list at T042 with the search wiring: `@openref/search` is inlined by the `@openref/` pattern,
 * the third party index it stands on was not, and esbuild left `import f from"minisearch"` in the
 * chunk the command palette loads. A reader pressing Ctrl-K would have got the navigation match
 * and never the index, with nothing anywhere saying so. That is the defect `sha256Hex` shipped at
 * T028 arriving a second time from a different package, and the `browser-resolution` gate caught
 * it rather than a browser, which is what that gate exists for.
 *
 * It stays a list of names rather than becoming "inline everything": the reason the server build
 * keeps third party code external is written above and still holds there.
 */
const BROWSER_NO_EXTERNAL = [/^vue$/, /^@vue\//, /^@openref\//, /^minisearch$/];

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    target: 'node20',
    // THE DECLARATION INLINES THE FOUR INTERNAL PACKAGES THE WAY THE CODE DOES, since the post
    // T064 review, and until then it did not. `noExternal` governs the JavaScript alone: the
    // declaration step kept every workspace import as a specifier, so `dist/index.d.ts` opened
    // with `import { AgentOptions } from '@openref/agent'` and named `@openref/render` and
    // `@openref/federation` beside it. All three are private, so a consumer cannot install any of
    // them, and `tsc` in a tree holding only the published tarball fails to resolve five imports.
    // The bytes were there and the types were a promise about packages that do not exist.
    //
    // INLINING RATHER THAN DECLARING THEM. Adding a private package to `dependencies` would make
    // the install fail instead of the typecheck, and moving these types into a published package
    // would publish a surface nobody asked for. `resolve` makes the declaration carry the type
    // text, which is what the bundle already does with the code.
    dts: { resolve: [/^@openref\/(render|search|federation|agent)$/] },
    sourcemap: true,
    clean: true,
    treeshake: true,
    skipNodeModulesBundle: true,
    // `federation` joined at T046: the merge and the remote lifecycle are internal, per
    // STANDARDS 3.5, and this is the package a consumer installs to get the federated mount.
    // `agent` joined at T058, for the same reason: the surface of SPEC 18.1 is internal and a
    // host reaches it through two booleans on the options of this package.
    //
    // `runner` LEFT AT T064, WHEN IT WAS PUBLISHED, and it left by the rule rather than by
    // preference. SPEC 4: a published package declared as a dependency of another published
    // package is not bundled into it, because two copies of one module in one process are two
    // different values for every mechanism built on identity, and each of them fails silently.
    // It moved from `devDependencies` to `dependencies` in the same change, which is the other
    // half of the same rule: an internal package sits in `devDependencies` precisely because it
    // is inlined, and one that is installed beside this package is a real dependency.
    //
    // The browser build below is unaffected and deliberately so: `BROWSER_NO_EXTERNAL` inlines
    // every `@openref/*` because an embed has no installer, so first paint bytes do not move.
    noExternal: [/^@openref\/(render|search|federation|agent)$/],
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
    // THE CODE SPLIT OF T011-R. Without this esbuild inlines every dynamic import back into the
    // entry, and the three deferred features would be gated at runtime while still being
    // downloaded and compiled on load, which is the cost the deferral exists to remove. The
    // chunks are served by the asset catalog under digest names like every other file, and the
    // specifiers inside the entry are rewritten to those names before the entry is hashed.
    splitting: true,
    noExternal: BROWSER_NO_EXTERNAL,
    outExtension: () => ({ js: '.js' }),
    esbuildOptions(options) {
      options.conditions = ['source'];
    },
  },
  {
    // THE WEB COMPONENT OUTPUTS OF SPEC 10.3, since T033: the same element twice, an ES module
    // and an IIFE, for host pages with and without module support. ONE FILE EACH, deliberately:
    // an embed has no asset catalog to rewrite chunk names through, so the deferred features
    // are inlined and the embed pays its whole cost once, which the compatibility table says
    // out loud rather than hiding in a chunk that 404s on a foreign page.
    entry: { 'openref-element': 'src/browser/element-entry.ts' },
    outDir: 'dist/browser-wc',
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: false,
    clean: false,
    minify: true,
    treeshake: true,
    splitting: false,
    noExternal: BROWSER_NO_EXTERNAL,
    outExtension: () => ({ js: '.js' }),
    esbuildOptions(options) {
      options.conditions = ['source'];
    },
  },
  {
    // THE SAME ELEMENT AS AN IIFE, in a directory of its own: the bundle registry models one
    // entry file plus its chunk closure per directory, and two independent twins in one root
    // would each read the other as an unreachable file.
    entry: { 'openref-element': 'src/browser/element-entry.ts' },
    outDir: 'dist/browser-iife',
    format: ['iife'],
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: false,
    clean: false,
    minify: true,
    treeshake: true,
    splitting: false,
    noExternal: BROWSER_NO_EXTERNAL,
    outExtension: () => ({ js: '.iife.js' }),
    esbuildOptions(options) {
      options.conditions = ['source'];
    },
  },
]);

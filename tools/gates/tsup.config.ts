import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/baseline-api.ts'],
  format: ['esm'],
  target: 'node20',
  // TYPES FOR THE LIBRARY ENTRY ONLY. `tools/browser-budget` imports the baseline record and
  // the SPEC 20 ceilings from here rather than keeping a second copy of either, and it is a
  // TypeScript program, so it needs declarations. The CLI entry has no consumer and needs none.
  dts: { entry: 'src/baseline-api.ts' },
  sourcemap: true,
  clean: true,
  treeshake: true,
  // THE TWO PARSERS STAY OUT OF THE BUNDLE, and `yaml` is the one that forced it. tsup inlines a
  // dev dependency by default, and inlining a CommonJS package into an ESM output leaves the
  // interop shim's `require` in the file, which throws on the first call: "Dynamic require of
  // process is not supported". These gates run from inside this repository, where both packages
  // are on disk, so there is nothing to gain by inlining them and a runtime failure to lose.
  external: ['acorn', 'yaml'],
});

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
});

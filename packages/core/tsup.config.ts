import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/security.ts'],
  format: ['esm', 'cjs'],
  target: 'node20',
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
});

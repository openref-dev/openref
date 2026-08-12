import { defineConfig } from 'vitest/config';
import { CoverageTimeoutNote } from './vitest.timeout-note.ts';

export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts', 'tools/*/vitest.config.ts'],
    // The default reporter is named because naming any reporter replaces the set, and this one
    // only ever adds a paragraph under a coverage run that timed out. See the file for F25.
    reporters: ['default', new CoverageTimeoutNote()],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**/*.ts', 'tools/*/src/**/*.ts'],
      exclude: ['**/*.d.ts'],
    },
  },
});

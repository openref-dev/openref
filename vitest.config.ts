import { defineConfig } from 'vitest/config';
import { SkipLedger } from './vitest.skip-ledger.ts';
import { CoverageTimeoutNote } from './vitest.timeout-note.ts';

export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts', 'tools/*/vitest.config.ts'],
    // The default reporter is named because naming any reporter replaces the set, and these two
    // only ever add a paragraph: one under a coverage run that timed out, see the file for F25,
    // and one under any run that skipped a case, which prints which cases rather than how many.
    reporters: ['default', new CoverageTimeoutNote(), new SkipLedger()],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**/*.ts', 'tools/*/src/**/*.ts'],
      exclude: ['**/*.d.ts'],
    },
  },
});

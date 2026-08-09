import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts', 'tools/*/vitest.config.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**/*.ts', 'tools/*/src/**/*.ts'],
      exclude: ['**/*.d.ts'],
    },
  },
});

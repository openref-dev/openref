import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

const repoRoot = dirname(fileURLToPath(import.meta.url));

/**
 * Workspace package name to directory under `packages/`.
 *
 * Tests resolve workspace packages to their TypeScript sources so that no build
 * step is required before running the suite.
 */
const WORKSPACE_PACKAGES: Record<string, string> = {
  '@openref/core': 'core',
  '@openref/vue': 'vue',
  '@openref/render': 'render',
  '@openref/runner': 'runner',
  '@openref/search': 'search',
  '@openref/nest': 'nest',
  '@openref/theme': 'theme',
  openref: 'cli',
};

/**
 * Alias map from workspace package name to its source entry point.
 */
export const workspaceAliases: Record<string, string> = Object.fromEntries(
  Object.entries(WORKSPACE_PACKAGES).map(([name, dir]) => [
    name,
    resolve(repoRoot, 'packages', dir, 'src', 'index.ts'),
  ]),
);

/**
 * Creates the Vitest project configuration shared by every workspace package.
 *
 * @param name - Project name shown in reporter output, matching the package directory
 * @returns Vitest project configuration
 */
export function createPackageProject(name: string): ReturnType<typeof defineProject> {
  return defineProject({
    resolve: { alias: workspaceAliases },
    test: {
      name,
      environment: 'node',
      include: ['test/unit/**/*.spec.ts', 'test/integration/**/*.spec.ts'],
      clearMocks: true,
      restoreMocks: true,
    },
  });
}

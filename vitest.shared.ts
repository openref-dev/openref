import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

const repoRoot = dirname(fileURLToPath(import.meta.url));

/**
 * Alias map from workspace package name to its source entry point.
 *
 * READ FROM THE DISK RATHER THAN LISTED, which is the third copy of the package list F23 was
 * about. This one fails loudly rather than silently, since a missing alias is an unresolved
 * import, so it was never the defect the other two were. It is derived anyway because three
 * hand written copies of one fact is how the two that failed quietly came to exist.
 *
 * Each package's own `name` and `source` are the mapping. Tests resolve workspace packages to
 * their TypeScript sources so that no build step is required before running the suite.
 */
export const workspaceAliases: Record<string, string> = Object.fromEntries(
  readdirSync(resolve(repoRoot, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directory = resolve(repoRoot, 'packages', entry.name);
      const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')) as {
        name: string;
        source: string;
      };

      return [manifest.name, resolve(directory, manifest.source)];
    }),
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

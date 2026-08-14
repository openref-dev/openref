import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

const repoRoot = dirname(fileURLToPath(import.meta.url));

/** A package manifest, reduced to the two places a source entry point is declared. */
interface AliasManifest {
  readonly name: string;
  readonly source: string;
  readonly exports?: Readonly<Record<string, unknown>>;
}

/**
 * Every entry point a package declares a `source` condition for, keyed by its specifier.
 *
 * @param manifest - The package manifest
 * @param directory - Absolute package directory
 * @returns Specifier to absolute source file
 */
function entryPointsOf(manifest: AliasManifest, directory: string): [string, string][] {
  const entries: [string, string][] = [[manifest.name, resolve(directory, manifest.source)]];

  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    if (subpath === '.' || typeof target !== 'object' || target === null) continue;

    const source = (target as { source?: unknown }).source;
    if (typeof source !== 'string') continue;

    entries.push([`${manifest.name}${subpath.slice(1)}`, resolve(directory, source)]);
  }

  return entries;
}

/**
 * Alias map from workspace entry point specifier to its source file.
 *
 * READ FROM THE DISK RATHER THAN LISTED, which is the third copy of the package list F23 was
 * about. This one fails loudly rather than silently, since a missing alias is an unresolved
 * import, so it was never the defect the other two were. It is derived anyway because three
 * hand written copies of one fact is how the two that failed quietly came to exist.
 *
 * Each package's own `name` and `source` are the mapping. Tests resolve workspace packages to
 * their TypeScript sources so that no build step is required before running the suite.
 *
 * IT READS `exports` AS WELL AS `source` SINCE T031, AND THE REASON IS A FAILURE MODE RATHER
 * THAN COMPLETENESS. Vite matches a string alias as a prefix, so with `@openref/vue` alone in
 * the map, `@openref/vue/runner` resolved to `packages/vue/src/index.ts/runner` and sixteen test
 * files failed with `ENOTDIR`. The keys are sorted longest first because a prefix match takes
 * the first entry that matches, and `@openref/vue` matches everything `@openref/vue/runner` does.
 */
export const workspaceAliases: Record<string, string> = Object.fromEntries(
  readdirSync(resolve(repoRoot, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const directory = resolve(repoRoot, 'packages', entry.name);
      const manifest = JSON.parse(
        readFileSync(resolve(directory, 'package.json'), 'utf8'),
      ) as AliasManifest;

      return entryPointsOf(manifest, directory);
    })
    .sort(([left], [right]) => right.length - left.length || left.localeCompare(right)),
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

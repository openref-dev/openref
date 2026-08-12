/**
 * Where a test file has to live for anything to run it.
 *
 * THE RULE IS OLD AND NOTHING ENFORCED IT. STANDARDS and `CLAUDE.md` both say every test lives
 * under `test/` at the package root and never inside `src/`, and `vitest.shared.ts` turns that
 * into two include globs, `test/unit/**` and `test/integration/**`. A `.spec.ts` one directory
 * outside them is not reported as misplaced: it is collected by nothing, so it never runs, and a
 * suite that never runs is indistinguishable from a suite that passes. Noted in session 29 with
 * no material and no home; written as a check on 2026-08-11 rather than filed again.
 *
 * IT IS A LIST OF PATHS AND A PREDICATE, deliberately, so the check can be planted on a synthetic
 * tree. A check over the real repository alone would be a check that today's repository is clean,
 * which says nothing about whether it could ever go red.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Workspace roots, as `pnpm-workspace.yaml` globs them. */
export const PROJECT_ROOTS: readonly string[] = ['packages', 'tools', 'examples', 'compat'];

/** Directories never walked: build output, installed dependencies, coverage reports. */
const SKIPPED = new Set(['node_modules', 'dist', 'coverage', '.git', '.turbo']);

/** The two directories `vitest.shared.ts` collects from, relative to a project root. */
const COLLECTED: readonly string[] = ['test/unit/', 'test/integration/'];

/**
 * Whether a path is somewhere a runner would find it.
 *
 * @param path - Repository relative path of a `.spec.ts` file, with forward slashes
 * @returns True when it sits under a project's `test/unit` or `test/integration`
 */
export function isCollected(path: string): boolean {
  const parts = path.split('/');
  // `<root>/<project>/...`, so the project's own prefix is the first two segments. A spec file
  // above that level belongs to no project and is collected by no configuration.
  if (parts.length < 4) return false;
  if (!PROJECT_ROOTS.includes(parts[0] ?? '')) return false;

  const inside = parts.slice(2).join('/');

  return COLLECTED.some((directory) => inside.startsWith(directory));
}

/**
 * Every `.spec.ts` in the workspace, wherever it is.
 *
 * @param repoRoot - Absolute repository root
 * @returns Repository relative paths, sorted
 */
export function findSpecFiles(repoRoot: string): string[] {
  const found: string[] = [];

  const visit = (directory: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(directory).sort();
    } catch {
      return;
    }

    for (const entry of entries) {
      if (SKIPPED.has(entry)) continue;

      const absolute = join(directory, entry);
      const stats = statSync(absolute, { throwIfNoEntry: false });
      if (stats === undefined) continue;

      if (stats.isDirectory()) {
        visit(absolute);
        continue;
      }

      if (entry.endsWith('.spec.ts')) {
        found.push(relative(repoRoot, absolute).replaceAll('\\', '/'));
      }
    }
  };

  for (const root of PROJECT_ROOTS) visit(join(repoRoot, root));

  return found.sort();
}

/**
 * The spec files no runner would collect.
 *
 * @param repoRoot - Absolute repository root
 * @returns Repository relative paths of the misplaced ones, sorted
 */
export function findUncollectedSpecs(repoRoot: string): string[] {
  return findSpecFiles(repoRoot).filter((path) => !isCollected(path));
}

import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Collects files under a directory tree, filtered by extension.
 *
 * Node 20 is the baseline, so no glob API is used.
 *
 * @param root - Absolute directory to walk; a missing directory yields an empty list
 * @param extensions - Lowercase extensions to keep, including the dot
 * @param repoRoot - Absolute repository root, used to build relative paths
 * @returns Repository relative file paths, sorted for deterministic output
 */
export function collectFiles(
  root: string,
  extensions: readonly string[],
  repoRoot: string,
): string[] {
  const found: string[] = [];

  const visit = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries.sort()) {
      const absolute = join(dir, entry);
      const stats = statSync(absolute, { throwIfNoEntry: false });
      if (stats === undefined) continue;

      if (stats.isDirectory()) {
        visit(absolute);
        continue;
      }

      const lower = entry.toLowerCase();
      if (extensions.some((extension) => lower.endsWith(extension))) {
        found.push(relative(repoRoot, absolute).replace(/\\/g, '/'));
      }
    }
  };

  visit(root);
  return found.sort();
}

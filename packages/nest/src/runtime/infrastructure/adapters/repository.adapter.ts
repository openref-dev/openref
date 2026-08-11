/**
 * The two things a source link needs from the build environment: where the repository is, and
 * which revision was built.
 *
 * BOTH FAIL OPEN AND NEITHER GUESSES. A documentation route that refuses to serve because `git`
 * is not on the PATH would be an absurd trade, and a `{ref}` invented from a branch name that
 * happens to exist would produce links that resolve today and break on the next push. When either
 * is unavailable the fact is emitted without it and `expandSourceLink` says why there is no link.
 *
 * `.git` IS TESTED FOR EXISTENCE, NOT FOR BEING A DIRECTORY. A git worktree and a submodule both
 * carry a `.git` FILE holding a pointer to the real directory, and both are ordinary ways to check
 * out a repository. A check for a directory would walk straight past the root of either and land
 * on whatever repository contained it, or on nothing.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Roots already found, keyed by the directory the walk started from. */
const roots = new Map<string, string | undefined>();

/** Revisions already read, keyed by repository root. */
const refs = new Map<string, string | undefined>();

/**
 * Finds the repository a path belongs to.
 *
 * @param from - An absolute path to a file or a directory inside the repository
 * @returns The absolute path of the root, or undefined when there is no `.git` above it
 */
export function findRepositoryRoot(from: string): string | undefined {
  if (from === '') return undefined;

  const start = resolve(from);
  const cached = roots.get(start);
  if (cached !== undefined || roots.has(start)) return cached;

  let directory = existsSync(start) && isDirectory(start) ? start : dirname(start);
  let found: string | undefined;

  // Bounded by the loop's own condition: `dirname` of a filesystem root is that root, so the walk
  // stops there rather than running forever.
  for (;;) {
    if (existsSync(join(directory, '.git'))) {
      found = directory;
      break;
    }

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  roots.set(start, found);
  return found;
}

/**
 * Reads the revision of the repository, for `{ref}`.
 *
 * THE FULL SHA RATHER THAN A SHORT ONE OR A BRANCH NAME. A branch moves, so a link built from one
 * points at whatever that branch holds when the reader clicks it rather than at the code the
 * reference describes, which is the whole value of the link. All three forges accept a full sha in
 * the same position a branch would go.
 *
 * @param root - The repository root
 * @returns The commit sha, or undefined when git could not answer
 */
export function resolveGitRef(root: string): string | undefined {
  const cached = refs.get(root);
  if (cached !== undefined || refs.has(root)) return cached;

  let found: string | undefined;
  try {
    const output = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      // The one call this package makes to a program it did not write, so it is bounded on every
      // axis: no shell, a fixed argument list, a timeout, and stderr discarded rather than mixed
      // into a value that ends up in a URL.
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    // A sha and nothing else. `rev-parse` in a repository with no commits prints an error to
    // stderr and exits non zero, but a wrapper on the PATH called `git` could print anything.
    if (/^[0-9a-f]{40}$/.test(output)) found = output;
  } catch {
    found = undefined;
  }

  refs.set(root, found);
  return found;
}

/**
 * Forgets what was found, so a test can measure the walk again.
 *
 * Not exported from the package: the caches exist because a hundred handlers share one repository
 * and one revision, and nothing in a running application ever needs them cleared.
 */
export function resetRepositoryCache(): void {
  roots.clear();
  refs.clear();
}

/**
 * Reports whether a path is a directory, without throwing on a path that is gone.
 *
 * @param path - An existing path
 * @returns True when it is a directory
 */
function isDirectory(path: string): boolean {
  try {
    // `existsSync` was already true, so the only interesting question left is which kind it is.
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

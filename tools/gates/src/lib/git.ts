import { runCommand } from './exec.js';

/**
 * How far the tree has moved past a commit, over the paths that matter.
 *
 * `count` is the number of commits between `commit` and `HEAD` that touch at least one of
 * `paths`. It is `null` when git cannot answer: no repository, a shallow clone that does not
 * hold the commit, or a commit the history does not contain. A null is a reason to say the
 * question could not be asked, never a zero, because a zero here reads as "the record is
 * current" and that is exactly the claim that must not be made without evidence.
 */
export interface CommitDistance {
  readonly count: number | null;
  readonly reason?: string;
}

/**
 * Counts the commits after `commit`, up to `HEAD`, that touch any of `paths`.
 *
 * @param repoRoot - Absolute repository root
 * @param commit - The commit a committed record was taken at
 * @param paths - Pathspecs that scope the count to the inputs that matter
 * @returns The count, or null with the reason git could not produce one
 */
export function countCommitsSince(
  repoRoot: string,
  commit: string,
  paths: readonly string[],
): CommitDistance {
  const result = runCommand(
    'git',
    ['rev-list', '--count', `${commit}..HEAD`, '--', ...paths],
    repoRoot,
  );

  if (!result.ok) {
    const firstLine = result.stderr.trim().split('\n')[0] ?? '';
    return {
      count: null,
      reason: firstLine.length > 0 ? firstLine : 'git exited without an error message',
    };
  }

  const parsed = Number(result.stdout.trim());

  if (!Number.isInteger(parsed) || parsed < 0) {
    return { count: null, reason: `git printed "${result.stdout.trim()}" instead of a count` };
  }

  return { count: parsed };
}

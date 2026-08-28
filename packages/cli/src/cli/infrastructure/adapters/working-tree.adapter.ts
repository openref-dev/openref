import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ErrorCode, UsageError } from '@openref/core';

const execFileAsync = promisify(execFile);

/**
 * The working tree `doctor --fix` is about to write into, read through git and nothing else.
 *
 * A DIRTY TREE IS A REFUSAL AND NOT A WARNING, per SPEC 7.4 and `ai-docs/REMEDIATION.md` section
 * 4. The whole value of a rewriter is that a person reads its output as a diff, and a diff that
 * mixes a tool's edits with somebody's uncommitted work is not reviewable at all. A warning would
 * be a refusal that a pipeline discards.
 *
 * NO REPOSITORY IS THE SAME REFUSAL FOR A SECOND REASON, and the second one is the stronger of the
 * two: findings carry a repository relative path, so with no repository there is no root to
 * resolve one against. A tool that guessed the root from the current directory would write into
 * whatever tree it happened to be started in.
 */

/** What git says about the tree the rewriter would write into. */
export interface WorkingTree {
  /** Absolute path of the repository root, which repository relative paths resolve against. */
  readonly root: string;
  /** Paths git reports as changed, in git's own order. Empty means clean. */
  readonly dirty: readonly string[];
}

/** How much `git status` output this reads before giving up, in bytes. */
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

/**
 * Reads the repository root and whether the tree is clean.
 *
 * @param cwd - Where git runs, normally the directory the CLI was started in
 * @returns The root and the dirty paths
 * @throws {UsageError} When git is missing, or `cwd` is not inside a repository
 */
export async function readWorkingTree(cwd: string): Promise<WorkingTree> {
  const root = await git(['rev-parse', '--show-toplevel'], cwd, 'find the repository root');
  const status = await git(
    ['status', '--porcelain', '--untracked-files=normal'],
    cwd,
    'read the working tree',
  );

  const dirty = status
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

  return { root: root.trim(), dirty };
}

/**
 * Runs one git command, turning any failure into the refusal a caller can print.
 *
 * @param args - Arguments, passed as an array so nothing reaches a shell
 * @param cwd - Where git runs
 * @param what - What the call was trying to learn, for the message
 * @returns What git printed on stdout
 * @throws {UsageError} When git fails or is not installed
 */
async function git(args: readonly string[], cwd: string, what: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', [...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER_BYTES,
    });
    return stdout;
  } catch (error) {
    throw new UsageError(
      `could not ${what}: ${firstLineOf(error)}`,
      ErrorCode.CLI_USAGE_INVALID,
      error instanceof Error ? error : undefined,
      { cwd },
    );
  }
}

/** The one line of a failed git run worth printing, which is git's own first line of stderr. */
function firstLineOf(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr === 'string' && stderr.trim() !== '') {
    return stderr.trim().split('\n')[0] ?? stderr.trim();
  }
  return error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : String(error);
}

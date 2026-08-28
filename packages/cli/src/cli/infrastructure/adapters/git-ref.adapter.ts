import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ErrorCode, normalizeOpenApiDocument, parseSpecification, UsageError } from '@openref/core';
import { gitObjectArgument, refusedGitArgument } from '../../domain/git-ref';
import type { LoadedDocument } from '../../domain/loaded-document.types';

const execFileAsync = promisify(execFile);

/**
 * Loads one document out of one git revision, per SPEC 17.1 as amended by T041.
 *
 * THE ARGUMENTS GO TO GIT AS AN ARRAY AND NEVER THROUGH A SHELL, so nothing in a ref or a path
 * is ever interpreted as a command. What is left is a leading `-`, which git reads as an option
 * rather than as a name, and `refusedGitArgument` refuses that before the call rather than after
 * it.
 */

/** How large a specification this reads out of git before giving up, in bytes. */
const MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/**
 * Reads one file out of one revision.
 *
 * @param ref - A revision: a branch, a tag, a sha, anything `git show` resolves
 * @param path - Path to the document, relative to `cwd`
 * @param cwd - Where git runs; defaults to the current directory
 * @returns The file's text
 * @throws {UsageError} When git refuses the argument, is not there, or cannot resolve the object
 */
export async function readGitBlob(ref: string, path: string, cwd?: string): Promise<string> {
  for (const [value, what] of [
    [ref, 'a git ref'],
    [path, 'a path inside a git ref'],
  ] as const) {
    const refusal = refusedGitArgument(value, what);
    if (refusal !== undefined) {
      throw new UsageError(refusal, ErrorCode.CLI_USAGE_INVALID, undefined, { ref, path });
    }
  }

  try {
    const { stdout } = await execFileAsync('git', ['show', gitObjectArgument(ref, path)], {
      ...(cwd === undefined ? {} : { cwd }),
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER_BYTES,
    });
    return stdout;
  } catch (error) {
    throw new UsageError(
      `could not read ${path} at git ref ${ref}: ${firstLineOf(error)}`,
      ErrorCode.CLI_USAGE_INVALID,
      error instanceof Error ? error : undefined,
      { ref, path },
    );
  }
}

/**
 * Loads a document out of a git revision, in the shape every other loader returns.
 *
 * Nothing is held open, so `close` is the same no-op the file loader's is.
 *
 * @param ref - The revision
 * @param path - Path to the document, relative to `cwd`
 * @param cwd - Where git runs
 * @throws {UsageError} When git cannot produce the file
 * @throws {NormalizeError} When what git produced does not parse or normalize as OpenAPI
 */
export async function loadGitDocument(
  ref: string,
  path: string,
  cwd?: string,
): Promise<LoadedDocument> {
  const text = await readGitBlob(ref, path, cwd);
  const parsed = parseSpecification(text, { source: `${ref}:${path}` });

  return { document: normalizeOpenApiDocument(parsed), close: () => Promise.resolve() };
}

/**
 * The one line of a failed git run worth putting in a message.
 *
 * `execFile` rejects with an error whose `message` repeats the whole command line and whose
 * `stderr` holds what git actually said. The second is the useful half, and only its first line:
 * git's hints run to five lines that say nothing a caller of this can act on.
 */
function firstLineOf(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr === 'string' && stderr.trim() !== '') {
    return stderr.trim().split('\n')[0] ?? stderr.trim();
  }
  return error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : String(error);
}

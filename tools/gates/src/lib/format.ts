/**
 * Reading the result of `pnpm format:check` out of what prettier printed.
 *
 * THE GATE RUNS THE REPOSITORY'S OWN COMMAND RATHER THAN PRETTIER DIRECTLY, and that is the
 * whole design of this file. The allowlist of paths lives in `package.json` and is already held
 * to a shape by `tools/gates/test/unit/format-allowlist.spec.ts`: an allowlist rather than an
 * ignore list, and the same list for `format` and for `format:check` so the two cannot disagree.
 * A gate that assembled its own argument list would be a third copy of that list, and a third
 * copy is how a directory comes to be formatted by one command and checked by neither.
 *
 * SO WHAT IS PARSED HERE IS OUTPUT, AND OUTPUT HAS TWO FAILURE SHAPES. Prettier exits non zero
 * both when a file is unformatted and when it cannot run at all, and those must not print the
 * same way: a checker that crashed and a repository that is clean are the same exit code apart
 * from what came out of it. A non zero exit with no file parsed out of it is reported as the
 * checker failing, never as a formatting failure and never as a pass.
 */

/** How the summary line prettier prints after the files begins. It names no file. */
const SUMMARY = 'Code style issues found';

/**
 * The files prettier reported as unformatted.
 *
 * `[warn] <path>` is the shape of a file line and `[warn] Code style issues found in the above
 * file(s)...` is the shape of the summary, so a line is kept only when what follows the marker
 * looks like one path: no whitespace, and an extension.
 *
 * @param output - Everything the command wrote to stdout and stderr
 * @returns Repository relative paths, in the order prettier printed them
 */
export function unformattedFiles(output: string): string[] {
  const files: string[] = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('[warn]')) continue;

    const rest = trimmed.slice('[warn]'.length).trim();
    if (rest.startsWith(SUMMARY)) continue;
    if (!/^\S+\.[A-Za-z0-9]+$/.test(rest)) continue;

    files.push(rest);
  }

  return files;
}

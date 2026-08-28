import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The built CLI two integration suites run as a process, and the refusal to run against a wrong one.
 *
 * WHY THIS IS NOT A `skipIf`. Both suites used to skip themselves in silence when
 * `packages/cli/dist/bin.js` was absent, so a green integration run could mean the suite ran or
 * mean it never existed, and nothing distinguished the two. Worse, absence was the only thing
 * looked at: the artifact was measured stale by seven source files at review time and both suites
 * ran happily against it, reporting on a build nobody made.
 *
 * SO ABSENCE AND STALENESS ARE BOTH FAILURES, AND EACH SAYS WHAT IS MISSING. The check is a
 * modification time comparison, which is what a build system uses for the same question.
 *
 * IT LIVES AT THE ROOT FOR THE REASON `vitest.spawn-timeout.ts` DOES: two packages need it, and a
 * copy in each is the thing that drifts. `packages/action` and `packages/cli` both import it by
 * relative path.
 *
 * WHAT IS COMPARED IS NAMED, AND SO IS WHAT IS NOT. `bin.js` is bundled from the CLI's own sources
 * plus `@openref/static`, which `packages/cli/tsup.config.ts` lists in `noExternal`; the rest of
 * the workspace stays external and is loaded from its own `dist` at run time. So those two source
 * trees and the two files that configure the bundle are the inputs compared here. A stale
 * `@openref/core` build is a different artifact's staleness and is not this check's subject.
 */

/** Where the workspace root is, from this file. */
const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));

/** The artifact under test: the executable entry point a spawned process starts. */
export const BUILT_CLI_BIN = join(REPO_ROOT, 'packages', 'cli', 'dist', 'bin.js');

/** Everything the bundle is built from, relative to the workspace root. */
const SOURCE_INPUTS: readonly string[] = [
  'packages/cli/src',
  'packages/cli/tsup.config.ts',
  'packages/cli/package.json',
  'packages/static/src',
];

/** The newest modification time under one file or directory, in milliseconds. */
function newestMtimeMs(path: string): { readonly path: string; readonly mtimeMs: number } {
  const stats = statSync(path);
  if (!stats.isDirectory()) return { path, mtimeMs: stats.mtimeMs };

  let newest = { path, mtimeMs: stats.mtimeMs };
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = newestMtimeMs(join(path, entry.name));
    if (child.mtimeMs > newest.mtimeMs) newest = child;
  }
  return newest;
}

/**
 * Why a suite that spawns the built CLI must not run, or undefined when it is there and current.
 *
 * @returns The message naming what is missing or stale, or undefined
 */
export function builtCliProblem(): string | undefined {
  if (!existsSync(BUILT_CLI_BIN)) {
    return (
      'packages/cli/dist/bin.js is not there, and it is the binary this suite spawns. ' +
      'Run `pnpm build` (or `pnpm --filter openref build`) first. This suite refuses to skip ' +
      'itself, because a skipped run and a passing run look identical from the outside'
    );
  }

  const builtMs = statSync(BUILT_CLI_BIN).mtimeMs;
  let newest: { path: string; mtimeMs: number } | undefined;

  for (const input of SOURCE_INPUTS) {
    const path = join(REPO_ROOT, input);
    if (!existsSync(path)) continue;
    const candidate = newestMtimeMs(path);
    if (newest === undefined || candidate.mtimeMs > newest.mtimeMs) newest = candidate;
  }

  if (newest !== undefined && newest.mtimeMs > builtMs) {
    const ageSeconds = Math.round((newest.mtimeMs - builtMs) / 1000);
    return (
      `packages/cli/dist/bin.js is stale: ${newest.path.slice(REPO_ROOT.length + 1)} is ` +
      `${String(ageSeconds)}s newer than it. Run \`pnpm build\` before this suite. Running ` +
      'against a stale bundle reports on a build nobody made, which is what a green run would ' +
      'then be hiding'
    );
  }

  return undefined;
}

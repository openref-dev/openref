import { readFile, stat } from 'node:fs/promises';

/**
 * Reading a path this tool was handed, with the entry asked about before it is opened.
 *
 * A NAMED PIPE HANGS THE COMMAND FOREVER, MEASURED AT `T065` RATHER THAN REASONED ABOUT.
 * `readFile` on a FIFO blocks until a writer appears, so `openref lint pipe.yaml`,
 * `openref build --spec pipe.yaml` and `openref diff pipe.yaml pipe.yaml` each sat with nothing on
 * stdout and nothing on stderr until they were killed. `T062` closed the same hole in
 * `@openref/nuxt`, where it hung a whole Nuxt build, and filed this half rather than fixing it
 * because a terminal has somebody watching. That is a reason to schedule the fix and not to skip
 * it, which is what `T043` already ruled on the write side: a build that hangs in silence is worse
 * than one that fails.
 *
 * ONE PLACE, BECAUSE THE RULE IS ONE RULE. Every path this package opens because somebody outside
 * named it goes through here. The twin in `@openref/nuxt` stays its own copy for a reason worth
 * stating: the natural home for a rule shared by two packages is `@openref/core`, and `core` is in
 * the browser bundle, so it may not carry a `node:fs` call at all. The two copies are therefore a
 * consequence of where the rule can live rather than of nobody looking, and they are held to the
 * same words by `packages/cli/test/unit/regular-file.spec.ts`.
 *
 * `stat` AND NOT `lstat`, DELIBERATELY, for the reason the Nuxt half already gives: a symbolic link
 * to a real document is an ordinary thing to have in a repository, and what decides whether the
 * read returns is what the link leads to.
 */

/** What an entry is, in the words a refusal should use. */
function describeEntry(entry: {
  isDirectory(): boolean;
  isFIFO(): boolean;
  isSocket(): boolean;
  isBlockDevice(): boolean;
  isCharacterDevice(): boolean;
}): string {
  if (entry.isDirectory()) return 'a directory';
  if (entry.isFIFO()) return 'a named pipe';
  if (entry.isSocket()) return 'a socket';
  if (entry.isBlockDevice() || entry.isCharacterDevice()) return 'a device node';
  return 'not a regular file';
}

/**
 * Why a path may not be read, or `undefined` when it may.
 *
 * MISSING IS NOT THIS CHECK'S ANSWER, per the same rule the Nuxt half states: the read below
 * reports an absent path with the system's own reason, and reporting it twice in two vocabularies
 * is how one failure becomes two messages that disagree.
 *
 * @param path - Path as it will be opened
 * @returns A sentence naming the path and what the entry is, or `undefined`
 */
export async function refusedNonRegularFile(path: string): Promise<string | undefined> {
  const entry = await stat(path).catch(() => null);
  if (entry === null || entry.isFile()) return undefined;

  return `${path} is ${describeEntry(entry)} rather than a regular file, and it is refused rather than opened: opening one either blocks the command forever or returns something no parser can use`;
}

/**
 * Reads a file this tool was handed, refusing anything that is not a regular file.
 *
 * @param path - Path to read
 * @param refuse - Turns the refusal sentence into the error this caller throws
 * @returns The file's text
 */
export async function readHandedFile(
  path: string,
  refuse: (reason: string) => Error,
): Promise<string> {
  const refusal = await refusedNonRegularFile(path);
  if (refusal !== undefined) throw refuse(refusal);
  return await readFile(path, 'utf8');
}

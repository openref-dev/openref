/**
 * The one document, read once and normalized the one way.
 *
 * TEXT IS WHAT CROSSES EVERY BOUNDARY HERE, and that is the decision. The module reads the file
 * at build time, embeds the text it read into the server build, and normalizes it on both sides
 * with the same call. An `IRDocument` could not cross: it holds two `Map`s, which no JSON round
 * trip returns, and a shape invented to carry them would be a second normalizer nobody asked
 * for. Normalization is deterministic, so the hash the generated site was built under and the
 * hash the served mount answers with are the same hash, which is the property the cache and the
 * navigation address are keyed on.
 *
 * FAIL CLOSED, per the normalizer policy of STANDARDS 8: a document that cannot be normalized
 * stops the Nuxt build, where the person who can fix it is watching.
 */

import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import {
  ErrorCode,
  InvalidOptionsError,
  normalizeSpecification,
  parseSpecification,
  type IRDocument,
} from '@openref/core';

/** One specification, as the module carries it from the build to the server. */
export interface LoadedSpecification {
  /** Absolute path the text was read from. */
  readonly path: string;
  /** The file, verbatim. */
  readonly text: string;
}

/**
 * Reads the specification file named in `nuxt.config`.
 *
 * @param spec - Path as the host wrote it, relative to the project root or absolute
 * @param projectRoot - The Nuxt project root
 * @returns The path and the text
 * @throws {InvalidOptionsError} When the file cannot be read
 */
export async function loadSpecification(
  spec: string,
  projectRoot: string,
): Promise<LoadedSpecification> {
  const path = isAbsolute(spec) ? spec : resolve(projectRoot, spec);

  await refuseNonFile(spec, path);

  try {
    return { path, text: await readFile(path, 'utf8') };
  } catch (cause) {
    throw new InvalidOptionsError(
      `openref: the specification "${spec}" could not be read from ${path}`,
      ErrorCode.CONFIG_INVALID_OPTIONS,
      cause instanceof Error ? cause : undefined,
      { spec, path },
    );
  }
}

/**
 * Refuses a specification path that is not a regular file, before anything opens it.
 *
 * A NAMED PIPE HANGS THE BUILD FOREVER, MEASURED BY `T062` RATHER THAN REASONED ABOUT. `readFile`
 * on a FIFO blocks until a writer appears, so `nuxt build` sat in the module's own hook with no
 * output at all and no way to tell it from a slow install. It is the same class `T043` closed on
 * the write side, where a pipe planted at a page path blocked the static build to death, and the
 * answer is the one that file already gives: ask what the entry is before opening it, and refuse
 * by name. A build that hangs in silence is worse than one that fails.
 *
 * `stat` AND NOT `lstat`, DELIBERATELY: a symbolic link to a real document is an ordinary thing for
 * a host to write in a repository, and following it is what the host asked for. What is refused is
 * what the link leads to, which is the question that decides whether the read returns.
 *
 * @param spec - The path as the host wrote it, for the message
 * @param path - The resolved absolute path
 * @throws {InvalidOptionsError} When the path is not a regular file
 */
async function refuseNonFile(spec: string, path: string): Promise<void> {
  const entry = await stat(path).catch(() => null);

  // MISSING IS NOT THIS CHECK'S ANSWER. `readFile` below already reports an absent path with the
  // system's own reason, and reporting it twice in two vocabularies is how one failure becomes two
  // messages that disagree.
  if (entry === null || entry.isFile()) return;

  throw new InvalidOptionsError(
    `openref: the specification "${spec}" at ${path} is ${describeEntry(entry)} rather than a regular file, and the module refuses to read it: opening one either blocks the whole build forever or returns something no document parser can use`,
    ErrorCode.CONFIG_INVALID_OPTIONS,
    undefined,
    { spec, path },
  );
}

/**
 * What an entry is, in the words a refusal should use.
 *
 * @param entry - The result of `stat`
 * @returns A noun phrase naming the kind
 */
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
 * Normalizes specification text, the same way on both sides of the build.
 *
 * @param text - The file, verbatim
 * @param source - What to name in a parse failure
 * @returns The normalized document
 * @throws {NormalizeError} When the document cannot be read
 */
export function documentOf(text: string, source: string): IRDocument {
  return normalizeSpecification(parseSpecification(text, { source }));
}

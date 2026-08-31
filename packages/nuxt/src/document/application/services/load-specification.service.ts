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

import { readFile } from 'node:fs/promises';
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

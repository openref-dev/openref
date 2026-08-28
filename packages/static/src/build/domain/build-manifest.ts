/**
 * What the last build left behind, so the next one knows what it may keep.
 *
 * A MANIFEST RATHER THAN A DIRECTORY LISTING. What is on disk says which files exist and
 * nothing about why: it cannot tell a page this build wrote from a file the deployer dropped in
 * beside it, and it carries no key to compare a page against. So the build writes what it did,
 * and the next build reads it. A missing or unreadable manifest means a full build, which is
 * the only safe reading of "nothing is known about this directory".
 *
 * IT IS VERSIONED FOR THE REASON `SEARCH_INDEX_VERSION` AND `DOCTOR_REPORT_VERSION` ARE: a
 * consumer that does not recognise the shape has to refuse it rather than read it as an empty
 * one, because an empty manifest and an unreadable manifest lead to opposite behaviour, keeping
 * nothing versus keeping everything.
 */

import { canonicalize, type IRDocument } from '@openref/core';
import { PAGE_KEY_VERSION } from './page-key';

/** Version of the manifest shape. */
export const BUILD_MANIFEST_VERSION = 1;

/** One page as the last build left it. */
export interface ManifestPage {
  /** File, relative to the output directory, with forward slashes. */
  readonly file: string;
  /** The key that decided whether it had to be rendered. */
  readonly key: string;
}

/** What a build wrote. */
export interface BuildManifest {
  readonly version: number;
  /** `PAGE_KEY_VERSION` at the time, so a change to what a key covers forces a full build. */
  readonly pageKeyVersion: number;
  /** Hash of the document that build was about. */
  readonly documentHash: string;
  /** Base path the pages were built for; a different one is a different set of links. */
  readonly basePath: string;
  /** Absolute base, when there was one; it decides whether the head carries a canonical link. */
  readonly siteUrl: string | null;
  readonly pages: readonly ManifestPage[];
  /** Every other file the build wrote: assets, the index, the navigation, the site files. */
  readonly files: readonly string[];
}

/** Name of the manifest inside the output directory. */
export const BUILD_MANIFEST_FILE = '.openref-build-manifest.json';

/**
 * Serializes a manifest.
 *
 * `canonicalize` HERE AND NOT `JSON.stringify`, because this file is part of the deterministic
 * output SPEC 16.3 asks for, and because nothing reads it for authored order: it is a record,
 * not a payload.
 *
 * @param manifest - What the build wrote
 * @returns The file contents
 */
export function serializeManifest(manifest: BuildManifest): string {
  return canonicalize(manifest);
}

/**
 * Reads a manifest, refusing anything that is not one of this version.
 *
 * @param text - The file contents
 * @returns The manifest, or null when it cannot be trusted
 */
export function readManifest(text: string): BuildManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;

  if (candidate.version !== BUILD_MANIFEST_VERSION) return null;
  if (candidate.pageKeyVersion !== PAGE_KEY_VERSION) return null;
  if (typeof candidate.documentHash !== 'string') return null;
  if (typeof candidate.basePath !== 'string') return null;
  if (candidate.siteUrl !== null && typeof candidate.siteUrl !== 'string') return null;
  if (!Array.isArray(candidate.pages) || !Array.isArray(candidate.files)) return null;

  const pages: ManifestPage[] = [];
  for (const entry of candidate.pages) {
    if (typeof entry !== 'object' || entry === null) return null;
    const page = entry as Record<string, unknown>;
    if (typeof page.file !== 'string' || typeof page.key !== 'string') return null;
    pages.push({ file: page.file, key: page.key });
  }

  const files: string[] = [];
  for (const entry of candidate.files) {
    if (typeof entry !== 'string') return null;
    files.push(entry);
  }

  return {
    version: BUILD_MANIFEST_VERSION,
    pageKeyVersion: PAGE_KEY_VERSION,
    documentHash: candidate.documentHash,
    basePath: candidate.basePath,
    siteUrl: candidate.siteUrl,
    pages,
    files,
  };
}

/**
 * Whether a previous build's pages may be reused at all.
 *
 * The base decides every link on every page, so a build for a different base has nothing to
 * carry forward even where a node did not move.
 *
 * @param previous - The previous manifest, or null
 * @param document - The document this build is about
 * @param basePath - Base path of this build
 * @param siteUrl - Absolute base of this build, or null
 * @returns True when this build may re-address the previous build's pages
 */
export function manifestApplies(
  previous: BuildManifest | null,
  document: IRDocument,
  basePath: string,
  siteUrl: string | null,
): previous is BuildManifest {
  if (previous === null) return false;
  if (previous.basePath !== basePath) return false;
  if (previous.siteUrl !== siteUrl) return false;

  // A DOCUMENT WHOSE HASH DID NOT MOVE STILL GOES THROUGH THE KEYS RATHER THAN SHORT
  // CIRCUITING, because a page's bytes also depend on the renderer, and the caller decides what
  // a key covers. This function answers whether the previous pages are comparable at all.
  return typeof document.hash === 'string';
}

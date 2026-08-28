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

import { canonicalize, IR_VERSION, type IRDocument } from '@openref/core';
import { PAGE_MODEL_VERSION, RENDER_VERSION } from '@openref/render';
import { PAGE_KEY_VERSION } from './page-key';

/**
 * Version of the manifest shape.
 *
 * 2 SINCE `T040`: the manifest carries `rendererVersion` and `directTarget`, and the reason for
 * the first is a hole T040 was the first to arm. A page key covers the node and the frame,
 * which is everything the DOCUMENT contributes to a page's bytes, and nothing the RENDERER
 * contributes: the first bump of `PAGE_MODEL_VERSION` after T039 would have carried every page
 * forward with the old version literal in its state block, stale markup under a client that
 * expects the new shape. So the manifest now records the renderer triple the render cache key
 * already uses, and a build under a different one renders everything.
 */
export const BUILD_MANIFEST_VERSION = 2;

/**
 * The renderer identity a manifest's pages were rendered by.
 *
 * The same triple `renderCacheKey` uses, for the same reason: these three versions are, by
 * their own contracts, the complete statement of "the same inputs produce the same bytes".
 */
export const RENDERER_VERSION = `${String(IR_VERSION)}.${String(PAGE_MODEL_VERSION)}.${String(RENDER_VERSION)}`;

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
  /** `RENDERER_VERSION` at the time, so a renderer upgrade forces a full build. */
  readonly rendererVersion: string;
  /** Hash of the document that build was about. */
  readonly documentHash: string;
  /** Base path the pages were built for; a different one is a different set of links. */
  readonly basePath: string;
  /** Absolute base, when there was one; it decides whether the head carries a canonical link. */
  readonly siteUrl: string | null;
  /**
   * The direct mode warning the pages carry, per SPEC 16.2, or null.
   *
   * In the manifest because it is in the bytes: a build for a no rewrite target and a build
   * for none render different pages from one document, exactly as two base paths do.
   */
  readonly directTarget: string | null;
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
  if (typeof candidate.rendererVersion !== 'string') return null;
  if (typeof candidate.documentHash !== 'string') return null;
  if (typeof candidate.basePath !== 'string') return null;
  if (candidate.siteUrl !== null && typeof candidate.siteUrl !== 'string') return null;
  if (candidate.directTarget !== null && typeof candidate.directTarget !== 'string') return null;
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
    rendererVersion: candidate.rendererVersion,
    documentHash: candidate.documentHash,
    basePath: candidate.basePath,
    siteUrl: candidate.siteUrl,
    directTarget: candidate.directTarget,
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
 * @param directTarget - The direct mode warning of this build, or null
 * @returns True when this build may re-address the previous build's pages
 */
export function manifestApplies(
  previous: BuildManifest | null,
  document: IRDocument,
  basePath: string,
  siteUrl: string | null,
  directTarget: string | null = null,
): previous is BuildManifest {
  if (previous === null) return false;
  if (previous.basePath !== basePath) return false;
  if (previous.siteUrl !== siteUrl) return false;
  // THE RENDERER AND THE WARNING ARE IN THE BYTES AND NOT IN THE KEYS, since T040: a page key
  // covers what the document contributes, so the build wide inputs are compared here, exactly
  // as the base is.
  if (previous.rendererVersion !== RENDERER_VERSION) return false;
  if (previous.directTarget !== directTarget) return false;

  // A DOCUMENT WHOSE HASH DID NOT MOVE STILL GOES THROUGH THE KEYS RATHER THAN SHORT
  // CIRCUITING, because a page's bytes also depend on the renderer, and the caller decides what
  // a key covers. This function answers whether the previous pages are comparable at all.
  return typeof document.hash === 'string';
}

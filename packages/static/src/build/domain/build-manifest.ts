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
import { PAGE_MODEL_VERSION, RENDER_VERSION, type StaticProxyModel } from '@openref/render';
import { PAGE_KEY_VERSION } from './page-key';

/**
 * Version of the manifest shape.
 *
 * 3 SINCE `T042`: the manifest carries `staticProxy`, the prefix and pinned upstreams of the
 * generated rewrite rules, for the reason `directTarget` is here. It is in the page bytes, so two
 * builds of one document under two targets are two sets of pages, and a rebuild that changed the
 * target must not carry the previous target's addresses forward. It is a version rather than an
 * optional field because a manifest written before it says nothing about the proxy, and reading
 * that silence as "no rules" is the one wrong answer: the pages on disk may carry rules this
 * build did not write.
 *
 * 2 SINCE `T040`: the manifest carries `rendererVersion` and `directTarget`, and the reason for
 * the first is a hole T040 was the first to arm. A page key covers the node and the frame,
 * which is everything the DOCUMENT contributes to a page's bytes, and nothing the RENDERER
 * contributes: the first bump of `PAGE_MODEL_VERSION` after T039 would have carried every page
 * forward with the old version literal in its state block, stale markup under a client that
 * expects the new shape. So the manifest now records the renderer triple the render cache key
 * already uses, and a build under a different one renders everything.
 */
export const BUILD_MANIFEST_VERSION = 4;

/**
 * 4 SINCE `T043`: every page records the digest of the bytes that build actually wrote.
 *
 * A MANIFEST RECORDED INTENT AND WAS READ AS FACT. It is written last, so a build killed part way
 * leaves a directory whose contents belong to no manifest at all, and the next build compared
 * keys, found them equal, and carried whatever bytes were sitting at the path. Measured on this
 * workstation: a complete build of one document, an interrupted build of a second, then the first
 * document again reported `rendered 0, carried 13`, exit 0, with the second document's text still
 * on the page. The digest is what turns the manifest's claim into one this build can check, and a
 * page whose bytes disagree is rendered rather than carried.
 */

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
  /** `sha256` of the bytes that build wrote to {@link ManifestPage.file}. */
  readonly bytes: string;
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
  /**
   * The generated proxy rules the pages address, per SPEC 16.2, or null when there are none.
   *
   * In the manifest for the reason `directTarget` is: it is in the bytes. A page carries the
   * prefix and the pinned order in its state block, so a rebuild whose document pinned a
   * different set of upstreams, or whose target stopped writing rules at all, has nothing to
   * carry forward even where no node moved.
   */
  readonly staticProxy: StaticProxyModel | null;
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
  const staticProxy = readStaticProxy(candidate.staticProxy);
  if (staticProxy === undefined) return null;
  if (!Array.isArray(candidate.pages) || !Array.isArray(candidate.files)) return null;

  const pages: ManifestPage[] = [];
  for (const entry of candidate.pages) {
    if (typeof entry !== 'object' || entry === null) return null;
    const page = entry as Record<string, unknown>;
    if (typeof page.file !== 'string' || typeof page.key !== 'string') return null;
    if (typeof page.bytes !== 'string') return null;
    pages.push({ file: page.file, key: page.key, bytes: page.bytes });
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
    staticProxy,
    pages,
    files,
  };
}

/**
 * Reads the recorded proxy, distinguishing "none" from "not a manifest".
 *
 * THREE ANSWERS RATHER THAN TWO, and the third is why this is a function. `null` is a build that
 * wrote no rules, a record is a build that did, and `undefined` is a value that is neither, which
 * has to reject the whole manifest the way every other malformed field does. Returning `null` for
 * a broken record would read as "no rules" and carry pages that address some.
 *
 * @param value - What the file had under `staticProxy`
 * @returns The record, null for none, or undefined when the manifest cannot be trusted
 */
function readStaticProxy(value: unknown): StaticProxyModel | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'object') return undefined;

  const record = value as Record<string, unknown>;
  if (typeof record.prefix !== 'string') return undefined;
  if (!Array.isArray(record.upstreams)) return undefined;

  const upstreams: string[] = [];
  for (const entry of record.upstreams) {
    if (typeof entry !== 'string') return undefined;
    upstreams.push(entry);
  }

  return { prefix: record.prefix, upstreams };
}

/**
 * Whether two recorded proxies are the same set of rules at the same address.
 *
 * ORDER IS PART OF THE COMPARISON, because order is the rule index: the same two upstreams in the
 * other order are `u0` and `u1` swapped, and every page addresses them by number.
 *
 * @param left - One build's rules, or null
 * @param right - The other build's rules, or null
 * @returns True when the pages of one may be the pages of the other
 */
function sameStaticProxy(left: StaticProxyModel | null, right: StaticProxyModel | null): boolean {
  if (left === null || right === null) return left === right;
  if (left.prefix !== right.prefix) return false;
  if (left.upstreams.length !== right.upstreams.length) return false;

  return left.upstreams.every((upstream, index) => upstream === right.upstreams[index]);
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
 * @param staticProxy - The generated rules of this build, or null
 * @returns True when this build may re-address the previous build's pages
 */
export function manifestApplies(
  previous: BuildManifest | null,
  document: IRDocument,
  basePath: string,
  siteUrl: string | null,
  directTarget: string | null = null,
  staticProxy: StaticProxyModel | null = null,
): previous is BuildManifest {
  if (previous === null) return false;
  if (previous.basePath !== basePath) return false;
  if (previous.siteUrl !== siteUrl) return false;
  // THE RENDERER, THE WARNING AND THE RULES ARE IN THE BYTES AND NOT IN THE KEYS, since T040 and
  // T042: a page key covers what the document contributes, so the build wide inputs are compared
  // here, exactly as the base is.
  if (previous.rendererVersion !== RENDERER_VERSION) return false;
  if (previous.directTarget !== directTarget) return false;
  if (!sameStaticProxy(previous.staticProxy, staticProxy)) return false;

  // A DOCUMENT WHOSE HASH DID NOT MOVE STILL GOES THROUGH THE KEYS RATHER THAN SHORT
  // CIRCUITING, because a page's bytes also depend on the renderer, and the caller decides what
  // a key covers. This function answers whether the previous pages are comparable at all.
  return typeof document.hash === 'string';
}

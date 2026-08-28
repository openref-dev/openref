/**
 * Every page the build writes, and the file each one lands in.
 *
 * ONE DIRECTORY WITH AN `index.html` PER PAGE, per SPEC 16.1 as amended by T039. The addresses
 * come from `links.ts` in `@openref/render`, the same function the served mode and the
 * navigation use, so a link and a file cannot disagree; this module only decides which file
 * answers at an address, and the answer is always `<address>/index.html`.
 *
 * THE SET OF PAGES IS `renderAllPages`'s SET, WITH ONE ADDITION AND ITS REASON. That walk
 * renders the overview, health, states, every node with a bench per operation, and every schema
 * with its shapes page, which is every address a link on a built page can point at. The
 * addition is nothing: the two showcase addresses `renderAllPages` calls T039's question are
 * already in it since `TX-PARITY-UI` wired a tab to states and a bar link to shapes, so the
 * question is answered by the links rather than by a preference here. A build that held a page
 * nothing links to would be pages nobody reaches; a build that dropped one a tab links to would
 * be the broken link the schema pages exist to prevent.
 */

import {
  caseFoldForFilesystem,
  ErrorCode,
  InvalidOptionsError,
  type IRDocument,
  type IRNode,
} from '@openref/core';
import {
  benchHref,
  healthPageHref,
  nodeHref,
  overviewHref,
  pathSegmentOf,
  schemaHref,
  SEARCH_INDEX_SEGMENT,
  shapesHref,
  statesHref,
  type PageKind,
} from '@openref/render';
import { frameHashOf, pageKeyOf } from './page-key';

/** One page of the build. */
export interface PlannedPage {
  /** Which page, as `renderPage` takes it. */
  readonly kind: PageKind;
  /** Node the page is about, or null. */
  readonly nodeId: string | null;
  /** Schema the page is about, or null. */
  readonly schemaId: string | null;
  /**
   * Address the page answers at, with the base path in it: what a link carries.
   *
   * Built by `links.ts`, so it is URL encoded, and the file path below is derived from the
   * same `pathSegmentOf` call rather than by decoding this.
   */
  readonly href: string;
  /** File the page is written to, relative to the output directory, with forward slashes. */
  readonly file: string;
  /** Key deciding whether this page has to be rendered again. */
  readonly key: string;
}

/** Where the whole navigation payload is written, matching `navigationHref`. */
export function navigationFileOf(documentHash: string): string {
  return `_navigation/${pathSegmentOf(documentHash)}`;
}

/**
 * Where the serialized search index is written.
 *
 * THE SERVED SEGMENT ITSELF SINCE `T042`, not a copy of it that matches today. A built site and a
 * served mount answer the same address, per SPEC 13.3 and SPEC 16, and the page fetching it builds
 * that address with `searchIndexHref` out of this same constant. Two spellings that agree by
 * inspection is what this file already refuses for every page address, and the failure here is
 * quieter than a broken page: a palette that fetches a 404 falls open to the navigation rows, so
 * the reference still works and the full text search is simply gone.
 */
export const SEARCH_INDEX_FILE: string = SEARCH_INDEX_SEGMENT;

/** Directory holding every hashed asset, matching `ASSET_SEGMENT` on the served side. */
export const ASSET_DIRECTORY = '_assets';

/**
 * Longest one path component may be, in UTF-8 bytes.
 *
 * 255 IS THE COMPONENT LIMIT OF EVERY FILESYSTEM THIS RUNS ON: ext4, APFS and NTFS all stop
 * there. `T043` measured a 300 character schema name aborting the build with a raw `ENAMETOOLONG`
 * from `mkdir`, five pages already on disk and no manifest to say what had been written.
 *
 * THE LIMIT IS ENFORCED HERE AND NOT IN `pathSegmentOf`, and that placement is the decision. A
 * shortening in `links.ts` would have to be injective, so it would need a digest, and `links.ts`
 * is in the client bundle: importing a hash there put 610 bytes of `@noble/hashes` over the
 * `client-js-raw` budget, measured. The limit is a fact about a disk, this module is the one that
 * puts pages on a disk, and a build refusing a name it cannot write is the same fail closed
 * answer the fold check below gives.
 */
export const MAX_SEGMENT_BYTES = 255;

/** The file one page address lands in. */
function fileOf(segments: readonly string[]): string {
  return [...segments, 'index.html'].join('/');
}

/**
 * Plans every page of one document.
 *
 * @param document - The normalized document
 * @param basePath - Where the built site is served from, without a trailing slash
 * @returns The pages, in a fixed order: overview, health, states, nodes, then schemas
 */
export function planPages(document: IRDocument, basePath: string): readonly PlannedPage[] {
  const frameHash = frameHashOf(document);
  const pages: PlannedPage[] = [];

  const add = (
    kind: PageKind,
    href: string,
    segments: readonly string[],
    node: IRNode | null,
    nodeId: string | null,
    schemaId: string | null,
    extra = '',
  ): void => {
    pages.push({
      kind,
      nodeId,
      schemaId,
      href,
      file: fileOf(segments),
      key: pageKeyOf(frameHash, kind, node, extra),
    });
  };

  add('overview', overviewHref(basePath), [], null, null, null);
  add('health', healthPageHref(basePath), ['health'], null, null, null);
  add('states', statesHref(basePath), ['states'], null, null, null);

  for (const [nodeId, node] of document.nodes) {
    const segment = pathSegmentOf(nodeId);
    add('node', nodeHref(nodeId, basePath), [segment], node, nodeId, null);

    if (node.kind === 'operation') {
      add('bench', benchHref(nodeId, basePath), ['bench', segment], node, nodeId, null);
    }
  }

  for (const schemaId of document.schemas.keys()) {
    const segment = pathSegmentOf(schemaId);
    add(
      'schema',
      schemaHref(schemaId, basePath),
      ['schema', segment],
      null,
      null,
      schemaId,
      schemaId,
    );
    add(
      'shapes',
      shapesHref(schemaId, basePath),
      ['shapes', segment],
      null,
      null,
      schemaId,
      schemaId,
    );
  }

  refuseColliding(pages);

  return pages;
}

/** Length of one string in UTF-8 bytes, which is what a filesystem component counts. */
function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * How a filesystem that does not distinguish two names sees one file path.
 *
 * CASE AND UNICODE NORMALIZATION, BECAUSE THOSE ARE THE TWO A REAL TARGET FOLDS. APFS on macOS
 * and NTFS on Windows both answer one entry for `User` and `user` by default, and both fold
 * composed and decomposed spellings of the same letter together; the normalizer already refuses
 * a document whose schema ids collide under NFC, so what reaches here can still collide under
 * case, and `T043` measured what happens then.
 *
 * THE FOLD ITSELF LIVES IN `@openref/core`, and that is the point of it: the asset catalog asks
 * the same question about served names and answered it with its own spelling, which was wrong in
 * the same way. Two spellings of one rule come to disagree; one function cannot. What the fold is
 * and why its error direction was chosen are in `case-fold.ts` and in SPEC 16.1.
 */
function foldedFile(file: string): string {
  return caseFoldForFilesystem(file);
}

/**
 * Refuses a plan whose pages would be one file on a filesystem that folds names.
 *
 * FAIL CLOSED, AND FOR THE REASON THE NORMALIZER GIVES FOR THE SAME COLLISION ONE LAYER UP: one
 * of the two would be lost. `T043` measured both halves of the loss on this workstation. A build
 * of two schemas named `User` and `user` reported eleven pages and wrote ten, and the page the
 * link to `User` reached held `user`'s contents; then a later build that dropped one of the two
 * removed the survivor, because the stale file it deleted by name was the file it had just
 * written, and reported success with a dead link in the navigation and in the sitemap.
 *
 * A SEGMENT COULD HAVE BEEN MADE FOLD SAFE INSTEAD, by escaping every capital, and that was
 * refused: it would change the address of every page of every document to buy an answer for a
 * document nobody has, and SPEC 16.1 fixes the segment as the identity for an ordinary id.
 *
 * @param pages - The planned pages
 * @throws {InvalidOptionsError} When two pages fold to one file
 */
function refuseColliding(pages: readonly PlannedPage[]): void {
  const byFolded = new Map<string, PlannedPage>();

  for (const page of pages) {
    for (const segment of page.file.split('/')) {
      if (utf8Length(segment) <= MAX_SEGMENT_BYTES) continue;

      throw new InvalidOptionsError(
        `the page "${page.file}" has a path component of ${String(utf8Length(segment))} bytes, ` +
          `above the ${String(MAX_SEGMENT_BYTES)} byte limit every filesystem this runs on ` +
          'imposes, so it cannot be written. Shorten the id in the document',
        ErrorCode.CONFIG_INVALID_OPTIONS,
        undefined,
        { file: page.file },
      );
    }

    const folded = foldedFile(page.file);
    const first = byFolded.get(folded);

    if (first !== undefined) {
      throw new InvalidOptionsError(
        `"${first.file}" and "${page.file}" are different pages that a filesystem folding case ` +
          'or unicode normalization stores as one file, so one of the two would be lost. Rename ' +
          'one of the two ids in the document',
        ErrorCode.CONFIG_INVALID_OPTIONS,
        undefined,
        { first: first.file, second: page.file },
      );
    }

    byFolded.set(folded, page);
  }
}

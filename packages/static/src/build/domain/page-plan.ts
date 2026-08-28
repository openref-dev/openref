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

import type { IRDocument, IRNode } from '@openref/core';
import {
  benchHref,
  healthPageHref,
  nodeHref,
  overviewHref,
  pathSegmentOf,
  schemaHref,
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

/** Where the serialized search index is written, matching the served segment. */
export const SEARCH_INDEX_FILE = '_search-index';

/** Directory holding every hashed asset, matching `ASSET_SEGMENT` on the served side. */
export const ASSET_DIRECTORY = '_assets';

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

  return pages;
}

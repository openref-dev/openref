/**
 * The pipeline of SPEC 12: IR hash to render to cache to response.
 *
 * The unit of caching is one page, keyed by the document hash and the node, because that
 * is the unit of work: a document with a thousand nodes is not rendered a thousand times
 * to answer one request, and re-rendering the same node for a second visitor is the exact
 * waste the cache exists to remove.
 *
 * The key also carries the versions of everything that can change the bytes without the
 * document changing. A cache that outlives a deployment and answers with markup the
 * current code would not produce is worse than no cache: nothing about it looks wrong.
 */

import { canonicalize, IR_VERSION, type IRDocument } from '@openref/core';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import type {
  IRenderCache,
  RenderedPage,
} from '../../../cache/application/ports/render-cache.port';
import { ReferenceApp } from '../../../components/ReferenceApp';
import { createMarkdownRenderer, type IMarkdownRenderer } from '../../../markdown/domain/markdown';
import type { IHighlighter } from '../../../highlight/domain/highlight';
import {
  buildPageModel,
  PAGE_MODEL_VERSION,
  type PageModel,
} from '../../../page/domain/page-model';

/**
 * Version of the markup this package produces.
 *
 * Bumped by hand when a change to a component changes the bytes of an unchanged document.
 * It is part of the cache key, so bumping it invalidates every stored page at once.
 */
export const RENDER_VERSION = 1;

/** How one page is rendered. */
export interface RenderPageOptions {
  /** Node to render, or null for the document overview. */
  readonly nodeId?: string | null;
  /** Named schema to render, for a schema page. Ignored when `nodeId` is set. */
  readonly schemaId?: string | null;
  /** Where the reference is mounted, without a trailing slash. */
  readonly basePath?: string;
  /** Cache to read from and write to. Rendering is uncached when absent. */
  readonly cache?: IRenderCache;
  /** Highlighter for fenced blocks and examples. Code renders unhighlighted when absent. */
  readonly highlighter?: IHighlighter;
  /** Markdown renderer, when one is already built. Built from `highlighter` when absent. */
  readonly markdown?: IMarkdownRenderer;
}

/**
 * Key one page is stored under.
 *
 * @param documentHash - `IRDocument.hash`
 * @param nodeId - Node the page shows, or null for the overview
 * @param basePath - Mount point, which links are built from and so is part of the bytes
 * @returns A key that changes whenever the bytes could
 */
export function renderCacheKey(
  documentHash: string,
  nodeId: string | null,
  basePath = '',
  schemaId: string | null = null,
): string {
  const versions = `${String(IR_VERSION)}.${String(PAGE_MODEL_VERSION)}.${String(RENDER_VERSION)}`;
  return `oref:${versions}:${documentHash}:${basePath}:${nodeId ?? ''}:${schemaId ?? ''}`;
}

/**
 * Picks the markdown renderer for a call.
 *
 * Building one per page would rebuild `marked` for every node of a document, which is the
 * kind of cost that hides inside a per request path and shows up only under load.
 *
 * @param options - Options of the call
 * @returns The supplied renderer, or one built around the supplied highlighter
 */
function markdownFor(options: RenderPageOptions): IMarkdownRenderer {
  if (options.markdown !== undefined) return options.markdown;

  return createMarkdownRenderer(
    options.highlighter === undefined ? {} : { highlighter: options.highlighter },
  );
}

/**
 * Serializes the page model for the client.
 *
 * `canonicalize` rather than `JSON.stringify`, for the same reason hashing uses it: object
 * key order in JavaScript is not the order anything wrote them in, so two runs over one
 * document would otherwise be free to produce different bytes. Identical bytes are what
 * the cache test asserts and what makes a static build reproducible.
 *
 * @param model - The page model
 * @returns Canonical JSON
 */
export function serializePageModel(model: PageModel): string {
  return canonicalize(model);
}

/**
 * Title of a page: what it is about, then what document it belongs to.
 *
 * @param model - The page model
 * @returns Text for the `title` element, unescaped
 */
function pageTitle(model: PageModel): string {
  if (model.node !== null) return `${model.node.title} - ${model.title}`;
  if (model.schema !== null) return `${model.schema.name} - ${model.title}`;
  return model.title;
}

/**
 * Renders one page, through the cache when there is one.
 *
 * @param document - The normalized document
 * @param options - Node, mount point, cache and highlighter
 * @returns The rendered page, with no nonce in it
 */
export async function renderPage(
  document: IRDocument,
  options: RenderPageOptions = {},
): Promise<RenderedPage> {
  const nodeId = options.nodeId ?? null;
  const schemaId = nodeId === null ? (options.schemaId ?? null) : null;
  const basePath = options.basePath ?? '';
  const key = renderCacheKey(document.hash, nodeId, basePath, schemaId);

  const cached = await options.cache?.get(key);
  if (cached !== undefined) return cached;

  const markdown = markdownFor(options);

  const model = buildPageModel(document, { nodeId, schemaId, markdown });
  const app = createSSRApp(ReferenceApp, { page: model, basePath });
  const appHtml = await renderToString(app);

  const page: RenderedPage = {
    documentHash: document.hash,
    nodeId: model.activeNodeId,
    schemaId: model.activeSchemaId,
    title: pageTitle(model),
    appHtml,
    stateJson: serializePageModel(model),
  };

  await options.cache?.set(key, page);

  return page;
}

/**
 * Renders every page of a document, warming the cache.
 *
 * Sequential on purpose. `renderToString` is CPU bound and single threaded, so running
 * pages concurrently in one process buys nothing and makes peak memory the sum of every
 * page in flight rather than one. Parallelism across processes belongs to the static
 * build, in T039.
 *
 * Every named schema gets a page too, because the navigation links to one and because a
 * reference whose schema links 404 in a static build is a reference with broken links.
 *
 * @param document - The normalized document
 * @param options - As for `renderPage`, minus the node
 * @returns The overview, then nodes in document order, then schemas in document order
 */
export async function renderAllPages(
  document: IRDocument,
  options: Omit<RenderPageOptions, 'nodeId' | 'schemaId'> = {},
): Promise<RenderedPage[]> {
  const markdown = markdownFor(options);

  const pages: RenderedPage[] = [await renderPage(document, { ...options, markdown })];

  for (const nodeId of document.nodes.keys()) {
    pages.push(await renderPage(document, { ...options, markdown, nodeId }));
  }

  for (const schemaId of document.schemas.keys()) {
    pages.push(await renderPage(document, { ...options, markdown, schemaId }));
  }

  return pages;
}

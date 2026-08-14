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

import { IR_VERSION, type IRDocument } from '@openref/core';
import { provideSlots, resolveTheme, type PageKind, type ThemeDefinition } from '@openref/vue';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import type {
  IRenderCache,
  RenderedPage,
} from '../../../cache/application/ports/render-cache.port';
import { ReferenceApp } from '../../../components/ReferenceApp';
import { DEFERRABLE_KEY } from '../../../components/deferrable';
import { EAGER_COMPONENTS } from '../../../components/eager';
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
 *
 * 5 to 6 with `TX-FRAME`: the shell draws the app bar with back, breadcrumb and the tab bar,
 * the rail draws statistics and drift counters, the console leaves the node page for the
 * bench address and the health panel leaves the overview for its own. Same document,
 * different bytes on every page.
 *
 * 4 to 5 on 2026-08-14: the served send and stream buttons lost `aria-disabled`, a declared
 * media type example now wins over the generated one, zero denominator health checks stopped
 * rendering a row, and the rule heading gained its separator. Same document, different bytes.
 */
export const RENDER_VERSION = 6;

/** How one page is rendered. */
export interface RenderPageOptions {
  /**
   * Which page to render, per SPEC 13.3. Absent keeps the pre `TX-FRAME` derivation from
   * `nodeId` and `schemaId`, so a caller that never asked for a bench asks the way it always
   * did.
   */
  readonly page?: PageKind;
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
  /**
   * The theme in force, whose slot overrides this render resolves.
   *
   * THE SAME THEME HAS TO REACH THE CLIENT, per `hydrateReference`. A page rendered with an
   * override and hydrated without one is a hydration mismatch on that position, which is the
   * silent class of bug the whole component tree is written to avoid. The theme's name is part
   * of the cache key for the neighbouring reason: two mounts of one document under two themes
   * are two pages.
   */
  readonly theme?: ThemeDefinition;
  /**
   * The same origin proxy endpoint, when the host mounted one, per SPEC 14.5.
   *
   * Written into the page model so the runner factory in the browser can choose the proxy
   * transport. Part of the cache key: one document mounted twice, once with the proxy and once
   * without, is two pages, and a host may hand both mounts one cache.
   */
  readonly proxyPath?: string;
}

/**
 * Key one page is stored under.
 *
 * @param documentHash - `IRDocument.hash`
 * @param nodeId - Node the page shows, or null for the overview
 * @param basePath - Mount point, which links are built from and so is part of the bytes
 * @param schemaId - Named schema the page shows, for a schema page
 * @param themeName - Theme whose overrides this page was drawn with, empty for none
 * @param proxyPath - Proxy endpoint the page carries, empty for none
 * @param page - Which page, since `TX-FRAME`: a node and its bench are two pages of one node
 * @returns A key that changes whenever the bytes could
 */
export function renderCacheKey(
  documentHash: string,
  nodeId: string | null,
  basePath = '',
  schemaId: string | null = null,
  themeName = '',
  proxyPath = '',
  page = '',
): string {
  const versions = `${String(IR_VERSION)}.${String(PAGE_MODEL_VERSION)}.${String(RENDER_VERSION)}`;
  return `oref:${versions}:${documentHash}:${basePath}:${nodeId ?? ''}:${schemaId ?? ''}:${themeName}:${proxyPath}:${page}`;
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
async function markdownFor(options: RenderPageOptions): Promise<IMarkdownRenderer> {
  if (options.markdown !== undefined) return options.markdown;

  return createMarkdownRenderer(
    options.highlighter === undefined ? {} : { highlighter: options.highlighter },
  );
}

/**
 * Serializes the page model for the client.
 *
 * KEY ORDER IS PRESERVED, AND `canonicalize` IS THEREFORE THE WRONG TOOL HERE. It sorts keys
 * by code point, per SPEC 5.3, which is exactly right for a hash and wrong for a payload: the
 * `properties` object of every schema that travels with a page is authored order, and sorting
 * it rewrites what the author said. The server draws the schema tree from the model in memory
 * and the browser draws it from this JSON, so the two disagreed the moment the client rendered
 * anything: `AddressDto` read `line1, city, postalCode, country, geo` until a reader opened a
 * position and `city, country, geo, line1, postalCode` afterwards. Found in a browser on the
 * demo, recorded in SPEC 12.
 *
 * DETERMINISM IS STILL HERE AND COMES FROM SOMEWHERE ELSE. A page model is a pure function of
 * a deterministic IR built by deterministic code, so two runs insert the same keys in the same
 * order and `JSON.stringify` writes the same bytes. That is what the cache test asserts and
 * what makes a static build reproducible, and it is asserted over two independently built
 * models rather than over one model serialized twice, which would pass either way.
 *
 * THE HEALTH REPORT IS DRAWN AND NOT SHIPPED, per SPEC 7.2. It is the one part of the model the
 * server renders and the client never does, so a copy of it here would be the same five hundred
 * findings a second time: once as the markup a reader is looking at, and once as JSON to rebuild
 * markup that is already on the page. `PageModel.healthRendered` is what crosses instead, and the
 * client's filling of the panel position adopts the section it was handed rather than drawing
 * one. Measured on a document of 73 operations and 578 findings, that is 155 KB of a 381 KB page.
 *
 * IT IS EMPTIED HERE RATHER THAN LEFT OUT OF THE MODEL, because the server render needs the
 * report and the client must not receive it, and those are two consumers of one build. Writing
 * null keeps `readPageState` honest: the field the client reads has the type it declares.
 *
 * @param model - The page model
 * @returns JSON in the order the model was built in, with the report emptied
 */
export function serializePageModel(model: PageModel): string {
  return JSON.stringify({ ...model, health: null });
}

/**
 * Title of a page: what it is about, then what document it belongs to.
 *
 * @param model - The page model
 * @returns Text for the `title` element, unescaped
 */
function pageTitle(model: PageModel): string {
  if (model.kind === 'bench' && model.node !== null) {
    return `Bench: ${model.node.title} - ${model.title}`;
  }
  if (model.kind === 'shapes' && model.schema !== null) {
    return `Shapes: ${model.schema.name} - ${model.title}`;
  }
  if (model.kind === 'health') return `Documentation health - ${model.title}`;
  if (model.kind === 'states') return `States - ${model.title}`;
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
  const theme = resolveTheme(options.theme);
  // THE KEY CARRIES THE THEME'S NAME AND IS EMPTY WHEN THERE IS NONE, so a reference published
  // without a theme keys exactly as it did before slots were wired. The proxy path and the page
  // kind ride the same rule.
  const key = renderCacheKey(
    document.hash,
    nodeId,
    basePath,
    schemaId,
    options.theme?.name ?? '',
    options.proxyPath ?? '',
    options.page ?? '',
  );

  const cached = await options.cache?.get(key);
  if (cached !== undefined) return cached;

  const markdown = await markdownFor(options);

  const model = buildPageModel(document, {
    ...(options.page === undefined ? {} : { page: options.page }),
    nodeId,
    schemaId,
    markdown,
    basePath,
    ...(options.proxyPath === undefined ? {} : { proxyPath: options.proxyPath }),
  });
  const app = createSSRApp({
    name: 'OrefServerRoot',
    setup() {
      // THE REGISTRY IS PROVIDED AND THE DOCUMENT STATE IS NOT. `useSlot` reads the registry on
      // its own key since `TX-SLOTWIRE`, exactly so that a renderer with a theme and no
      // `IRDocument` can resolve a slot at all.
      provideSlots(theme.slots);

      return () => h(ReferenceApp, { page: model, basePath });
    },
  });
  // THE SERVER DEFERS NOTHING. A server render exists to put the whole page in the response,
  // and a deferred component here would ship markup with a hole in it that the client would
  // then have to fill, which is the opposite of what the client is being spared.
  app.provide(DEFERRABLE_KEY, EAGER_COMPONENTS);
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
 * EVERY PAGE A TAB LINKS TO IS HERE, since `TX-FRAME`: the health page, and a bench per
 * operation, because a build whose tab bar links to a page it does not hold is the same
 * broken link the schema pages exist to prevent. The two showcase addresses, shapes and
 * states, are deliberately not: nothing links to them, and whether a static build carries
 * unlinked pages is T039's question, recorded there rather than answered here by accident.
 *
 * @param document - The normalized document
 * @param options - As for `renderPage`, minus the node
 * @returns The overview, health, then nodes with their benches, then schemas, document order
 */
export async function renderAllPages(
  document: IRDocument,
  options: Omit<RenderPageOptions, 'nodeId' | 'schemaId' | 'page'> = {},
): Promise<RenderedPage[]> {
  const markdown = await markdownFor(options);

  const pages: RenderedPage[] = [await renderPage(document, { ...options, markdown })];
  pages.push(await renderPage(document, { ...options, markdown, page: 'health' }));

  for (const [nodeId, node] of document.nodes) {
    pages.push(await renderPage(document, { ...options, markdown, nodeId }));
    if (node.kind === 'operation') {
      pages.push(await renderPage(document, { ...options, markdown, page: 'bench', nodeId }));
    }
  }

  for (const schemaId of document.schemas.keys()) {
    pages.push(await renderPage(document, { ...options, markdown, schemaId }));
  }

  return pages;
}

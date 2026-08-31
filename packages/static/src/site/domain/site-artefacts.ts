/**
 * What one site is made of, produced once and read by both surfaces that need it.
 *
 * TWO SURFACES PRODUCE THE SAME ARTEFACTS AND THEY MAY NOT DISAGREE. `buildSite` writes them to
 * a directory, per SPEC 16.1; `createSiteServer` answers a request for any one of them without
 * writing anything, per SPEC 16.4, which is how the Nuxt module of `T061` serves the reference
 * under Nitro. A second copy of the page render or of the navigation payload would be two sites
 * that agree until the day one of them is changed, which is the reason `renderStaticSite` gives
 * for existing at all, one level up.
 *
 * WHAT STAYS OUT OF HERE IS THE INCREMENTAL PATH. Carrying a page forward is a fact about a
 * previous build on a disk, so it lives with the manifest in `build-site.service.ts`. This file
 * holds only what a page is, which is what a server has to be able to produce with no disk at
 * all.
 */

import type { IRDocument } from '@openref/core';
import {
  buildNavigation,
  renderHtmlDocument,
  renderPage,
  type IHighlighter,
  type IMarkdownRenderer,
  type IRenderCache,
  type RenderedPage,
  type StaticProxyModel,
  type ThemeDefinition,
} from '@openref/render';
import { headOf } from '../../build/domain/page-metadata';
import type { PlannedPage } from '../../build/domain/page-plan';
import type { SiteBase } from '../../build/domain/site-base';

/** Everything a page needs beyond the document and the page itself. */
export interface PageRenderContext {
  /** The resolved base: its path is in every link, its origin in the canonical url. */
  readonly base: SiteBase;
  /** Stylesheet hrefs the shell links, in link order. */
  readonly stylesheets: readonly string[];
  /** Module hrefs the shell links. */
  readonly modules: readonly string[];
  /** The direct mode platform name of SPEC 16.2, or null. */
  readonly directTarget: string | null;
  /** The generated rules of SPEC 16.2, or null. */
  readonly staticProxy: StaticProxyModel | null;
  /** Highlighter for fenced blocks. Code is unhighlighted when absent. */
  readonly highlighter?: IHighlighter;
  /** Markdown renderer, built once by the caller so it is not rebuilt per page. */
  readonly markdown?: IMarkdownRenderer;
  /** The theme in force, whose slot overrides the render resolves. */
  readonly theme?: ThemeDefinition;
  /** Value of the `lang` attribute on every page. */
  readonly lang?: string;
  /** Forces a colour scheme instead of following the reader's system preference. */
  readonly colorScheme?: 'light' | 'dark';
  /** The SPEC 12 cache, keyed by document hash. Rendering is uncached when absent. */
  readonly cache?: IRenderCache;
  /**
   * CSP nonce for this one response, per SPEC 19.2.
   *
   * ABSENT IS THE BUILT CASE AND PRESENT IS THE SERVED ONE. A file on disk is one response
   * reused and a reused nonce is not a nonce, which is what `ShellOptions.nonce` says where it
   * is declared; a served page carries the nonce the host generated for that response. It is
   * therefore the one input on which a served page and a built page legitimately differ, and
   * the equality suite states it by asking the server for pages with no nonce.
   */
  readonly nonce?: string;
}

/**
 * Renders one page through the cache, with no shell around it.
 *
 * @param document - The normalized document
 * @param page - The planned page
 * @param context - Everything shared across pages
 * @returns The rendered page, with no nonce in it
 */
export async function renderPageOf(
  document: IRDocument,
  page: PlannedPage,
  context: PageRenderContext,
): Promise<RenderedPage> {
  return renderPage(document, {
    page: page.kind,
    nodeId: page.nodeId,
    schemaId: page.schemaId,
    serviceId: page.serviceId,
    basePath: context.base.basePath,
    ...(context.directTarget === null ? {} : { directTarget: context.directTarget }),
    ...(context.staticProxy === null ? {} : { staticProxy: context.staticProxy }),
    ...(context.highlighter === undefined ? {} : { highlighter: context.highlighter }),
    ...(context.markdown === undefined ? {} : { markdown: context.markdown }),
    ...(context.theme === undefined ? {} : { theme: context.theme }),
    ...(context.cache === undefined ? {} : { cache: context.cache }),
  });
}

/**
 * Wraps a rendered page in the document shell, head tags and all.
 *
 * @param document - The normalized document
 * @param page - The planned page
 * @param rendered - What `renderPageOf` produced, or what was carried forward
 * @param context - Everything shared across pages
 * @returns The whole HTML document
 */
export function documentHtmlOf(
  document: IRDocument,
  page: PlannedPage,
  rendered: RenderedPage,
  context: PageRenderContext,
): string {
  const head = headOf(document, { ...page, title: rendered.title }, context.base);

  return renderHtmlDocument(rendered, {
    assets: { stylesheets: context.stylesheets, modules: context.modules },
    head,
    ...(context.nonce === undefined ? {} : { nonce: context.nonce }),
    ...(context.lang === undefined ? {} : { lang: context.lang }),
    ...(context.colorScheme === undefined ? {} : { colorScheme: context.colorScheme }),
    ...(context.theme?.tokens === undefined ? {} : { tokens: context.theme.tokens }),
  });
}

/**
 * The navigation payload a page fetches the first time a reader opens a closed group.
 *
 * ONE PRODUCER SINCE `T061`, because the built file and the served answer are the same bytes at
 * the same address and there was no reason for two spellings of the same `JSON.stringify`.
 *
 * @param document - The normalized document
 * @returns The payload, exactly as the built file carries it
 */
export function navigationPayload(document: IRDocument): string {
  return JSON.stringify({ documentHash: document.hash, navigation: buildNavigation(document) });
}

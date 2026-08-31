/**
 * The built site, answered live: SPEC 16.4's half of SPEC 16.1.
 *
 * WHY A SERVER LIVES IN THE STATIC BUILD'S PACKAGE. `T061` mounts the reference inside a Nuxt
 * application, where the deployment is a Nitro server rather than a directory of files, and the
 * one thing that must stay true is that the two carry the same bytes at the same addresses. A
 * dispatcher written in the Nuxt package would be a second statement of what a site consists of,
 * which is the "an idea with one home" defect this repository keeps finding. So the artefacts
 * are produced by `site-artefacts.ts`, which `buildSite` also uses, and the mapping from an
 * address to an artefact is stated once, here, in both directions.
 *
 * BOTH DIRECTIONS, BECAUSE ONE OF THEM CANNOT FAIL ALONE. `fileOfAddress` says which file
 * answers an address and `addressOfFile` says where a written file is read from; the equality
 * suite walks every file a real build wrote, asks this server for its address, and compares the
 * bytes. A mapping stated once and used one way would agree with itself while disagreeing with
 * the directory.
 *
 * WHAT IT DELIBERATELY DOES NOT ANSWER. The generated proxy configuration of SPEC 16.2 is a file
 * a platform reads, never a file a reader fetches, and under Nitro the proxy is a live route
 * rather than a rule: it is registered from the same generator by the Nuxt module and is not an
 * artefact of this server. The dynamic routes of SPEC 13.3, the runtime proxy, `openapi.json`,
 * `_health`, the agent surface and the broker bridge, belong to the Nest mount and are not part
 * of a static site at all.
 */

import { proxyServers, type IRDocument } from '@openref/core';
import {
  buildAssetCatalog,
  contentTypeFor,
  type AssetCatalog,
  type AssetSource,
  type IHighlighter,
  type IMarkdownRenderer,
  type IRenderCache,
  type StaticProxyModel,
  type ThemeDefinition,
} from '@openref/render';
import { buildSearchIndex } from '@openref/search';
import { proxyPathPrefix } from '../../../proxy/domain/proxy-files';
import type { BuildTarget } from '../../../proxy/domain/proxy-target';
import { planProxy } from '../../../proxy/domain/proxy-plan';
import {
  ASSET_DIRECTORY,
  navigationFileOf,
  planPages,
  SEARCH_INDEX_FILE,
  type PlannedPage,
} from '../../../build/domain/page-plan';
import { resolveSiteBase, type SiteBase } from '../../../build/domain/site-base';
import { LLMS_FILE, llmsTxt, SITEMAP_FILE, sitemapXml } from '../../../build/domain/site-files';
import {
  documentHtmlOf,
  navigationPayload,
  renderPageOf,
  type PageRenderContext,
} from '../../domain/site-artefacts';

/** Files a page loads, as the build is given them: the bytes, so this site can serve them. */
export interface SiteAssetSources {
  readonly sources: readonly AssetSource[];
  /** Disk names of the stylesheets, in link order. */
  readonly stylesheetNames: readonly string[];
  /** Disk name of the client bundle. */
  readonly moduleName: string;
}

/**
 * The names alone, for a site whose assets the deployment publishes rather than this server.
 *
 * THE CASE IS A NITRO DEPLOYMENT AND IT IS NOT A DEGRADED ONE. A hashed asset is an immutable
 * file addressed by its own digest, so a platform that already has a static layer should answer
 * it there rather than through a handler. What the pages still need is the served name of each
 * asset, which is a function of bytes the deployment saw at build time; passing the map keeps the
 * page's links identical to the built page's without keeping half a megabyte of fonts in the
 * server's memory. A site built this way answers no asset address, and `files` says so, which is
 * what stops the equality suite from reading the absence as agreement.
 */
export interface SiteAssetNames {
  /** Disk name to served name, exactly as `buildAssetCatalog` resolved them. */
  readonly servedNames: Readonly<Record<string, string>>;
  /** Disk names of the stylesheets, in link order. */
  readonly stylesheetNames: readonly string[];
  /** Disk name of the client bundle. */
  readonly moduleName: string;
}

/** How a live site is configured. It is `BuildSiteOptions` without the place files go. */
export interface SiteServerOptions {
  /** The normalized document, runtime facts and all. */
  readonly document: IRDocument;
  /** Files a page loads: the bytes to serve them with, or the names the deployment serves. */
  readonly assets: SiteAssetSources | SiteAssetNames;
  /** `--base`: a path, or an absolute url when the site has an origin. */
  readonly base?: string;
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
  /** The proxy generation of SPEC 16.2, absent when no target was given. */
  readonly proxy?: {
    readonly target: BuildTarget;
    readonly forwardCookies?: boolean;
  };
}

/** What one address answers with. */
export interface SiteAnswer {
  /** The file of the built site this answer is the contents of. */
  readonly file: string;
  /** Value for the `Content-Type` header. */
  readonly contentType: string;
  /** Text for a document or a payload, bytes for an asset. */
  readonly body: string | Uint8Array;
  /**
   * Whether the bytes are addressed by their own digest and may be cached forever.
   *
   * Only a hashed asset is: everything else is addressed by a name that outlives its contents.
   */
  readonly immutable: boolean;
}

/** A site that answers requests instead of writing files. */
export interface ISiteServer {
  /** The base this site is mounted at. */
  readonly base: SiteBase;
  /** Every file the build of this document would write, in build order, pages first. */
  readonly files: readonly string[];
  /**
   * Answers one address.
   *
   * @param address - Request path, base path included, without a query string
   * @param nonce - CSP nonce for this response, per SPEC 19.2, when the host serves a policy
   * @returns The answer, or null when the site holds nothing at that address
   */
  answer(address: string, nonce?: string): Promise<SiteAnswer | null>;
  /**
   * The address a written file is read from.
   *
   * @param file - Path relative to the output root, forward slashes
   * @returns The address, or null when the file is not one this server answers
   */
  addressOf(file: string): string | null;
}

/** Content type of every artefact that is not a hashed asset, by file. */
const TEXT_CONTENT_TYPES: Readonly<Record<string, string>> = {
  [SEARCH_INDEX_FILE]: 'application/json; charset=utf-8',
  [SITEMAP_FILE]: 'application/xml; charset=utf-8',
  [LLMS_FILE]: 'text/plain; charset=utf-8',
};

/**
 * Builds a site that answers addresses.
 *
 * NOTHING IS RENDERED HERE. The plan, the catalogue and the proxy decision are computed once,
 * because they are functions of the document and of nothing about a request; a page is rendered
 * when it is asked for, through the cache if there is one.
 *
 * @param options - The document, its assets and the base
 * @returns The server
 */
export function createSiteServer(options: SiteServerOptions): ISiteServer {
  const { document } = options;
  const base = resolveSiteBase(options.base);

  const proxy = planProxy({
    target: options.proxy?.target ?? 'none',
    servers: proxyServers(document),
    basePath: base.basePath,
    forwardCookies: options.proxy?.forwardCookies ?? false,
  });

  const staticProxy: StaticProxyModel | null =
    proxy.files.length > 0 && proxy.upstreams.length > 0
      ? { prefix: proxyPathPrefix(base.basePath), upstreams: proxy.upstreams }
      : null;

  const catalog: AssetCatalog | null =
    'sources' in options.assets ? buildAssetCatalog(options.assets.sources) : null;

  const servedNameOf = (name: string): string | undefined =>
    catalog === null
      ? (options.assets as SiteAssetNames).servedNames[name]
      : catalog.byName.get(name)?.servedName;

  const assetHrefOf = (name: string): string => {
    const servedName = servedNameOf(name);
    if (servedName === undefined) {
      throw new Error(
        `the asset "${name}" is linked by every page and was not offered to the catalog`,
      );
    }
    return `${base.basePath}/${ASSET_DIRECTORY}/${servedName}`;
  };

  const context = (nonce?: string): PageRenderContext => ({
    base,
    stylesheets: options.assets.stylesheetNames.map(assetHrefOf),
    modules: [assetHrefOf(options.assets.moduleName)],
    directTarget: proxy.directTarget,
    staticProxy,
    ...(options.highlighter === undefined ? {} : { highlighter: options.highlighter }),
    ...(options.markdown === undefined ? {} : { markdown: options.markdown }),
    ...(options.theme === undefined ? {} : { theme: options.theme }),
    ...(options.lang === undefined ? {} : { lang: options.lang }),
    ...(options.colorScheme === undefined ? {} : { colorScheme: options.colorScheme }),
    ...(options.cache === undefined ? {} : { cache: options.cache }),
    ...(nonce === undefined ? {} : { nonce }),
  });

  const pages = planPages(document, base.basePath);
  const pageByFile = new Map(pages.map((page) => [page.file, page]));
  const pageByAddress = new Map(pages.map((page) => [page.href, page]));

  const navigationFile = navigationFileOf(document.hash);
  const sitemap = sitemapXml(pages, base);

  const files: string[] = [
    ...pages.map((page) => page.file),
    ...(catalog === null
      ? []
      : catalog.assets.map((asset) => `${ASSET_DIRECTORY}/${asset.servedName}`)),
    navigationFile,
    SEARCH_INDEX_FILE,
    ...(sitemap === null ? [] : [SITEMAP_FILE]),
    LLMS_FILE,
  ];

  const addressOf = (file: string): string | null => {
    const page = pageByFile.get(file);
    if (page !== undefined) return page.href;
    if (!files.includes(file)) return null;

    return `${base.basePath}/${file}`;
  };

  const answer = async (address: string, nonce?: string): Promise<SiteAnswer | null> => {
    const page = pageByAddress.get(normalizeAddress(address, base));
    if (page !== undefined) {
      return {
        file: page.file,
        contentType: 'text/html; charset=utf-8',
        body: await pageHtml(document, page, context(nonce)),
        immutable: false,
      };
    }

    const file = fileOfAddress(address, base);
    if (file === null) return null;

    return fileAnswer(file);
  };

  const fileAnswer = (file: string): SiteAnswer | null => {
    if (file.startsWith(`${ASSET_DIRECTORY}/`)) {
      if (catalog === null) return null;

      const servedName = file.slice(ASSET_DIRECTORY.length + 1);
      const asset = catalog.assets.find((entry) => entry.servedName === servedName);
      if (asset === undefined) return null;

      return {
        file,
        contentType: contentTypeFor(asset.servedName),
        body: asset.bytes,
        immutable: true,
      };
    }

    if (file === navigationFile) {
      return {
        file,
        contentType: 'application/json; charset=utf-8',
        body: navigationPayload(document),
        immutable: false,
      };
    }

    if (file === SEARCH_INDEX_FILE) {
      return {
        file,
        contentType: TEXT_CONTENT_TYPES[file] ?? '',
        body: buildSearchIndex(document).serialized,
        immutable: false,
      };
    }

    if (file === SITEMAP_FILE && sitemap !== null) {
      return { file, contentType: TEXT_CONTENT_TYPES[file] ?? '', body: sitemap, immutable: false };
    }

    if (file === LLMS_FILE) {
      return {
        file,
        contentType: TEXT_CONTENT_TYPES[file] ?? '',
        body: llmsTxt(document, pages, base),
        immutable: false,
      };
    }

    return null;
  };

  return { base, files, answer, addressOf };
}

/**
 * The whole HTML document of one page.
 *
 * @param document - The normalized document
 * @param page - The planned page
 * @param context - Everything shared across pages
 * @returns The bytes a built site holds at `page.file`
 */
async function pageHtml(
  document: IRDocument,
  page: PlannedPage,
  context: PageRenderContext,
): Promise<string> {
  return documentHtmlOf(document, page, await renderPageOf(document, page, context), context);
}

/**
 * An address with its one alias folded onto the address `links.ts` spells.
 *
 * NO PAGE ADDRESS ENDS IN A SLASH, the overview at the site root included, which is `/`. That is
 * what `overviewHref` produces and therefore what every link on every page carries. The one
 * alias that has to be folded is `<base>/`, because a directory of files is what the built site
 * is and a reader who types the mount point with a trailing slash is at the overview on every
 * static host; folding it here is what makes the served mount answer where the built one does.
 * Nothing else is folded: a site that answers one page at several addresses is several canonical
 * urls for one page.
 *
 * @param address - Request path, base path included
 * @param base - The site's base
 * @returns The address as `links.ts` spells it
 */
function normalizeAddress(address: string, base: SiteBase): string {
  return base.basePath !== '' && address === `${base.basePath}/` ? base.basePath : address;
}

/**
 * The file an address names, for everything that is not a page.
 *
 * @param address - Request path, base path included
 * @param base - The site's base
 * @returns The path relative to the output root, or null when the address is outside the mount
 */
function fileOfAddress(address: string, base: SiteBase): string | null {
  if (base.basePath !== '' && !address.startsWith(`${base.basePath}/`)) return null;

  const rest = address.slice(base.basePath.length + 1);

  return rest === '' ? null : rest;
}

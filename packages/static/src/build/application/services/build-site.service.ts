/**
 * The static build of SPEC 16: one document in, a directory of files out.
 *
 * SEQUENTIAL, IN ONE PROCESS, AND THE BUDGET IS THE REASON RATHER THAN THE OBSTACLE. SPEC 20
 * allows 60 seconds for 1000 nodes on 4 cores. Measured on this workstation at T039, 1000 nodes
 * is 2103 pages rendered in 2.2 seconds, about 1.0 ms a page, with the machine recorded beside
 * the figure in `packages/static/test/integration/build-budget.spec.ts` per the `TX-CLOCK`
 * amendment. A worker pool would buy a factor the budget does not need and would cost the one
 * property this build sells: `renderToString` is deterministic in one process, and a pool would
 * put the ordering of an unordered merge between the input and the bytes.
 *
 * ZERO OUTBOUND REQUESTS BY CONSTRUCTION, per SPEC 16.3. Nothing here opens a socket: the
 * document arrives already normalized, the assets arrive as bytes a caller read, and the
 * renderer's own highlighter is the only thing that ever loads anything, from its own package.
 * The proof is a test that installs a global network trap, and it asserts the trap sees the
 * calls it would report before asserting the build made none, since a trap that watched nothing
 * would report zero for the wrong reason.
 */

import type { IRDocument } from '@openref/core';
import {
  APP_ROOT_ID,
  buildAssetCatalog,
  buildNavigation,
  renderHtmlDocument,
  renderPage,
  type AssetCatalog,
  type AssetSource,
  type IHighlighter,
  type IMarkdownRenderer,
  type RenderedPage,
  type ThemeDefinition,
} from '@openref/render';
import { buildSearchIndex } from '@openref/search';
import {
  BUILD_MANIFEST_FILE,
  BUILD_MANIFEST_VERSION,
  manifestApplies,
  readManifest,
  serializeManifest,
  type BuildManifest,
  type ManifestPage,
} from '../../domain/build-manifest';
import { headOf } from '../../domain/page-metadata';
import { PAGE_KEY_VERSION } from '../../domain/page-key';
import {
  ASSET_DIRECTORY,
  navigationFileOf,
  planPages,
  SEARCH_INDEX_FILE,
  type PlannedPage,
} from '../../domain/page-plan';
import { readdressPage } from '../../domain/rehash-page';
import { NO_ORIGIN_NOTICE, resolveSiteBase, type SiteBase } from '../../domain/site-base';
import { LLMS_FILE, llmsTxt, SITEMAP_FILE, sitemapXml } from '../../domain/site-files';
import type { IOutputStore } from '../ports/output-store.port';

/** How one build is configured. */
export interface BuildSiteOptions {
  /** The normalized document, runtime facts and all. */
  readonly document: IRDocument;
  /** Where the files go. */
  readonly store: IOutputStore;
  /** Files a page loads: stylesheets, the client bundle, and everything they refer to. */
  readonly assets: {
    readonly sources: readonly AssetSource[];
    /** Disk names of the stylesheets, in link order. */
    readonly stylesheetNames: readonly string[];
    /** Disk name of the client bundle. */
    readonly moduleName: string;
  };
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
}

/** What one build did. */
export interface BuildReport {
  /** Hash of the document that was built. */
  readonly documentHash: string;
  /** Base path every link carries. */
  readonly basePath: string;
  /** Absolute base, when `--base` carried an origin. */
  readonly siteUrl: string | null;
  /** Files of the pages this build rendered. */
  readonly rendered: readonly string[];
  /**
   * Files of the pages this build carried forward from the previous one.
   *
   * A CARRIED PAGE IS STILL WRITTEN, because its state block names the document hash and the
   * hash moved. What it did not do is render, which is the quantity SPEC 16.3's incremental
   * clause is about and the one this report is asserted on.
   */
  readonly carried: readonly string[];
  /** Every other file written: assets, index, navigation, site files, the manifest. */
  readonly files: readonly string[];
  /** Files the previous build wrote that this one does not, now removed. */
  readonly removed: readonly string[];
  /** Whether a sitemap was written, and the reason when it was not. */
  readonly sitemap: boolean;
  /** Anything a deployer should read, such as {@link NO_ORIGIN_NOTICE}. */
  readonly notices: readonly string[];
}

/**
 * Builds the whole site.
 *
 * @param options - Document, output, assets and the base
 * @returns What was written
 */
export async function buildSite(options: BuildSiteOptions): Promise<BuildReport> {
  const { document, store } = options;
  const base = resolveSiteBase(options.base);

  const catalog = buildAssetCatalog(options.assets.sources);
  const assetHrefOf = (name: string): string => {
    const asset = catalog.byName.get(name);
    if (asset === undefined) {
      throw new Error(
        `the asset "${name}" is linked by every page and was not offered to the catalog`,
      );
    }
    return `${base.basePath}/${ASSET_DIRECTORY}/${asset.servedName}`;
  };

  const stylesheets = options.assets.stylesheetNames.map(assetHrefOf);
  const modules = [assetHrefOf(options.assets.moduleName)];

  const previous = await readPreviousManifest(store);
  const reusable = manifestApplies(previous, document, base.basePath, base.siteUrl)
    ? new Map(previous.pages.map((page) => [page.file, page]))
    : new Map<string, ManifestPage>();

  const pages = planPages(document, base.basePath);
  const rendered: string[] = [];
  const carried: string[] = [];

  for (const page of pages) {
    const wasCarried = await writeOnePage(page, {
      options,
      base,
      catalog,
      stylesheets,
      modules,
      previousKey: reusable.get(page.file)?.key,
    });

    (wasCarried ? carried : rendered).push(page.file);
  }

  const files = await writeSiteFiles(options, base, catalog, pages);

  const manifest: BuildManifest = {
    version: BUILD_MANIFEST_VERSION,
    pageKeyVersion: PAGE_KEY_VERSION,
    documentHash: document.hash,
    basePath: base.basePath,
    siteUrl: base.siteUrl,
    pages: pages.map((page) => ({ file: page.file, key: page.key })),
    files,
  };

  const removed = await removeStale(store, previous, pages, files);
  await store.write(BUILD_MANIFEST_FILE, serializeManifest(manifest));

  return {
    documentHash: document.hash,
    basePath: base.basePath,
    siteUrl: base.siteUrl,
    rendered,
    carried,
    files: [...files, BUILD_MANIFEST_FILE],
    removed,
    sitemap: base.siteUrl !== null,
    notices: base.siteUrl === null ? [NO_ORIGIN_NOTICE] : [],
  };
}

/** What writing one page needs beyond the page itself. */
interface PageContext {
  readonly options: BuildSiteOptions;
  readonly base: SiteBase;
  readonly catalog: AssetCatalog;
  readonly stylesheets: readonly string[];
  readonly modules: readonly string[];
  readonly previousKey: string | undefined;
}

/**
 * Writes one page, rendering it or carrying the previous one forward.
 *
 * @param page - The planned page
 * @param context - Everything shared across pages
 * @returns True when the page was carried rather than rendered
 */
async function writeOnePage(page: PlannedPage, context: PageContext): Promise<boolean> {
  const { options, base } = context;
  const { document } = options;

  let carried = false;
  let rendered: RenderedPage | null = null;

  if (context.previousKey === page.key) {
    const existing = await options.store.read(page.file);
    rendered =
      existing === null
        ? null
        : readdressPage(existing, APP_ROOT_ID, document.hash, page.nodeId, page.schemaId);
    carried = rendered !== null;
  }

  rendered ??= await renderPage(document, {
    page: page.kind,
    nodeId: page.nodeId,
    schemaId: page.schemaId,
    basePath: base.basePath,
    ...(options.highlighter === undefined ? {} : { highlighter: options.highlighter }),
    ...(options.markdown === undefined ? {} : { markdown: options.markdown }),
    ...(options.theme === undefined ? {} : { theme: options.theme }),
  });

  const head = headOf(document, { ...page, title: rendered.title }, base);

  // NO NONCE, AND THAT IS THE STATIC CASE RATHER THAN AN OMISSION: a file on disk is one
  // response reused, and a nonce that is reused is not a nonce. `ShellOptions.nonce` says so
  // where it is declared.
  const html = renderHtmlDocument(rendered, {
    assets: { stylesheets: context.stylesheets, modules: context.modules },
    head,
    ...(options.lang === undefined ? {} : { lang: options.lang }),
    ...(options.colorScheme === undefined ? {} : { colorScheme: options.colorScheme }),
    ...(options.theme?.tokens === undefined ? {} : { tokens: options.theme.tokens }),
  });

  await options.store.write(page.file, html);

  return carried;
}

/**
 * Writes everything that is not a page.
 *
 * @param options - The build's options
 * @param base - The build's base
 * @param catalog - The asset catalog
 * @param pages - The planned pages, for the two site files
 * @returns The files written, in a fixed order
 */
async function writeSiteFiles(
  options: BuildSiteOptions,
  base: SiteBase,
  catalog: AssetCatalog,
  pages: readonly PlannedPage[],
): Promise<readonly string[]> {
  const { document, store } = options;
  const files: string[] = [];

  for (const asset of catalog.assets) {
    const file = `${ASSET_DIRECTORY}/${asset.servedName}`;
    await store.writeBytes(file, asset.bytes);
    files.push(file);
  }

  // THE NAVIGATION PAYLOAD, AT THE PATH `navigationHref` PRODUCES, per the T039 amendment: a
  // page fetches the rest of its navigation from there the first time a reader opens a closed
  // group, and a directory of files has no route to answer with. Written once per document
  // rather than per page, which is the whole reason it left the page.
  const navigationFile = navigationFileOf(document.hash);
  await store.write(
    navigationFile,
    JSON.stringify({ documentHash: document.hash, navigation: buildNavigation(document) }),
  );
  files.push(navigationFile);

  await store.write(SEARCH_INDEX_FILE, buildSearchIndex(document).serialized);
  files.push(SEARCH_INDEX_FILE);

  const sitemap = sitemapXml(pages, base);
  if (sitemap !== null) {
    await store.write(SITEMAP_FILE, sitemap);
    files.push(SITEMAP_FILE);
  }

  await store.write(LLMS_FILE, llmsTxt(document, pages, base));
  files.push(LLMS_FILE);

  return files;
}

/** The previous manifest, or null when there is none this build understands. */
async function readPreviousManifest(store: IOutputStore): Promise<BuildManifest | null> {
  const text = await store.read(BUILD_MANIFEST_FILE);
  return text === null ? null : readManifest(text);
}

/**
 * Removes what the previous build wrote and this one did not.
 *
 * ONLY WHAT THE PREVIOUS MANIFEST CLAIMED. A file the deployer put in the directory is not this
 * build's to delete, and a directory listing could not tell the two apart, which is the second
 * reason the manifest exists.
 *
 * @param store - Where the build writes
 * @param previous - The previous manifest, or null
 * @param pages - This build's pages
 * @param files - This build's other files
 * @returns The files removed, in the previous manifest's order
 */
async function removeStale(
  store: IOutputStore,
  previous: BuildManifest | null,
  pages: readonly PlannedPage[],
  files: readonly string[],
): Promise<readonly string[]> {
  if (previous === null) return [];

  const written = new Set<string>([...pages.map((page) => page.file), ...files]);
  const removed: string[] = [];

  for (const file of [...previous.pages.map((page) => page.file), ...previous.files]) {
    if (written.has(file) || removed.includes(file)) continue;
    await store.remove(file);
    removed.push(file);
  }

  return removed;
}

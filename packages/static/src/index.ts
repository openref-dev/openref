import { PACKAGE_NAME as CORE_PACKAGE } from '@openref/core';
import { PACKAGE_NAME as RENDER_PACKAGE } from '@openref/render';
import { PACKAGE_NAME as SEARCH_PACKAGE } from '@openref/search';

/**
 * `@openref/static`: the static build of SPEC 16.
 *
 * Internal, bundled into the `openref` CLI. It turns a normalized document into a directory of
 * files: one HTML page per node with its own URL, the navigation payload, the search index,
 * hashed assets, a sitemap and `llms.txt`.
 *
 * IT CANNOT SEE `@openref/nest`, per the dependency rule, and nothing here needs to. The one
 * artefact that lives on that side, the browser bundle, arrives as bytes a caller read off
 * disk, the same way `package-assets.adapter.ts` resolves a theme as files rather than
 * importing it as code.
 */

/** Name of this package. */
export const PACKAGE_NAME = '@openref/static';

/** Packages this package is allowed to depend on. */
export const UPSTREAM_PACKAGES: readonly string[] = [CORE_PACKAGE, RENDER_PACKAGE, SEARCH_PACKAGE];

export { buildSite } from './build/application/services/build-site.service';
export type {
  BuildReport,
  BuildSiteOptions,
} from './build/application/services/build-site.service';

export {
  highlighterFor,
  renderStaticSite,
} from './build/application/services/render-static-site.service';
export type { StaticBuildRequest } from './build/application/services/render-static-site.service';

export { createSiteServer } from './site/application/services/site-server.service';
export type {
  ISiteServer,
  SiteAnswer,
  SiteAssetNames,
  SiteAssetSources,
  SiteServerOptions,
} from './site/application/services/site-server.service';
export { documentHtmlOf, navigationPayload, renderPageOf } from './site/domain/site-artefacts';
export type { PageRenderContext } from './site/domain/site-artefacts';

export type { IOutputStore } from './build/application/ports/output-store.port';
export { FsOutputStore } from './build/infrastructure/adapters/fs-output-store.adapter';

export {
  BUILD_MANIFEST_FILE,
  BUILD_MANIFEST_VERSION,
  manifestApplies,
  readManifest,
  RENDERER_VERSION,
  serializeManifest,
} from './build/domain/build-manifest';
export type { BuildManifest, ManifestPage } from './build/domain/build-manifest';

export {
  BUILD_TARGETS,
  detectTarget,
  DIRECT_TARGETS,
  isBuildTarget,
  isDirectTarget,
  isProxyConfigTarget,
  PROXY_CONFIG_TARGETS,
  targetLabel,
} from './proxy/domain/proxy-target';
export type {
  BuildTarget,
  DirectTarget,
  ProxyConfigTarget,
  TargetDetection,
} from './proxy/domain/proxy-target';
export {
  planUpstreams,
  unsafeUpstreamCharacter,
  UPSTREAM_EXPANSION_LIMIT,
  UPSTREAM_TOTAL_LIMIT,
} from './proxy/domain/proxy-upstreams';
export type { UpstreamPlan } from './proxy/domain/proxy-upstreams';
export {
  generateProxyFiles,
  PROXY_GATEWAY_COMMENT,
  proxyPathPrefix,
  VERCEL_FILE_NOTICE,
} from './proxy/domain/proxy-files';
export type { GeneratedProxyFile, ProxyFileOptions } from './proxy/domain/proxy-files';
export { planProxy } from './proxy/domain/proxy-plan';
export type { ProxyPlan, ProxyPlanOptions } from './proxy/domain/proxy-plan';

export { frameHashOf, PAGE_KEY_VERSION, pageKeyOf } from './build/domain/page-key';
export {
  ASSET_DIRECTORY,
  MAX_SEGMENT_BYTES,
  navigationFileOf,
  PAGE_KIND_CARDINALITY,
  planPages,
  SEARCH_INDEX_FILE,
} from './build/domain/page-plan';
export type { PlannedPage } from './build/domain/page-plan';

export { headOf, plainSummary } from './build/domain/page-metadata';
export type { PageSubject } from './build/domain/page-metadata';

export { readdressPage, recoverPage } from './build/domain/rehash-page';
export type { RecoveredPage } from './build/domain/rehash-page';

export { absoluteUrlOf, NO_ORIGIN_NOTICE, resolveSiteBase } from './build/domain/site-base';
export type { SiteBase } from './build/domain/site-base';

export { LLMS_FILE, llmsTxt, SITEMAP_FILE, sitemapXml } from './build/domain/site-files';

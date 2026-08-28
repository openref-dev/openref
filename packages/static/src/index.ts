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

export type { IOutputStore } from './build/application/ports/output-store.port';
export { FsOutputStore } from './build/infrastructure/adapters/fs-output-store.adapter';

export {
  BUILD_MANIFEST_FILE,
  BUILD_MANIFEST_VERSION,
  manifestApplies,
  readManifest,
  serializeManifest,
} from './build/domain/build-manifest';
export type { BuildManifest, ManifestPage } from './build/domain/build-manifest';

export { frameHashOf, PAGE_KEY_VERSION, pageKeyOf } from './build/domain/page-key';
export {
  ASSET_DIRECTORY,
  navigationFileOf,
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

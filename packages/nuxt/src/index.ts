import { PACKAGE_NAME as CORE_PACKAGE } from '@openref/core';
import { PACKAGE_NAME as RENDER_PACKAGE } from '@openref/render';
import { PACKAGE_NAME as SEARCH_PACKAGE } from '@openref/search';
import { PACKAGE_NAME as STATIC_PACKAGE } from '@openref/static';
import { openRefNuxtModule } from './module/api/openref.module';

/**
 * `@openref/nuxt`: the Nuxt module of SPEC 16.4.
 *
 * IT IS A WRAPPER AND THAT IS ITS WHOLE DEFINITION. `nuxt generate` writes the site
 * `openref build` writes, byte for byte, because it calls the same build; Nitro answers the
 * addresses that site holds, because the same package produces both. What lives here is the
 * mounting: which hook, which route, which directory.
 *
 * IT DOES NOT SEE `@openref/nest`, AND A NUXT APPLICATION DOES NOT INSTALL NestJS. The runtime
 * facts of SPEC 6 come from a running Nest application, so a reference built from a specification
 * file carries what that file says and nothing more. A host that wants the runtime pass runs
 * `openref build --from-nest` and points this module at what it produced, which is the same
 * document by the time it reaches here.
 */

/** Name of this package. */
export const PACKAGE_NAME = '@openref/nuxt';

/** Packages this package is allowed to depend on, in the order declared by STANDARDS 3.5. */
export const UPSTREAM_PACKAGES: readonly string[] = [
  CORE_PACKAGE,
  RENDER_PACKAGE,
  SEARCH_PACKAGE,
  STATIC_PACKAGE,
];

export { openRefNuxtModule };
export default openRefNuxtModule;

export {
  ASSET_MAX_AGE,
  GENERATED_ASSET_DIRECTORY,
  GENERATED_DIRECTORY,
  generatedEntryFile,
  prerenderIgnorePattern,
  PROXY_ENTRY,
  REFERENCE_ENTRY,
  referenceEntrySource,
  RUNTIME_SPECIFIER,
} from './module/api/openref.module';
export { generatesStatically, resolveNuxtOptions } from './module/domain/module-options';
export type { OpenRefNuxtOptions, ResolvedNuxtOptions } from './module/domain/module-options';
export {
  generateSite,
  mountDirectoryOf,
} from './generate/application/services/generate-site.service';
export type { GenerateReport } from './generate/application/services/generate-site.service';
export { PublicDirStore } from './generate/infrastructure/adapters/public-dir-store.adapter';
export type { PublicDirStoreOptions } from './generate/infrastructure/adapters/public-dir-store.adapter';
export {
  nitroProxyFile,
  nitroProxyRoute,
  nitroProxySource,
} from './proxy/domain/nitro-proxy-route';
export {
  documentOf,
  loadSpecification,
} from './document/application/services/load-specification.service';
export type { LoadedSpecification } from './document/application/services/load-specification.service';
export type {
  NitroConfigSurface,
  NitroHandlerEntry,
  NitroSurface,
  NuxtModule,
  NuxtSurface,
} from './shared/types/nuxt-surface';
export { servesReference } from './runtime/handler';
export type { EmbeddedSite } from './runtime/site';

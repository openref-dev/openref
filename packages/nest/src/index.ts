import { PACKAGE_NAME as CORE_PACKAGE } from '@openref/core';
import { PACKAGE_NAME as RENDER_PACKAGE } from '@openref/render';
import { PACKAGE_NAME as RUNNER_PACKAGE } from '@openref/runner';
import { PACKAGE_NAME as SEARCH_PACKAGE } from '@openref/search';

/**
 * `@openref/nest`: the package a consumer installs, and the composition point of SPEC 2.
 *
 * It bundles the internal packages, mounts the routes of SPEC 13.3 on a running NestJS
 * application, and builds the browser bundle in which the request runner is bound to the
 * try-it console. Nothing here imports NestJS at runtime; the application is taken as the
 * structural type in `shared/types/nest-surface.ts`, which is what makes SPEC 23's support
 * for NestJS 10 and 11 a single checkable surface.
 */

/**
 * Name of this package.
 *
 * Exported so that the dependency graph linter has a real edge to follow and so that
 * diagnostics can report which package produced a value.
 */
export const PACKAGE_NAME = '@openref/nest';

/**
 * Packages this package is allowed to depend on, in the order declared by STANDARDS 3.5.
 */
export const UPSTREAM_PACKAGES: readonly string[] = [
  CORE_PACKAGE,
  RENDER_PACKAGE,
  RUNNER_PACKAGE,
  SEARCH_PACKAGE,
];

export { OpenRefModule } from './api/openref.module';
export type { OpenRefSetupOptions } from './api/openref.module';

// The full form of SPEC 13.2, from TX-FORROOT. `forRoot` is the entry point that collects
// runtime facts, because it is a module and can therefore be given the container.
export { OPENREF_REFERENCES } from './shared/constants/tokens';
export { MountedReferences } from './api/mounted-references';
export type { MountedReference } from './api/mounted-references';
export { assertRootOptions, readSourceLink } from './api/module-options';
export type {
  OpenRefDocumentOptions,
  OpenRefRootAsyncOptions,
  OpenRefRootOptions,
  OpenRefRuntimeOptions,
  OpenRefSourceLink,
  OpenRefVisibility,
} from './api/module-options';

export { runRuntimePass } from './runtime/application/services/runtime-pass.service';
export type {
  RuntimePassOptions,
  RuntimePassResult,
} from './runtime/application/services/runtime-pass.service';
export {
  discoverRoutes,
  joinPath,
} from './runtime/infrastructure/adapters/controller-discovery.adapter';
export type {
  DiscoveredRoute,
  DiscoveryProblem,
  DiscoveryResult,
} from './runtime/infrastructure/adapters/controller-discovery.adapter';
export { pairRoutes } from './runtime/domain/route-pairing';
export type { PairingProblem, PairingResult } from './runtime/domain/route-pairing';

// The source link of SPEC 6.3, built in T018. The pure half, expanding a template into a URL,
// lives in `@openref/core` so that `render` can reach it too.
export {
  sourceCollector,
  SOURCE_COLLECTOR_NAME,
} from './runtime/infrastructure/collectors/source.collector';
export type {
  SourceCollector,
  SourceCollectorOptions,
  SourceCollectorProblem,
} from './runtime/infrastructure/collectors/source.collector';
export {
  closeFunctionLocator,
  locateFunction,
} from './runtime/infrastructure/adapters/function-location.adapter';
export type {
  FunctionLocation,
  FunctionLocationResult,
} from './runtime/infrastructure/adapters/function-location.adapter';
export {
  findRepositoryRoot,
  resetRepositoryCache,
  resolveGitRef,
} from './runtime/infrastructure/adapters/repository.adapter';
export { repositoryRelative } from './runtime/domain/repository-path';

export { ReferenceService } from './reference/application/services/reference.service';
export type { ReferenceServiceOptions } from './reference/application/services/reference.service';

export {
  assetHref,
  ASSET_PARAM,
  ASSET_SEGMENT,
  HEALTH_SEGMENT,
  NODE_PARAM,
  normalizeRoute,
  referenceRoutes,
  SCHEMA_PARAM,
  SEARCH_INDEX_SEGMENT,
} from './reference/domain/routes';
export type { ReferenceRoute, ReferenceRouteId } from './reference/domain/routes';

export {
  buildAssetCatalog,
  contentTypeFor,
  digestOf,
  DIGEST_LENGTH,
  hashedName,
  rewriteCssUrls,
} from './assets/domain/asset-catalog';
export type { AssetCatalog, AssetSource, CatalogAsset } from './assets/domain/asset-catalog';

export {
  CLIENT_BUNDLE_SPECIFIER,
  DEFAULT_THEME_STYLESHEETS,
  loadDefaultAssets,
  resolveAssetPath,
  siblingReferences,
} from './assets/infrastructure/adapters/package-assets.adapter';
export type {
  AssetPlan,
  DefaultAssetOptions,
} from './assets/infrastructure/adapters/package-assets.adapter';

export {
  failureReply,
  IMMUTABLE,
  NO_STORE,
  notFoundReply,
  REVALIDATE,
  textReply,
} from './http/domain/reply';
export type { ErrorReporter } from './http/domain/reply';
export { readNestedString, readStringRecord } from './http/domain/request-shape';
export type {
  IReferenceHttpAdapter,
  ReferenceHandler,
  ReferenceReply,
  ReferenceRequest,
} from './http/application/ports/reference-http.port';
export {
  ExpressReferenceAdapter,
  writeExpressReply,
} from './http/infrastructure/adapters/express-reference.adapter';
export type {
  NonceReader,
  ReferenceAdapterOptions,
} from './http/infrastructure/adapters/express-reference.adapter';
export {
  FastifyReferenceAdapter,
  writeFastifyReply,
} from './http/infrastructure/adapters/fastify-reference.adapter';
export {
  createReferenceAdapter,
  SUPPORTED_PLATFORMS,
} from './http/infrastructure/adapters/reference-adapter.factory';

export { isNestApplication } from './shared/types/nest-surface';
export {
  NEST_CORE_VALUE_NAMES,
  NEST_REQUEST_METHODS,
  NEST_ROUTE_METADATA,
} from './shared/types/nest-surface';
export type {
  ControllerLike,
  DiscoveryServiceLike,
  DynamicModuleLike,
  HandlerLike,
  HttpAdapterHostLike,
  HttpAdapterLike,
  InstanceWrapperLike,
  ModuleRefLike,
  NestApplicationLike,
  ReflectorLike,
} from './shared/types/nest-surface';

// The collector contract of SPEC 6.2, public API and frozen from T017. A third party writes a
// collector against these names, so any change to them is a major version.
export { isRuntimeCollector, isSkippedCollector } from './runtime/application/ports/collector.port';
export type {
  CollectorContext,
  CollectorRegistration,
  IRuntimeCollector,
  SkippedCollector,
} from './runtime/application/ports/collector.port';
export {
  CollectorRegistry,
  COLLECTOR_HEALTH_CHECK_ID,
} from './runtime/application/services/collector-registry.service';
export type {
  CollectorRegistryOptions,
  CollectorTarget,
} from './runtime/application/services/collector-registry.service';
export { FACT_FIELDS, LIST_FIELDS, mergeContributions } from './runtime/domain/merge';
export type { Contribution } from './runtime/domain/merge';

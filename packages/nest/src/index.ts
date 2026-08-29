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
export { assertRootOptions, isEventsDocument, readSourceLink } from './api/module-options';
export type {
  OpenRefDocumentOptions,
  OpenRefEventsDocumentOptions,
  OpenRefHandedDocumentOptions,
  OpenRefFederationLocalOptions,
  OpenRefFederationOptions,
  OpenRefFederationRemoteOptions,
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

// The event collectors of SPEC 8.3, built in T051. A channel is discovered from the container,
// synthesized into an AsyncAPI 3.1 document, and read by the same normalizer a hand written file
// goes through, so nothing downstream learns which of the two produced it.
export { discoverChannels } from './events/infrastructure/adapters/channel-discovery.adapter';
export type {
  ChannelDiscoveryResult,
  DiscoveredChannel,
  DiscoveredChannelSource,
} from './events/infrastructure/adapters/channel-discovery.adapter';
export { synthesizeEventsDocument } from './events/domain/asyncapi-synthesis';
export type {
  EventServerOptions,
  SynthesizeEventsOptions,
  SynthesizedChannel,
  SynthesizedEvents,
} from './events/domain/asyncapi-synthesis';
export { pairChannels } from './events/domain/channel-pairing';
export type { ChannelPairingResult } from './events/domain/channel-pairing';
export {
  bySeniority,
  declaredValue,
  derived,
  gatewayAddress,
  patternAddress,
  readGateway,
  readMicroserviceHandler,
  readSubscribeMessage,
  DEFAULT_SOCKET_PATH,
  GATEWAY_PROTOCOL,
} from './events/domain/event-metadata';
export type {
  DeclaredValue,
  DerivedValue,
  EventValue,
  GatewayReading,
  MicroserviceReading,
  PatternHandlerKind,
  PatternReading,
  TransportReading,
} from './events/domain/event-metadata';

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
// The metadata collectors of SPEC 6.2.1, built in T019. These three need no third party package,
// which is why they are here and the other three are their own published packages.
export {
  guardsCollector,
  GUARDS_COLLECTOR_NAME,
} from './runtime/infrastructure/collectors/guards.collector';
export type {
  GuardsCollector,
  GuardsCollectorProblem,
} from './runtime/infrastructure/collectors/guards.collector';
export {
  rolesCollector,
  ROLES_COLLECTOR_NAME,
  scopesCollector,
  SCOPES_COLLECTOR_NAME,
} from './runtime/infrastructure/collectors/metadata.collector';
export type {
  MetadataCollector,
  MetadataCollectorOptions,
  MetadataCollectorProblem,
  MetadataCollectorRegistration,
} from './runtime/infrastructure/collectors/metadata.collector';
export { readGuards } from './runtime/domain/guards';
export type { GuardReading } from './runtime/domain/guards';

// The collectors of TX-COLLECTORS, per SPEC 6.2.1: the instruments behind the four parity rows
// that shipped hatched, and the explicit status code behind SP012. None needs a third party
// package; the two that read a host's own metadata take its key and are never given a default.
export {
  pipesCollector,
  PIPES_COLLECTOR_NAME,
} from './runtime/infrastructure/collectors/pipes.collector';
export type {
  PipesCollector,
  PipesCollectorProblem,
} from './runtime/infrastructure/collectors/pipes.collector';
export {
  timeoutCollector,
  TIMEOUT_COLLECTOR_NAME,
} from './runtime/infrastructure/collectors/timeout.collector';
export type {
  TimeoutCollector,
  TimeoutCollectorOptions,
  TimeoutCollectorProblem,
  TimeoutCollectorRegistration,
} from './runtime/infrastructure/collectors/timeout.collector';
export {
  headersCollector,
  HEADERS_COLLECTOR_NAME,
} from './runtime/infrastructure/collectors/headers.collector';
export type {
  HeadersCollector,
  HeadersCollectorOptions,
  HeadersCollectorProblem,
  HeadersCollectorRegistration,
} from './runtime/infrastructure/collectors/headers.collector';
export {
  handlerScanCollector,
  HANDLER_SCAN_COLLECTOR_NAME,
} from './runtime/infrastructure/collectors/handler-scan.collector';
export type {
  HandlerScanCollector,
  HandlerScanProblem,
} from './runtime/infrastructure/collectors/handler-scan.collector';
export {
  httpCodeCollector,
  HTTP_CODE_COLLECTOR_NAME,
} from './runtime/infrastructure/collectors/http-code.collector';
export type {
  HttpCodeCollector,
  HttpCodeCollectorProblem,
} from './runtime/infrastructure/collectors/http-code.collector';
export { readGlobalPipes, readParameterPipes, readRoutePipes } from './runtime/domain/pipes';
export type { PipeReading } from './runtime/domain/pipes';
export { declaredRelationships, withReadConfidence } from './runtime/domain/relationships';
export type {
  ChannelDirectionConfidence,
  DeclaredRelationships,
} from './runtime/domain/relationships';

// The decorators of SPEC 13.4 and the two collectors that read them, built in T020. These are the
// `declared` level of SPEC 6.1: what a person wrote down in order to document the endpoint.
export {
  ApiAudience,
  ApiChannel,
  ApiErrors,
  ApiExample,
  ApiMessage,
  ApiPublishes,
  ApiSample,
  ApiScopes,
  ApiStream,
} from './api/decorators/api-decorators';
export type {
  ApiChannelDirection,
  ApiChannelOptions,
  ApiExampleOptions,
  ApiMessageOptions,
  ApiSampleOptions,
  ApiStreamKind,
  ApiStreamOptions,
} from './api/decorators/api-decorators';
export {
  OPENREF_EXTENSIONS,
  OPENREF_METADATA,
  OPENREF_STREAM_ITEM_METADATA,
} from './api/decorators/metadata';
export type { OpenRefDecorator } from './api/decorators/metadata';
export {
  declarationsCollector,
  DECLARATIONS_COLLECTOR_NAME,
} from './runtime/infrastructure/collectors/declarations.collector';
export type {
  DeclarationsCollector,
  DeclarationsCollectorProblem,
} from './runtime/infrastructure/collectors/declarations.collector';
export {
  streamCollector,
  STREAM_COLLECTOR_NAME,
} from './runtime/infrastructure/collectors/stream.collector';
export type {
  StreamCollector,
  StreamCollectorProblem,
  StreamItemSource,
} from './runtime/infrastructure/collectors/stream.collector';

// The error contracts of SPEC 6.4, built in T021. The collector builds the two groups a person
// writes; the third is derived after the merge by `withRuntimeErrorContracts` in `core`.
export {
  errorsCollector,
  ERRORS_COLLECTOR_NAME,
} from './runtime/infrastructure/collectors/errors.collector';
export type {
  ErrorCatalog,
  ErrorCatalogEntry,
  ErrorsCollector,
  ErrorsCollectorOptions,
  ErrorsCollectorProblem,
} from './runtime/infrastructure/collectors/errors.collector';

// The generic factories of SPEC 13.5, and the registry their bodies live in until the document
// takes them at intake.
export { envelope, paginated } from './schemas/api/generics';
export type {
  EnvelopeOptions,
  SchemaReference,
  SyntheticSchemaOptions,
} from './schemas/api/generics';
export {
  mergeSyntheticSchemas,
  schemaNameOf,
  schemaRef,
  syntheticSchemas,
  SyntheticSchemaRegistry,
} from './schemas/domain/synthetic-schemas';
export type { SchemaBody, SchemaClass, SyntheticSchema } from './schemas/domain/synthetic-schemas';

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
export type {
  OpenRefThemeOptions,
  ProxyOptions,
  ReferenceServiceOptions,
} from './reference/application/services/reference.service';
export { FederatedReferenceService } from './reference/application/services/federated-reference.service';
export type { FederatedReferenceOptions } from './reference/application/services/federated-reference.service';

// The same origin proxy of SPEC 14.5, built in T029. The policy is exported because a host that
// builds its own outbound client still has to answer the same question about an address, and a
// second implementation of it would be a second answer.
export { addressRefusal, isAddressLiteral, parseIpv4, parseIpv6 } from '@openref/core/security';
export type { AddressRefusal } from '@openref/core/security';
export { buildAllowlist, decideTarget } from './proxy/domain/allowlist';
export type { AllowedTarget, ProxyAllowlist, TargetDecision } from './proxy/domain/allowlist';
export {
  forwardableRequestHeaders,
  forwardableResponseHeaders,
  isForwardedHeader,
  proxyLogRecord,
} from './proxy/domain/forwarding';
export type { ForwardingOptions, ProxyLogRecord } from './proxy/domain/forwarding';
export {
  DEFAULT_PROXY_MAX_RESPONSE_BYTES,
  DEFAULT_PROXY_TIMEOUT_MS,
  ProxyService,
} from './proxy/application/services/proxy.service';
export type {
  ProxyRequest,
  ProxyResult,
  ProxyServiceOptions,
} from './proxy/application/services/proxy.service';
export type {
  IAddressResolver,
  IOutboundHttp,
  OutboundRequest,
  OutboundResponse,
} from './proxy/application/ports/proxy-outbound.port';
export { NodeAddressResolver } from './proxy/infrastructure/adapters/node-address-resolver.adapter';
export { NodeOutboundHttp } from './proxy/infrastructure/adapters/node-outbound.adapter';
export { MAX_REQUEST_BODY_BYTES, readRequestBody } from './http/domain/request-body';

export {
  assetHref,
  ASSET_PARAM,
  ASSET_SEGMENT,
  BENCH_SEGMENT,
  FEDERATION_SEGMENT,
  HEALTH_PAGE_SEGMENT,
  NODE_PARAM,
  normalizeRoute,
  PROXY_SEGMENT,
  referenceRoutes,
  SCHEMA_PARAM,
  SEARCH_INDEX_SEGMENT,
  SERVICE_PARAM,
  SERVICE_SEGMENT,
  SHAPES_SEGMENT,
  STATES_SEGMENT,
  STATUS_SEGMENT,
} from './reference/domain/routes';
export type {
  ReferenceRoute,
  ReferenceRouteId,
  ReferenceRouteMethod,
} from './reference/domain/routes';

// THE CATALOG AND THE FILE RESOLVER MOVED TO `@openref/render` AT T039 and are re-exported
// here unchanged, so a host that reached either through this package still finds it where it
// was. They moved because the static build names, rewrites, digests and resolves exactly the
// same files, and `static` may not import this package.
export {
  buildAssetCatalog,
  CLIENT_BUNDLE_SPECIFIER,
  contentTypeFor,
  DEFAULT_THEME_STYLESHEETS,
  digestOf,
  DIGEST_LENGTH,
  hashedName,
  loadDefaultAssets,
  resolveAssetPath,
  rewriteCssUrls,
  siblingReferences,
} from '@openref/render';
export type {
  AssetCatalog,
  AssetPlan,
  AssetSource,
  CatalogAsset,
  DefaultAssetOptions,
} from '@openref/render';

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

export { mountRouteTable } from './api/route-table';
export type { RouteTableMount } from './api/route-table';

// The guard of SPEC 19.6, from TX-VIS. The routes are registered on the http adapter rather than
// on a controller, so NestJS never sees them and no `@UseGuards` applies: the host's guard is
// resolved once at mount and run here, in front of every route the table registers.
export { RouteAdmission, REFUSED_BODY, REFUSED_STATUS } from './visibility/domain/admission';
export type { RouteGate } from './visibility/domain/admission';
export { DEFAULT_VISIBILITY, VISIBILITIES } from './visibility/domain/visibility';
export type { OpenRefVisibilityOptions } from './visibility/domain/visibility';
export {
  admissionFor,
  assertVisibility,
} from './visibility/application/services/admission.service';
export type { GuardResolver } from './visibility/application/services/admission.service';
export {
  OpenRefReferenceRoute,
  referenceRouteHandler,
  synthesizeExecutionContext,
} from './visibility/domain/execution-context';
export type { ReferenceRouteIdentity } from './visibility/domain/execution-context';

export { isNestApplication } from './shared/types/nest-surface';
export {
  isCanActivateLike,
  isHttpExceptionLike,
  NEST_CORE_VALUE_NAMES,
  NEST_REQUEST_METHODS,
  NEST_ROUTE_METADATA,
} from './shared/types/nest-surface';
export type {
  CanActivateLike,
  ControllerLike,
  DiscoveryServiceLike,
  DynamicModuleLike,
  ExecutionContextLike,
  GuardLike,
  HandlerLike,
  HttpAdapterHostLike,
  HttpAdapterLike,
  HttpArgumentsHostLike,
  HttpExceptionLike,
  InstanceWrapperLike,
  ModuleRefLike,
  NestApplicationLike,
  ReflectorLike,
  RpcArgumentsHostLike,
  WsArgumentsHostLike,
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
export {
  FACT_FIELDS,
  GROUPED_FIELDS,
  LIST_FIELDS,
  mergeContributions,
} from './runtime/domain/merge';
export type { Contribution } from './runtime/domain/merge';

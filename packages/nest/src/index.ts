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

// The broker bridge of SPEC 14.8, built in T056, and the surface is the four things a host outside
// this package can have a reason to name. The port, because a host supplies the subscription
// itself: this package ships no broker client and may not choose one. The options and their
// defaults, because a host writes them, which is the `DEFAULT_PROXY_TIMEOUT_MS` and `VISIBILITIES`
// precedent. The service and its result types, because `ReferenceService.bridge` hands one back
// and an unnameable return type is not a usable one.
//
// AND NOT THE LIMITER ITSELF, MEASURED RATHER THAN ASSUMED. The first edition exported the ring,
// the rate gate, the framing, `resolveBridgeOptions` and `assertBridgeOptions` on the proxy
// allowlist's precedent, and the precedent does not reach: `buildAllowlist` is public because a
// host implementing `IOutboundHttp` has to answer the same address question, whereas a host
// implementing `IBridgeSource` hands over a message and answers nothing. Measured over the whole
// workspace, the consumers of those names outside `src/bridge` were this package's own suites and
// nothing else, so they are reached by module path from the tests that measure them and are not
// frozen into a released surface that has no caller.
export { BridgeService } from './bridge/application/services/bridge.service';
export type {
  BridgeCounts,
  BridgeOpenResult,
  BridgeRefusal,
  BridgeServiceOptions,
  BridgeSession,
} from './bridge/application/services/bridge.service';
export type {
  BridgeMessage,
  BridgeSubscription,
  IBridgeSource,
} from './bridge/application/ports/bridge-source.port';
export {
  BRIDGE_OVERFLOW_MODES,
  DEFAULT_BRIDGE_BUFFER_SIZE,
  DEFAULT_BRIDGE_BUFFERED_BYTES,
  DEFAULT_BRIDGE_CONCURRENT_SUBSCRIPTIONS,
  DEFAULT_BRIDGE_CONNECTION_SECONDS,
  DEFAULT_BRIDGE_MESSAGES_PER_SECOND,
  DEFAULT_BRIDGE_OVERFLOW,
  MAX_BRIDGE_CONNECTION_SECONDS,
} from './bridge/domain/bridge-options';
export type { BridgeOptions, BridgeOverflowMode } from './bridge/domain/bridge-options';

// THE AGENT SURFACE OF SPEC 18.1, from T058. What a host names is two booleans, and what a host
// may want to read back is what the mount decided to offer, which is why the service comes out
// through `ReferenceService.agent`. Everything below that line, the JSON-RPC reader, the tool and
// resource builders and the two text builders, stays inside `@openref/agent` and reachable by
// module path: freezing a name that no host calls is what the bridge entry above had to undo.
export { assertAgentOptions } from './agent/domain/agent-mount';
export type { AgentMountOptions } from './agent/domain/agent-mount';
export {
  AgentSurfaceService,
  DEFAULT_AGENT_LLMS_TXT,
  DEFAULT_AGENT_MCP,
  MCP_PROTOCOL_VERSION,
} from '@openref/agent';
export type { AgentOptions, AgentSurfaceOptions, AgentSurfaceReply } from '@openref/agent';

export {
  assertMountsDoNotCollide,
  assetHref,
  collidingMountRoutes,
  ASSET_PARAM,
  ASSET_SEGMENT,
  BENCH_SEGMENT,
  BRIDGE_SEGMENT,
  FEDERATION_SEGMENT,
  HEALTH_PAGE_SEGMENT,
  LLMS_FULL_SEGMENT,
  LLMS_SEGMENT,
  MCP_SEGMENT,
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
  MountAddress,
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
  replyText,
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
// `OpenRefVisibilityOptions` AND NOT THE THREE NAMES T056 SPLIT IT INTO, measured the same way the
// bridge's own surface was. `OpenRefClosedVisibility`, `OpenRefGuardOptions` and
// `OpenRefSetupBaseOptions` are how the two arms of SPEC 14.8's bridge ban are assembled, and a
// host assembles nothing: the closed arm is reached by writing the literal `'internal'` or
// `'partner'`, the guard by writing `guard:` inside the options object, and the base half is not
// separately usable at all, since without a visibility it cannot be passed to `setup`. Zero
// consumers across the workspace outside the two files declaring them, and `WithSetupBase` in the
// same module is the proof that the union works with them internal.
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
export type { Contribution, FactContest, FactField } from './runtime/domain/merge';

// The policy of SPEC 19.2, re-exported so a Nest host can call it from the package it installed.
// THE HOST SETS THE POLICY AND THIS MODULE SETS NO HEADER. Nothing here writes a
// `Content-Security-Policy`; what the reference guarantees is that its own output is compatible
// with the policy this builds. `docs/guide/09-security.md` told a host to send the header and
// named `@openref/render`, which is internal and not installable, so the instruction had no way to
// be followed. Added at T064 with the rename that made the verb say who does what.
export { buildContentSecurityPolicy } from '@openref/render';

// THE IR TYPES THIS PACKAGE'S OWN PUBLIC SIGNATURES NAME, so a collector author installs one
// package. SPEC 4 records the decision and SPEC 6.2 describes the contract these serve.
//
// IT IS THE `T031-R1` DEFECT ARRIVING FROM THE OTHER SIDE. There it was a theme author, whose
// slot props were declared in IR types `@openref/vue` did not re-export, so typing what they were
// handed cost a second package. Here it is a collector author: `IRuntimeCollector.collect` returns
// `IRNodeRuntime`, `CollectorContext.node` is an `IRNode`, and `fact` is typed in `IRConfidence`
// and `IRFact`. None of them was reachable from here, so writing the return annotation the
// contract asks for installed `@openref/core` for one type name, and not writing it left an
// ecosystem collector leaning on contextual typing from a return position.
//
// MEASURED FROM THE ARTEFACT RATHER THAN FROM THIS FILE, which is how `T031-R1` measured the theme
// side and is the only reading that cannot miss one. `packages/nest/dist/index.d.ts` imports
// exactly these eleven names from `@openref/core`, and the case that pins it re-derives the list
// from the built declaration rather than repeating it, so a twelfth name appearing in a public
// signature fails rather than passing unnoticed.
//
// IT WAS NINE UNTIL THE DECLARATION STOPPED HIDING TWO OF THEM, and the order of the two findings
// is the point. While `dts` left `@openref/federation` as an external specifier, the federation
// declarations were not inlined, so `IRInfo` and `IRRelationshipEndpointKind` never reached this
// file's import line: nine was an honest reading of a dishonest artefact. Inlining the four private
// packages, which is what stopped the published declaration naming packages a consumer cannot
// install, made the same measurement say eleven. Both are reachable from types already re-exported
// here rather than from internals alone, checked against `@openref/core`: `IRDocument.info` is an
// `IRInfo`, and `IRRelationship.fromKind` and `.toKind` are `IRRelationshipEndpointKind`. So a
// consumer holding an `IRDocument` from this package and naming its header installed
// `@openref/core` for that one name, which is the defect this whole block exists to close.
//
// A NAME ADDED HERE IS A MINOR VERSION AND A NAME REMOVED IS A MAJOR ONE, per `PUBLIC-API.md`.
// That asymmetry is the whole price of the decision.
export type {
  IRConfidence,
  IRDocument,
  IRFact,
  IRHealthCheck,
  IRInfo,
  IRNode,
  IRNodeRuntime,
  IRRelationship,
  IRRelationshipEndpointKind,
  IRRuntimeMeta,
  IRServer,
} from '@openref/core';

// THE ERROR CLASSES A CONSUMER OF THIS PACKAGE CAN BE HANDED, RE-EXPORTED SO THEY CAN CATCH THEM.
// ADDED 2026-09-02. Until then this package exported none, while dozens of `@throws` tags in this
// same declaration file named them: a consumer read `@throws {InvalidOptionsError}` beside
// `OpenRefModule.setup`, and could not import the name to write the `catch`. The workaround was a
// second dependency on `@openref/core` for a class this package throws, which is a dependency the
// error rule made necessary and nothing made discoverable.
//
// IDENTITY, WHICH IS THE HALF A RE-EXPORT COULD HAVE GOT WRONG. `@openref/core` is a real runtime
// dependency here and is not bundled into `dist/index.js`, so these are the same constructors the
// throw sites use and `instanceof` answers true. A bundled copy would have exported classes that
// no thrown error is ever an instance of, which is worse than exporting none, and it is why the
// pin packs the tarballs and checks a caught error rather than checking that a name exists.
//
// THE SET IS EVERY CLASS THIS PACKAGE OR ITS BUNDLED INTERNALS CAN RAISE, PLUS EVERY BASE ABOVE
// ONE, so `catch (e) { if (e instanceof ConfigError) }` works as well as the leaf. `OpenRefError`
// is here for the same reason: it is how a consumer catches anything this package raises.
export {
  ConfigError,
  ErrorCode,
  FederationError,
  InvalidOptionsError,
  MergeConflictError,
  NormalizeError,
  OpenRefError,
  ProxyBlockedError,
  RemoteUnavailableError,
  RunnerError,
} from '@openref/core';

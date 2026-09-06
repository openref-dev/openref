/**
 * `@openref/core`: the intermediate representation, canonical serialization and hashing.
 *
 * This package is pure. It imports nothing from NestJS, Vue or the DOM, so it can be tested
 * against a corpus of external specifications with no runtime at all.
 */

/**
 * Name of this package.
 *
 * Exported so that the dependency graph linter has a real edge to follow and so that
 * diagnostics can report which package produced a value.
 */
export const PACKAGE_NAME = '@openref/core';

/**
 * Version of the intermediate representation produced by this package.
 *
 * Bumped only when the IR shape changes in a way that invalidates a stored hash.
 *
 * 2, TX-SHAPES: the normalizer carries `if`, `then`, `else` and `dependentRequired` instead
 * of dropping them, so a document that writes them normalizes to a different IR and a
 * different hash than it did under 1.
 *
 * 3, 2026-09-01: canonical serialization stopped sorting the keys of a map whose order the
 * document wrote, per SPEC 5.3. THE IR DID NOT CHANGE SHAPE AND THAT IS WHY THE NUMBER HAS TO
 * MOVE: nothing a consumer compiles against is different, and the digest printed on every
 * document is, so a cache keyed on the hash would answer for a property order it no longer
 * describes unless the key's namespace moves with it.
 */
export const IR_VERSION = 3;

export type { IRConfidence, IRFact } from './ir/domain/confidence.types';

export type {
  IRDiscriminator,
  IRJsonSchema,
  IRJsonSchemaType,
  IRJsonValue,
  IRSchema,
  IRSchemaDialect,
  IRSchemaSlot,
  IRSchemaVariant,
  IRSchemaView,
} from './ir/domain/schema.types';

export type {
  IRChannel,
  IRChannelDirection,
  IRChannelOperation,
  IRChannelParameter,
  IRChannelReply,
  IRCodeSample,
  IRCodeSampleLanguage,
  IRCodeSampleNote,
  IRCodeSampleRefusal,
  IREncoding,
  IRExample,
  IRHeader,
  IRHttpMethod,
  IRMediaType,
  IRMessage,
  IRNode,
  IROperation,
  IRParameter,
  IRParameterLocation,
  IRParameterStyle,
  IRRequestBody,
  IRResponse,
  IRSecurityRequirement,
  IRServerOverride,
  IRStandardHttpMethod,
} from './ir/domain/node.types';
export { AUDIENCE_EXTENSION, INTERNAL_AUDIENCE, isInternalAudience } from './ir/domain/audience';
export { pageNode, pageNodes } from './ir/domain/page-nodes';

export type {
  IRDiscoveryProblem,
  IRDriftAssertion,
  IRDriftBasis,
  IRDriftBucket,
  IRDriftClassification,
  IRDriftEdit,
  IRDriftIssue,
  IRDriftManualReason,
  IRDriftRule,
  IRDriftSeverity,
  IRErrorContract,
  IRErrorContractOrigin,
  IRErrorContracts,
  IRGuard,
  IRGuardScope,
  IRNodeRuntime,
  IRParameterRead,
  IRParameterReads,
  IRParameterReadVerdict,
  IRPipe,
  IRPipeScope,
  IRRateLimit,
  IRRateLimitReach,
  IRRuntimeMeta,
  IRSourceLocation,
  IRStreaming,
  IRStreamTransport,
  IRTimeout,
} from './ir/domain/runtime.types';

export type { IRHealthCheck, IRHealthReport } from './ir/domain/health.types';

export type {
  IRRelationship,
  IRRelationshipEndpointKind,
  IRRelationshipType,
} from './ir/domain/relationship.types';

export type {
  IRTopology,
  IRTopologyEdge,
  IRTopologyEndpoint,
  IRTopologyGroup,
} from './topology/domain/topology';
export { buildTopology } from './topology/domain/topology';
export { orderRelationships } from './topology/domain/relationships';

export type {
  IRContact,
  IRDocument,
  IRUnreadKey,
  IRUnreadKeyPosition,
  IRDocumentKind,
  IRInfo,
  IRLicense,
  IRNavNode,
  IRNavNodeKind,
  IROAuthFlow,
  IROAuthFlows,
  IRSecurityScheme,
  IRSecuritySchemeType,
  IRServer,
  IRServerVariable,
  IRService,
} from './ir/domain/document.types';

export {
  CANONICAL_MAX_DEPTH,
  canonicalize,
  compareByCodePoint,
  normalizeNumber,
  quoteString,
} from './hashing/domain/canonical';
export { finalizeDocument, hash, hashDocument } from './hashing/domain/hash';
export { freezeDocument } from './ir/domain/freeze';
export { sha256Hex, utf8Encode } from './hashing/domain/sha256';
export { caseFoldForFilesystem } from './security/domain/case-fold';
export { addressRefusal, isAddressLiteral, parseIpv4, parseIpv6 } from './security/domain/address';
export type { AddressRefusal } from './security/domain/address';
export { refusesPathSuffix } from './security/domain/path-suffix';
export {
  DOCUMENT_LINK_SCHEMES,
  HTTP_SCHEMES,
  isHttpUrl,
  isSecureCredentialUrl,
  LOOPBACK_HOSTS,
} from './security/domain/schemes';
export type { HttpScheme } from './security/domain/schemes';
export {
  BIDI_CONTROL_CODE_POINTS,
  carriesControlCharacters,
  plainArtefactText,
  oneLine,
} from './security/domain/plain-text';

export {
  ApplicationBootError,
  AuthError,
  CliError,
  CollectorError,
  CollectorNotAvailableError,
  ConfigError,
  CycleDepthError,
  FederationError,
  InvalidOptionsError,
  MergeConflictError,
  MetadataKeyMissingError,
  NormalizeError,
  OpenRefError,
  ProxyBlockedError,
  RefResolutionError,
  RemoteUnavailableError,
  RunnerError,
  SerializationError,
  ShutdownTimeoutError,
  SlotNotFoundError,
  StreamError,
  ThemeContractError,
  ThemeError,
  UnsupportedDialectError,
  UsageError,
} from './shared/errors/index';
// REACHED FROM HERE AND NOT THROUGH `shared/errors/index`, AND THE EDGE IS THE POINT. A re-export
// there makes the codes module a dependency of the module that declares the error classes, which
// every rendered page reaches, so the bundler puts the thirty member object in the chunk the first
// paint downloads for the sake of one deferred reader. Named here, the module is reached only by
// whoever reads a code. Measured: 111,921 raw with the edge against 110,559 without it.
export { ErrorCode } from './shared/errors/codes';

export { intersectTypes, mergeAllOf, mergeRequired } from './normalizer/domain/compose';
export {
  asBoolean,
  asJsonSchemaType,
  asJsonValue,
  asNumber,
  asString,
  asStringArray,
  asStringRecord,
  isPlainObject,
  isUnknownArray,
} from './normalizer/domain/guards';
export {
  parseJsonPointer,
  parseReference,
  resolveJsonPointer,
  schemaNameFromReference,
} from './normalizer/domain/json-pointer';
export type { ParsedReference } from './normalizer/domain/json-pointer';
export {
  DEFAULT_CYCLE_DEPTH,
  DEFAULT_MAX_SCHEMA_NESTING,
  MAX_NORMALIZE_RECURSION,
  normalizeSchema,
  normalizeSchemaGraph,
} from './normalizer/domain/schema-normalizer';
export type {
  NormalizedSchemaGraph,
  NormalizeSchemaOptions,
} from './normalizer/domain/schema-normalizer';
export {
  createSchemaRegistry,
  NAMED_SCHEMA_POINTER_PREFIX,
  schemaIdForReference,
  schemaNameFromId,
  federatedSchemaId,
  isFederationServiceId,
} from './normalizer/domain/schema-registry';
export type { SchemaRegistry } from './normalizer/domain/schema-registry';
export { applyView, toRequestView, toResponseView } from './normalizer/domain/views';
export { MAX_SPECIFICATION_LENGTH, parseSpecification } from './normalizer/domain/parse';
export type { ParseSpecificationOptions } from './normalizer/domain/parse';
export {
  assignOperationIdentities,
  isGeneratedOperationId,
  isStandardHttpMethod,
  operationNodeId,
  pathSlug,
  STANDARD_HTTP_METHODS,
} from './normalizer/domain/operation-identity';
export type {
  OperationIdentity,
  OperationIdentityInput,
} from './normalizer/domain/operation-identity';
export { buildNavigation } from './normalizer/domain/navigation';
export type { BuildNavigationOptions, NavigationTag } from './normalizer/domain/navigation';
export {
  DEFAULT_SERVER_URL,
  normalizeOpenApiDocument,
} from './normalizer/domain/openapi-normalizer';
export type { NormalizeOpenApiOptions } from './normalizer/domain/openapi-normalizer';
export { normalizeAsyncApiDocument } from './normalizer/domain/asyncapi-normalizer';
export type { NormalizeAsyncApiOptions } from './normalizer/domain/asyncapi-normalizer';
export { isAsyncApiSource, normalizeSpecification } from './normalizer/domain/reader';
export type { NormalizeSpecificationOptions } from './normalizer/domain/reader';
export {
  buildSchema,
  dialectFromSchemaFormat,
  isJsonSchemaCompatible,
  JSON_SCHEMA_DIALECTS,
  normalizeSchemaFormat,
} from './normalizer/domain/dialect';
export type { SchemaSource } from './normalizer/domain/dialect';

export {
  ARRAY_EXAMPLE_LENGTH,
  generateExample,
  MAX_EXAMPLE_DEPTH,
} from './examples/domain/example-generator';
export type { GenerateExampleOptions } from './examples/domain/example-generator';
export {
  numberForFieldName,
  numberForFormat,
  splitFieldName,
  stringForFieldName,
  stringForFormat,
} from './examples/domain/field-heuristics';
export { isSafePattern, matchesPattern, sampleFromPattern } from './examples/domain/pattern';

export { expandSourceLink } from './source-link/domain/source-link';
export type { SourceLinkExpansion } from './source-link/domain/source-link';

export { handshakeBlockedCause, unsendableSchemeCause } from './security/domain/scheme-support';
export type {
  HandshakeBlockedCause,
  SecuritySchemeShape,
  UnsendableCause,
} from './security/domain/scheme-support';

export { classifyDrift, isMechanicallyFixable } from './drift/domain/classification';
export {
  DTO_FIELD_RULE,
  MAX_DTO_FIELD_DEPTH,
  OPERATION_DRIFT_RULES,
  operationRuleOutcome,
  runDriftRules,
} from './drift/domain/drift-rules';
export type {
  DriftObservation,
  OperationRuleOutcome,
  RuleResult,
} from './drift/domain/drift-rules';
export { DRIFT_RULE_CODES } from './drift/domain/rule-codes';
export {
  buildHealthReport,
  collectDrift,
  driftForNode,
  groupDriftByCause,
  groupDriftByRule,
  healthScore,
} from './drift/domain/health';
export type { DriftCauseGroup, DriftRuleGroup, HealthReportOptions } from './drift/domain/health';
export {
  buildDoctorReport,
  DOCTOR_REPORT_VERSION,
  readDoctorReport,
} from './drift/domain/doctor-report';
export type {
  DoctorReportRead,
  IRDoctorCheck,
  IRDoctorFinding,
  IRDoctorReport,
} from './drift/domain/doctor-report';
export { proxyServers } from './ir/domain/proxy-servers';
export { buildDiffReport } from './diff/domain/diff-report';
export type {
  IRDiffChange,
  IRDiffChangeKind,
  IRDiffClassification,
  IRDiffReport,
} from './diff/domain/diff-report';

export {
  hasRuntimeFacts,
  observedFactCollectors,
  RUNTIME_FACT_COLLECTORS,
  RUNTIME_FACT_FIELDS,
  runtimeInstrument,
} from './runtime/domain/runtime-view';
export type { RuntimeFactField, RuntimeInstrument } from './runtime/domain/runtime-view';

export {
  deriveRuntimeErrorContracts,
  EMPTY_ERROR_CONTRACTS,
  errorContractGroup,
  groupErrorContracts,
  hasErrorContracts,
  problemDetailsSchema,
  PROBLEM_JSON_MEDIA_TYPE,
  withRuntimeErrorContracts,
} from './error-contracts/domain/error-contracts';

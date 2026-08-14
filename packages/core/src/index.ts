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
 */
export const IR_VERSION = 1;

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
  IRCodeSample,
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

export type {
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
  IRRateLimit,
  IRRuntimeMeta,
  IRSourceLocation,
  IRStreaming,
  IRStreamTransport,
} from './ir/domain/runtime.types';

export type { IRHealthCheck, IRHealthReport } from './ir/domain/health.types';

export type { IRRelationship, IRRelationshipType } from './ir/domain/relationship.types';

export type {
  IRContact,
  IRDocument,
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

export {
  AuthError,
  CollectorError,
  CollectorNotAvailableError,
  ConfigError,
  CycleDepthError,
  ErrorCode,
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
  SlotNotFoundError,
  StreamError,
  ThemeContractError,
  ThemeError,
  UnsupportedDialectError,
} from './shared/errors/index';

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

export { unsendableSchemeCause } from './security/domain/scheme-support';
export type { SecuritySchemeShape, UnsendableCause } from './security/domain/scheme-support';

export { classifyDrift, isMechanicallyFixable } from './drift/domain/classification';
export {
  DTO_FIELD_RULE,
  MAX_DTO_FIELD_DEPTH,
  OPERATION_DRIFT_RULES,
  runDriftRules,
} from './drift/domain/drift-rules';
export type { DriftObservation, RuleResult } from './drift/domain/drift-rules';
export {
  buildHealthReport,
  collectDrift,
  driftForNode,
  groupDriftByRule,
  healthScore,
} from './drift/domain/health';
export type { DriftRuleGroup, HealthReportOptions } from './drift/domain/health';

export { hasRuntimeFacts, RUNTIME_FACT_FIELDS } from './runtime/domain/runtime-view';
export type { RuntimeFactField } from './runtime/domain/runtime-view';

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

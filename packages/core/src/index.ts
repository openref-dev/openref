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
} from './ir/domain/node.types';

export type {
  IRDriftIssue,
  IRDriftRule,
  IRDriftSeverity,
  IRErrorContract,
  IRErrorContractOrigin,
  IRGuard,
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
  canonicalize,
  compareByCodePoint,
  normalizeNumber,
  quoteString,
} from './hashing/domain/canonical';
export { hash, hashDocument } from './hashing/domain/hash';
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
export { DEFAULT_CYCLE_DEPTH, normalizeSchema } from './normalizer/domain/schema-normalizer';
export type { NormalizeSchemaOptions } from './normalizer/domain/schema-normalizer';
export { applyView, toRequestView, toResponseView } from './normalizer/domain/views';

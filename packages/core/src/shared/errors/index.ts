/**
 * Error hierarchy for the whole project, per STANDARDS 8.
 *
 * Every error extends {@link OpenRefError}, carries an {@link ErrorCode} and never swallows
 * its cause. Codes follow `{DOMAIN}_{SPECIFIC}`.
 */

/**
 * Stable machine readable error codes.
 *
 * A code is part of the observable surface of the CLI and of `doctor` output, so a code is
 * renamed only with a major version.
 */
export enum ErrorCode {
  /** A `$ref` could not be resolved to a target. */
  NORM_REF_UNRESOLVED = 'NORM_REF_UNRESOLVED',
  /** A `$ref` is not a well formed pointer, so there is no target to look for. */
  NORM_REF_MALFORMED = 'NORM_REF_MALFORMED',
  /** A cyclic schema exceeded the configured cycle depth. */
  NORM_CYCLE_DEPTH_EXCEEDED = 'NORM_CYCLE_DEPTH_EXCEEDED',
  /** The document declares a schema dialect the common pipeline cannot process. */
  NORM_UNSUPPORTED_DIALECT = 'NORM_UNSUPPORTED_DIALECT',
  /** A value reached canonical serialization that has no deterministic representation. */
  NORM_VALUE_NOT_SERIALIZABLE = 'NORM_VALUE_NOT_SERIALIZABLE',
  /** Two `allOf` branches describe a schema nothing can satisfy. */
  NORM_COMPOSITION_CONFLICT = 'NORM_COMPOSITION_CONFLICT',
  /** The document itself is malformed beyond repair. */
  NORM_DOCUMENT_INVALID = 'NORM_DOCUMENT_INVALID',
  /** The document is larger than intake will read, per SPEC 5.4. */
  NORM_DOCUMENT_TOO_LARGE = 'NORM_DOCUMENT_TOO_LARGE',
  /** Two different `$ref` targets are filed under one schema id, so one would be lost. */
  NORM_SCHEMA_ID_COLLISION = 'NORM_SCHEMA_ID_COLLISION',
  /**
   * A value nests deeper than the declared limit, in normalization or in canonical
   * serialization. Declared rather than inherited from the call stack, per SPEC 5.3.
   */
  NORM_DEPTH_EXCEEDED = 'NORM_DEPTH_EXCEEDED',

  /** A collector failed while gathering runtime facts. */
  COLLECT_FAILED = 'COLLECT_FAILED',
  /** An optional package a collector depends on is not installed. */
  COLLECT_NOT_AVAILABLE = 'COLLECT_NOT_AVAILABLE',
  /** A collector was configured without the metadata key it reads. */
  COLLECT_METADATA_KEY_MISSING = 'COLLECT_METADATA_KEY_MISSING',

  /** A request could not be serialized from the given parameter values. */
  RUN_SERIALIZATION_FAILED = 'RUN_SERIALIZATION_FAILED',
  /** Authentication could not be applied to the request. */
  RUN_AUTH_FAILED = 'RUN_AUTH_FAILED',
  /** The proxy refused the target host. */
  RUN_PROXY_HOST_BLOCKED = 'RUN_PROXY_HOST_BLOCKED',
  /** A stream ended abnormally. */
  RUN_STREAM_FAILED = 'RUN_STREAM_FAILED',
  /** The runner or the socket client was called in a build that does not carry one yet. */
  RUN_NOT_AVAILABLE = 'RUN_NOT_AVAILABLE',
  /** The server did not answer inside the configured limit, per SPEC 14.1. */
  RUN_TIMEOUT = 'RUN_TIMEOUT',
  /** The response body is larger than the console can hold or show, per SPEC 14.1. */
  RUN_RESPONSE_TOO_LARGE = 'RUN_RESPONSE_TOO_LARGE',

  /** A federated remote could not be reached. */
  FED_REMOTE_UNAVAILABLE = 'FED_REMOTE_UNAVAILABLE',
  /** Two remotes contributed conflicting definitions. */
  FED_MERGE_CONFLICT = 'FED_MERGE_CONFLICT',

  /** A theme does not satisfy the theme contract. */
  THEME_CONTRACT_VIOLATED = 'THEME_CONTRACT_VIOLATED',
  /** A theme referenced a slot that does not exist. */
  THEME_SLOT_NOT_FOUND = 'THEME_SLOT_NOT_FOUND',

  /** Options handed to a module or to the CLI are invalid. */
  CONFIG_INVALID_OPTIONS = 'CONFIG_INVALID_OPTIONS',
}

/**
 * Base class for every OPENREF error.
 *
 * @example
 * throw new NormalizeError('cycle depth exceeded', ErrorCode.NORM_CYCLE_DEPTH_EXCEEDED);
 */
export class OpenRefError extends Error {
  /** When the error was constructed. */
  public readonly timestamp: Date;

  /**
   * @param message - Human readable description, safe to log
   * @param code - Stable machine readable code
   * @param cause - Underlying error, kept rather than swallowed
   * @param context - Structured detail; never put credentials or request bodies here
   */
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public override readonly cause?: Error,
    public readonly context?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = new.target.name;
    this.timestamp = new Date();

    // V8 exposes captureStackTrace; other engines do not, and core runs in the browser too.
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, new.target);
    }
  }
}

/** The specification could not be normalized. The normalizer is fail closed. */
export class NormalizeError extends OpenRefError {}

/** A `$ref` could not be resolved. */
export class RefResolutionError extends NormalizeError {}

/** A cyclic schema exceeded the configured depth. */
export class CycleDepthError extends NormalizeError {}

/** The schema dialect is not supported by the common pipeline. */
export class UnsupportedDialectError extends NormalizeError {}

/** A runtime collector failed. Collectors are fail open; the caller decides. */
export class CollectorError extends OpenRefError {}

/** An optional package the collector depends on is absent. */
export class CollectorNotAvailableError extends CollectorError {}

/** A collector was configured without the metadata key it reads. */
export class MetadataKeyMissingError extends CollectorError {}

/** The request runner failed. */
export class RunnerError extends OpenRefError {}

/** Parameter or body serialization failed. */
export class SerializationError extends RunnerError {}

/** Authentication could not be applied. */
export class AuthError extends RunnerError {}

/** The proxy refused the target. The proxy is fail closed. */
export class ProxyBlockedError extends RunnerError {}

/** A stream ended abnormally. */
export class StreamError extends RunnerError {}

/** Federation failed. */
export class FederationError extends OpenRefError {}

/** A remote could not be reached. */
export class RemoteUnavailableError extends FederationError {}

/** Two remotes contributed conflicting definitions. */
export class MergeConflictError extends FederationError {}

/** A theme violated its contract. */
export class ThemeError extends OpenRefError {}

/** A theme does not satisfy the theme contract. */
export class ThemeContractError extends ThemeError {}

/** A theme referenced a slot that does not exist. */
export class SlotNotFoundError extends ThemeError {}

/** Configuration is invalid. */
export class ConfigError extends OpenRefError {}

/** Options handed to a module or to the CLI are invalid. */
export class InvalidOptionsError extends ConfigError {}

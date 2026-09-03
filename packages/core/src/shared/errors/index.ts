/**
 * Error hierarchy for the whole project, per STANDARDS 8.
 *
 * Every error extends {@link OpenRefError}, carries an {@link ErrorCode} and never swallows
 * its cause. Codes follow `{DOMAIN}_{SPECIFIC}`.
 */

import type { ErrorCode } from './codes';

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

/** The CLI could not do what it was asked. */
export class CliError extends OpenRefError {}

/** `--from-nest` could not produce a document. */
export class ApplicationBootError extends CliError {}

/** The command line itself was invalid, independent of any document. */
export class UsageError extends CliError {}

/** The loaded application did not close within its allotted time and was terminated. */
export class ShutdownTimeoutError extends CliError {}

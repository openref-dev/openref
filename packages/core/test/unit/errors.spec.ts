import { describe, expect, it } from 'vitest';
import {
  ApplicationBootError,
  AuthError,
  CliError,
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
  ShutdownTimeoutError,
  SlotNotFoundError,
  StreamError,
  ThemeContractError,
  ThemeError,
  UnsupportedDialectError,
  UsageError,
} from '../../src/index';

describe('OpenRefError', () => {
  it('should carry its code, cause and context', () => {
    // Given
    const cause = new Error('underlying');
    const context = { path: '#/components/schemas/Order' };

    // When
    const error = new NormalizeError(
      'could not resolve',
      ErrorCode.NORM_REF_UNRESOLVED,
      cause,
      context,
    );

    // Then
    expect(error.code).toBe(ErrorCode.NORM_REF_UNRESOLVED);
    expect(error.cause).toBe(cause);
    expect(error.context).toEqual(context);
    expect(error.message).toBe('could not resolve');
  });

  it('should name itself after its own class rather than after the base', () => {
    // Given
    const error = new RefResolutionError('missing', ErrorCode.NORM_REF_UNRESOLVED);

    // When
    const name = error.name;

    // Then
    expect(name).toBe('RefResolutionError');
  });

  it('should stamp a timestamp', () => {
    // Given
    const before = Date.now();

    // When
    const error = new ConfigError('bad options', ErrorCode.CONFIG_INVALID_OPTIONS);

    // Then
    expect(error.timestamp.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('should be catchable as an Error and as an OpenRefError', () => {
    // Given
    const error = new StreamError('stream ended', ErrorCode.RUN_STREAM_FAILED);

    // When
    const checks = [error instanceof Error, error instanceof OpenRefError];

    // Then
    expect(checks).toEqual([true, true]);
  });

  it('should carry a stack trace', () => {
    // Given
    const error = new AuthError('no credentials', ErrorCode.RUN_AUTH_FAILED);

    // When
    const stack = error.stack;

    // Then
    expect(stack).toBeTypeOf('string');
    expect(stack).toContain('AuthError');
  });

  it('should leave cause and context undefined when they are not given', () => {
    // Given
    const error = new CollectorError('collector failed', ErrorCode.COLLECT_FAILED);

    // When
    const values = [error.cause, error.context];

    // Then
    expect(values).toEqual([undefined, undefined]);
  });
});

describe('error hierarchy', () => {
  it('should place every leaf under the domain error it belongs to', () => {
    // Given
    const leaves = [
      { error: new RefResolutionError('m', ErrorCode.NORM_REF_UNRESOLVED), parent: NormalizeError },
      {
        error: new CycleDepthError('m', ErrorCode.NORM_CYCLE_DEPTH_EXCEEDED),
        parent: NormalizeError,
      },
      {
        error: new UnsupportedDialectError('m', ErrorCode.NORM_UNSUPPORTED_DIALECT),
        parent: NormalizeError,
      },
      {
        error: new CollectorNotAvailableError('m', ErrorCode.COLLECT_NOT_AVAILABLE),
        parent: CollectorError,
      },
      {
        error: new MetadataKeyMissingError('m', ErrorCode.COLLECT_METADATA_KEY_MISSING),
        parent: CollectorError,
      },
      {
        error: new SerializationError('m', ErrorCode.RUN_SERIALIZATION_FAILED),
        parent: RunnerError,
      },
      { error: new AuthError('m', ErrorCode.RUN_AUTH_FAILED), parent: RunnerError },
      { error: new ProxyBlockedError('m', ErrorCode.RUN_PROXY_HOST_BLOCKED), parent: RunnerError },
      { error: new StreamError('m', ErrorCode.RUN_STREAM_FAILED), parent: RunnerError },
      {
        error: new RemoteUnavailableError('m', ErrorCode.FED_REMOTE_UNAVAILABLE),
        parent: FederationError,
      },
      { error: new MergeConflictError('m', ErrorCode.FED_MERGE_CONFLICT), parent: FederationError },
      { error: new ThemeContractError('m', ErrorCode.THEME_CONTRACT_VIOLATED), parent: ThemeError },
      { error: new SlotNotFoundError('m', ErrorCode.THEME_SLOT_NOT_FOUND), parent: ThemeError },
      {
        error: new InvalidOptionsError('m', ErrorCode.CONFIG_INVALID_OPTIONS),
        parent: ConfigError,
      },
      { error: new ApplicationBootError('m', ErrorCode.CLI_BOOT_FAILED), parent: CliError },
      { error: new UsageError('m', ErrorCode.CLI_USAGE_INVALID), parent: CliError },
      {
        error: new ShutdownTimeoutError('m', ErrorCode.CLI_SHUTDOWN_TIMEOUT),
        parent: CliError,
      },
    ];

    // When
    const misplaced = leaves.filter(
      (leaf) => !(leaf.error instanceof leaf.parent) || !(leaf.error instanceof OpenRefError),
    );

    // Then
    expect(misplaced).toEqual([]);
  });

  it('should keep the domain errors distinct from each other', () => {
    // Given
    const normalize = new NormalizeError('m', ErrorCode.NORM_DOCUMENT_INVALID);

    // When
    const checks = [normalize instanceof RunnerError, normalize instanceof FederationError];

    // Then
    expect(checks).toEqual([false, false]);
  });
});

describe('ErrorCode', () => {
  it('should give every code a value equal to its name, so logs read the same as the source', () => {
    // Given
    const entries: readonly [string, string][] = Object.entries(ErrorCode);

    // When
    const mismatched = entries.filter(([name, value]) => name !== value);

    // Then
    expect(mismatched).toEqual([]);
  });

  it('should prefix every code with a domain', () => {
    // Given
    const codes = Object.values(ErrorCode);

    // When
    const malformed = codes.filter(
      (code) => !/^(NORM|COLLECT|RUN|FED|THEME|CONFIG|CLI)_[A-Z_]+$/.test(code),
    );

    // Then
    expect(malformed).toEqual([]);
  });
});

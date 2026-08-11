import { PACKAGE_NAME as CORE_PACKAGE } from '@openref/core';

/**
 * Name of this package.
 *
 * Exported so that the dependency graph linter has a real edge to follow and so that
 * diagnostics can report which package produced a value.
 */
export const PACKAGE_NAME = '@openref/runner';

/**
 * Packages this package is allowed to depend on, in the order declared by STANDARDS 3.5.
 */
export const UPSTREAM_PACKAGES: readonly string[] = [CORE_PACKAGE];

export {
  assertRequired,
  assertRunnable,
  encodeValue,
  parameterKey,
  type RunnableParameter,
} from './request/domain/parameters';

export {
  buildRequest,
  isJsonMediaType,
  joinUrl,
  type AuthContribution,
  type RequestInputs,
  type RequestPlan,
  type RunnableOperation,
  type RunnableSecurityScheme,
} from './request/domain/request-plan';

export {
  applyCredentials,
  CredentialStore,
  CREDENTIAL_KEY_PREFIX,
  DEFAULT_CREDENTIAL_STORAGE,
  type CredentialStorageMode,
  type KeyValueStorage,
} from './auth/domain/credentials';

export type {
  IHttpTransport,
  TransportResponse,
} from './send/application/ports/http-transport.port';

export {
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  FetchHttpTransport,
  type FetchLike,
  type FetchResponseLike,
  type FetchTransportOptions,
  type ResponseStreamLike,
} from './send/infrastructure/adapters/fetch-transport.adapter';

export {
  createRunner,
  RequestRunner,
  type PrefilledCredentials,
  type RunHeader,
  type RunResult,
  type RunnerOptions,
  type RunnerSendInput,
  type RunnerVisibility,
} from './send/application/services/runner.service';

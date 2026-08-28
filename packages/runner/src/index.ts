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

export { assertRequired, parameterKey, type RunnableParameter } from './request/domain/parameters';

export {
  assertCellDefined,
  encodeValue,
  serializeParameter,
  type RunnerValue,
  type RunnerValueKind,
  type SerializableParameter,
  type SerializedParameter,
} from './request/domain/serialize';

export {
  buildRequest,
  joinUrl,
  DEFAULT_BOUNDARY,
  type AuthContribution,
  type OAuthFlowKind,
  type RunnableOAuthFlow,
  type RequestInputs,
  type RequestPlan,
  type RunnableBodyMediaType,
  type RunnableOperation,
  type RunnableStream,
  type RunnableSecurityScheme,
} from './request/domain/request-plan';

export {
  serializeBody,
  formEncode,
  payloadByteLength,
  utf8Length,
  isFormUrlencoded,
  isJsonMediaType,
  isMultipart,
  isNdjsonMediaType,
  isTextualMediaType,
  DEFAULT_MAX_BODY_BYTES,
  type BodyBytes,
  type BodyEditor,
  type BodySerializationOptions,
  type RunnerBody,
  type RunnerBodyField,
  type RunnerFile,
  type SerializedBody,
} from './request/domain/body';

export {
  applyCredentials,
  CredentialStore,
  CREDENTIAL_KEY_PREFIX,
  DEFAULT_CREDENTIAL_STORAGE,
  type CredentialStorageMode,
  type KeyValueStorage,
} from './auth/domain/credentials';

export { base64Text, base64UrlBytes, base64UrlText } from './auth/domain/base64';

export {
  createPkceChallenge,
  pkceChallengeFor,
  randomToken,
  PKCE_METHOD,
  type PkceChallenge,
  type RandomBytes,
} from './auth/domain/pkce';

export {
  authorizationUrl,
  clientCredentialsPlan,
  codeExchangePlan,
  deviceAuthorizationPlan,
  devicePollPlan,
  parseDeviceAuthorization,
  parseTokenResponse,
  passwordPlan,
  MAX_ACCESS_TOKEN_CHARS,
  readAuthorizationCode,
  unsendableTokenReason,
  readImplicitToken,
  refreshPlan,
  REDIRECT_FLOWS,
  type CallbackParams,
  type DeviceAuthorization,
  type OAuthClient,
  type OAuthToken,
  type PendingAuthorization,
  type TokenFailureReason,
  type TokenOutcome,
} from './auth/domain/oauth';

export {
  discoverProvider,
  discoveryPlan,
  readDiscoveryDocument,
  type DiscoveredProvider,
} from './auth/domain/discovery';

export {
  OAuthSessionService,
  PENDING_AUTHORIZATION_KEY,
  type OAuthSessionOptions,
  type RenewOutcome,
  type SessionStatus,
  type SignInOutcome,
} from './auth/application/services/oauth-session.service';

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
  type ResponseReaderLike,
  type ResponseStreamLike,
} from './send/infrastructure/adapters/fetch-transport.adapter';

export {
  PathRewriteHttpTransport,
  type PathRewriteTransportOptions,
} from './send/infrastructure/adapters/path-rewrite-transport.adapter';

export {
  ProxyHttpTransport,
  type ProxyTransportOptions,
} from './send/infrastructure/adapters/proxy-transport.adapter';

export {
  createRunner,
  RequestRunner,
  type PrefilledCredentials,
  type RunHeader,
  type RunNotice,
  type RunResult,
  type RunnerOptions,
  type RunnerSendInput,
  type RunnerVisibility,
} from './send/application/services/runner.service';

export type {
  IStreamTransport,
  StreamOpenResult,
} from './stream/application/ports/stream-transport.port';

export {
  DEFAULT_MAX_ELEMENT_CHARS,
  ElementTooLargeError,
  StreamDecoder,
  type StreamFormat,
  type StreamFrame,
} from './stream/domain/decoder';

export { checkStreamItem, type StreamItemSchema } from './stream/domain/item-check';

export {
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  noStreamTransport,
  runStream,
  type StreamElement,
  type StreamEnd,
  type StreamEndReason,
  type StreamHandle,
  type StreamHandlers,
  type StreamOpened,
  type StreamRunContext,
  type StreamRunOptions,
} from './stream/application/services/stream.service';

export {
  FetchStreamTransport,
  type FetchStreamTransportOptions,
} from './stream/infrastructure/adapters/fetch-stream.adapter';

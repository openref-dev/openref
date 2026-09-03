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
  type RunnableSendInput,
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

export type {
  ISocketTransport,
  SocketCloseInfo,
  SocketConnection,
  SocketHandshake,
  SocketTransportHandlers,
  SocketTransportKind,
} from './socket/application/ports/socket-transport.port';

export { buildHandshake, type SocketHandshakeInput } from './socket/domain/handshake';

export {
  checkSocketMessage,
  type NamedMessageSchema,
  type SocketMessageVerdict,
} from './socket/domain/message-check';

export {
  createSocketLog,
  DEFAULT_SOCKET_LOG_BYTES,
  DEFAULT_SOCKET_LOG_WINDOW,
  type SocketLog,
  type SocketLogEntry,
  type SocketLogState,
  type SocketMessageDirection,
} from './socket/domain/message-log';

export {
  createSocketClient,
  DEFAULT_SOCKET_RECONNECT_ATTEMPTS,
  DEFAULT_SOCKET_RECONNECT_DELAY_MS,
  openSocket,
  SOCKET_BACKOFF_CEILING,
  type SocketClient,
  type SocketSession,
  type SocketSessionContext,
  type SocketSessionHandlers,
  type SocketSessionOptions,
  type SocketSessionState,
  type SocketStatus,
} from './socket/application/services/socket.service';

export {
  NativeWebSocketTransport,
  type NativeWebSocketTransportOptions,
  type WebSocketCloseLike,
  type WebSocketFactory,
  type WebSocketLike,
} from './socket/infrastructure/adapters/native-websocket.adapter';

export {
  DEFAULT_SOCKET_IO_EVENT,
  DEFAULT_SOCKET_IO_TRANSPORTS,
  SocketIoTransport,
  type SocketIoFactory,
  type SocketIoLike,
  type SocketIoOptions,
  type SocketIoTransportOptions,
} from './socket/infrastructure/adapters/socket-io.adapter';

// THE ERROR CLASSES A CONSUMER OF THIS PACKAGE CAN BE HANDED, RE-EXPORTED SO THEY CAN CATCH THEM.
// ADDED 2026-09-02. This was the package the finding named: `noStreamTransport()` has `RunnerError`
// as its DECLARED RETURN TYPE, and `RunnerError` was not exported from here, so the signature told
// a consumer the class exists and the package gave them no way to import it. `ElementTooLargeError`
// above was the only error class any of `@openref/nest`, `@openref/runner` and `@openref/vue`
// exported at all, and it was the one that had broken the error rule.
//
// THE SET IS EVERY CLASS A PUBLIC ENTRY POINT HERE CAN RAISE, PLUS EVERY BASE ABOVE ONE.
// `AuthError` from the whole OAuth2 surface, `SerializationError` from the request builders,
// `RunnerError` from every transport, `StreamError` because `ElementTooLargeError` extends it and
// a consumer catching "a stream went wrong" should not have to name the leaf, and
// `InvalidOptionsError` from the runner's own refusals.
//
// THESE ARE `@openref/core`'s OWN CLASSES AND NOT COPIES: it is a runtime dependency here and is
// not bundled into `dist/index.js`, so `instanceof` answers true for an error thrown from here.
export {
  AuthError,
  ConfigError,
  ErrorCode,
  InvalidOptionsError,
  OpenRefError,
  RunnerError,
  SerializationError,
  StreamError,
} from '@openref/core';

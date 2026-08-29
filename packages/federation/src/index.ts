/**
 * `@openref/federation`: the merge engine and the remote lifecycle of SPEC 15.
 *
 * Internal, bundled into `@openref/nest`. It reaches `@openref/core` and nothing else: the merge
 * takes normalized documents and returns one, the lifecycle of `T045` fetches, polls and serves
 * them, and drawing the result is the federated UI of `T046`.
 */

/** Name of this package, so a diagnostic can say which one produced a value. */
export const PACKAGE_NAME = '@openref/federation';

export { applyPrefix, servicePrefix } from './merge/domain/address';
export type { AddressStyle } from './merge/domain/address';

export {
  DEFAULT_CONFLICT_MODE,
  FEDERATION_CONFLICT_MODES,
  resolveConflictMode,
  validateServices,
} from './merge/domain/federation-options';
export type {
  FederationConflictMode,
  FederationService,
  FederationServiceIdentity,
  MergeDocumentsOptions,
} from './merge/domain/federation-options';

export { mergeDocuments, refuseBrokenReferences } from './merge/domain/merge-documents';

export { compareText, sortRenames } from './merge/domain/merge-report';
export type {
  MergeDeduplication,
  MergeDeduplicationSource,
  MergeRename,
  MergeRenameKind,
  MergeRenameReason,
  MergeReport,
  MergeResult,
} from './merge/domain/merge-report';

export {
  mergeHealth,
  mergeKind,
  mergeRelationships,
  rewriteHealthReport,
  serviceRecord,
} from './merge/domain/document-parts';
export type { HealthSource } from './merge/domain/document-parts';

export {
  allocateUnique,
  escapeIdentifier,
  identifierKey,
  namespaceIdentifier,
  resolveNames,
} from './merge/domain/name-allocation';
export type { NameClaim, NameSpaceRules, ResolvedName } from './merge/domain/name-allocation';

export { mismatchedKeys, unresolvedReferences } from './merge/domain/references';
export type { ReferenceKind, UnresolvedReference } from './merge/domain/references';

export { classifySchemas } from './merge/domain/schema-identity';
export type { SchemaClass, SchemaEntry } from './merge/domain/schema-identity';

export { mapSchemaReferences, rewriteNode, rewriteSchema } from './merge/domain/rewrite';
export type { NodeIdentity, RewriteMaps } from './merge/domain/rewrite';

export {
  DEFAULT_FAILURE_MODE,
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_REFRESH_MS,
  FEDERATION_FAILURE_MODES,
  MAX_BACKOFF_MULTIPLIER,
  refreshDelayMs,
  resolveFailureMode,
  resolveIntervalMs,
  validateRemotes,
} from './remote/domain/remote-config';
export type { FederationFailureMode, FederationRemoteConfig } from './remote/domain/remote-config';

export { remoteStatusOf, toStateError } from './remote/domain/remote-state';
export type {
  FederationReadySnapshot,
  FederationRemoteState,
  FederationSnapshot,
  FederationStateError,
  FederationUnavailableSnapshot,
  RemoteAttemptOutcome,
  RemoteStatus,
  RemoteVersionInfo,
} from './remote/domain/remote-state';

export type {
  IRemoteFetcher,
  RemoteDocumentSource,
  RemoteFetchRequest,
} from './remote/application/ports/remote-fetcher.port';

export { readCacheRecord } from './remote/application/ports/cache-driver.port';
export type {
  FederationCacheRecord,
  IFederationCacheDriver,
} from './remote/application/ports/cache-driver.port';

export { RemoteLifecycleService } from './remote/application/services/remote-lifecycle.service';
export type { RemoteLifecycleOptions } from './remote/application/services/remote-lifecycle.service';

export { FetchRemoteAdapter } from './remote/infrastructure/adapters/fetch-remote.adapter';
export type {
  FetchRemoteOptions,
  RemoteBodyReaderLike,
  RemoteBodyStreamLike,
  RemoteFetchLike,
  RemoteResponseLike,
} from './remote/infrastructure/adapters/fetch-remote.adapter';

export { MemoryCacheAdapter } from './remote/infrastructure/adapters/memory-cache.adapter';

export { FileCacheAdapter } from './remote/infrastructure/adapters/file-cache.adapter';
export type { FileCacheOptions } from './remote/infrastructure/adapters/file-cache.adapter';

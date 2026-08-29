/**
 * `@openref/federation`: the merge engine of SPEC 15.
 *
 * Internal, bundled into `@openref/nest`. It takes normalized documents and returns one, so it
 * reaches `@openref/core` and nothing else: fetching a remote is the lifecycle of `T045`, and
 * drawing the result is the federated UI of `T046`.
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

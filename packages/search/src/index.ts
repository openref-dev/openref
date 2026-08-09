import { PACKAGE_NAME as CORE_PACKAGE } from '@openref/core';

/**
 * Name of this package.
 *
 * Exported so that the dependency graph linter has a real edge to follow and so that
 * diagnostics can report which package produced a value.
 */
export const PACKAGE_NAME = '@openref/search';

/**
 * Packages this package is allowed to depend on, in the order declared by STANDARDS 3.5.
 */
export const UPSTREAM_PACKAGES: readonly string[] = [CORE_PACKAGE];

export {
  buildSearchIndex,
  FIELD_WEIGHTS,
  INDEXED_FIELDS,
  SEARCH_INDEX_VERSION,
  searchOptions,
  STORED_FIELDS,
} from './indexing/domain/index-builder';
export type { BuiltSearchIndex } from './indexing/domain/index-builder';
export {
  DEFAULT_SEARCH_LIMIT,
  loadSearchIndex,
  SearchIndexFormatError,
} from './indexing/domain/index-query';
export type { SearchHit, SearchIndex } from './indexing/domain/index-query';
export { collectSearchDocuments } from './indexing/domain/search-document';
export type { SearchDocument, SearchDocumentKind } from './indexing/domain/search-document';

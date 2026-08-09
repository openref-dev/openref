import MiniSearch from 'minisearch';
import { searchOptions, SEARCH_INDEX_VERSION } from './index-builder';
import type { SearchDocument, SearchDocumentKind } from './search-document';

/**
 * Querying a built index.
 *
 * Loading is separated from building because they happen in different places: the index is
 * built once per document hash on the server, per SPEC 12, and queried wherever it is served.
 */

/** One hit. */
export interface SearchHit {
  readonly id: string;
  readonly kind: SearchDocumentKind;
  readonly title: string;
  readonly score: number;
  readonly path?: string;
  readonly method?: string;
  readonly address?: string;
  readonly deprecated?: boolean;
}

/** A loaded index. */
export interface SearchIndex {
  /** Hash of the IR the index was built from. */
  readonly documentHash: string;
  readonly documentCount: number;
  search(query: string, limit?: number): SearchHit[];
}

/** Raised when a serialized index cannot be used. */
export class SearchIndexFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchIndexFormatError';
  }
}

interface SearchIndexFile {
  readonly version?: unknown;
  readonly documentHash?: unknown;
  readonly documentCount?: unknown;
  readonly index?: unknown;
}

/** Default number of hits returned, enough to fill a result list without paging. */
export const DEFAULT_SEARCH_LIMIT = 20;

/**
 * Loads a serialized index.
 *
 * The version is checked rather than assumed. An index is cached by document hash and can
 * outlive the code that wrote it, and MiniSearch loaded with a mismatched configuration
 * returns nothing rather than failing, which would look like a document with no content.
 *
 * @param serialized - Contents of the index file
 * @returns A queryable index
 * @throws {SearchIndexFormatError} When the file is not an index of a version this can read
 *
 * @example
 * loadSearchIndex(readFileSync('search-index.json', 'utf8')).search('orders');
 */
export function loadSearchIndex(serialized: string): SearchIndex {
  let file: SearchIndexFile;
  try {
    file = JSON.parse(serialized) as SearchIndexFile;
  } catch {
    throw new SearchIndexFormatError('the search index is not valid JSON');
  }

  if (file.version !== SEARCH_INDEX_VERSION) {
    throw new SearchIndexFormatError(
      `the search index is version ${String(file.version)}, this build reads version ${String(SEARCH_INDEX_VERSION)}`,
    );
  }

  if (typeof file.documentHash !== 'string' || typeof file.documentCount !== 'number') {
    throw new SearchIndexFormatError('the search index carries no document hash or count');
  }

  const engine = MiniSearch.loadJS<SearchDocument>(
    file.index as Parameters<typeof MiniSearch.loadJS>[0],
    searchOptions(),
  );

  const documentHash = file.documentHash;
  const documentCount = file.documentCount;

  return {
    documentHash,
    documentCount,

    search(query, limit = DEFAULT_SEARCH_LIMIT): SearchHit[] {
      if (query.trim() === '') return [];

      return engine
        .search(query)
        .slice(0, limit)
        .map((result) => {
          const hit: { -readonly [Key in keyof SearchHit]: SearchHit[Key] } = {
            id: String(result.id),
            kind: result.kind as SearchDocumentKind,
            title: String(result.title),
            score: result.score,
          };

          if (typeof result.path === 'string') hit.path = result.path;
          if (typeof result.method === 'string') hit.method = result.method;
          if (typeof result.address === 'string') hit.address = result.address;
          if (result.deprecated === true) hit.deprecated = true;

          return hit;
        });
    },
  };
}

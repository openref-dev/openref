import type { IRDocument } from '@openref/core';
import MiniSearch from 'minisearch';
import { collectSearchDocuments, type SearchDocument } from './search-document';

/**
 * Building the search index, per SPEC 12 and BUILD T007.
 *
 * The index is a pure function of the IR. That is what lets the prerender cache key it by
 * `IRDocument.hash` alongside the rendered HTML, per SPEC 12.
 *
 * SERIALIZED AS CONSTRUCTED, NOT CANONICALIZED, per SPEC 12. This went through `canonicalize`
 * for the bytes to be identical between two builds, which is true and is not what canonical
 * form is for: it is the hash's tool, and a payload that borrows it inherits a sort nobody
 * asked for. The bytes are identical here because the records are collected in a deterministic
 * order from a deterministic IR and MiniSearch keeps insertion order in its structures, and two
 * independently built indexes are compared in the suite to say so.
 */

/** Fields MiniSearch tokenizes and matches against. */
export const INDEXED_FIELDS: readonly string[] = [
  'title',
  'summary',
  'description',
  'path',
  'method',
  'address',
  'tags',
  'schemaNames',
];

/** Fields returned on a hit without being tokenized. */
export const STORED_FIELDS: readonly string[] = [
  'id',
  'kind',
  'title',
  'path',
  'method',
  'address',
  'deprecated',
];

/**
 * Relative weights, so that a route or a title outranks a mention deep in a description.
 *
 * A search for `orders` should reach `GET /orders` before it reaches an operation whose prose
 * happens to say the word.
 */
export const FIELD_WEIGHTS: Readonly<Record<string, number>> = {
  title: 4,
  path: 4,
  tags: 3,
  schemaNames: 3,
  summary: 2,
  method: 2,
  address: 2,
  description: 1,
};

/** Version of the serialized index format, so a cached index can be rejected rather than read. */
export const SEARCH_INDEX_VERSION = 1;

/** A built index, ready to be written to a single file. */
export interface BuiltSearchIndex {
  /** Hash of the IR this index was built from, per SPEC 12. */
  readonly documentHash: string;
  readonly documentCount: number;
  /** The whole index as one deterministic string. */
  readonly serialized: string;
}

/** The envelope written to disk, holding the index and what it was built from. */
interface SearchIndexFile {
  readonly version: number;
  readonly documentHash: string;
  readonly documentCount: number;
  readonly index: unknown;
}

/**
 * The MiniSearch configuration, shared by building and loading.
 *
 * Both sides must agree exactly: an index loaded with different field lists silently returns
 * nothing rather than failing.
 */
export function searchOptions(): ConstructorParameters<typeof MiniSearch>[0] {
  return {
    idField: 'id',
    fields: [...INDEXED_FIELDS],
    storeFields: [...STORED_FIELDS],
    searchOptions: {
      boost: { ...FIELD_WEIGHTS },
      prefix: true,
      fuzzy: 0.2,
    },
  };
}

/**
 * Rebuilds a value with every array made dense.
 *
 * MiniSearch keeps per field lengths in arrays indexed by field id, and leaves a hole where a
 * configured field appears in no document at all. `address` does that in every HTTP only
 * document, because channels arrive in M5. A hole has no JSON representation, and this is the
 * one place the move away from `canonicalize` costs something: canonical serialization refused
 * a hole outright, while `JSON.stringify` writes `null` and hands MiniSearch a field length of
 * null on load, which is silent. So this function is what stands between the two now rather
 * than a convenience ahead of a refusal, and the round trip below is what checks it.
 *
 * A hole becomes `0`, which is what those arrays mean: a field no document carries has a total
 * and an average length of zero. The only arrays MiniSearch leaves sparse are those length
 * arrays, and the round trip through {@link loadSearchIndex} is what checks that claim.
 */
function densify(value: unknown): unknown {
  if (Array.isArray(value)) {
    const source = value as readonly unknown[];
    return Array.from({ length: source.length }, (_, index) =>
      index in source ? densify(source[index]) : 0,
    );
  }

  if (typeof value !== 'object' || value === null) return value;

  const result: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value)) {
    result[key] = densify(member);
  }
  return result;
}

/**
 * Builds the search index for a document.
 *
 * @param document - Normalized IR document
 * @returns The index, its document count, and the hash of the IR it came from
 *
 * @example
 * const index = buildSearchIndex(document);
 * writeFileSync('search-index.json', index.serialized);
 */
export function buildSearchIndex(document: IRDocument): BuiltSearchIndex {
  const records = collectSearchDocuments(document);
  const engine = new MiniSearch<SearchDocument>(searchOptions());

  // Added in the canonical order `collectSearchDocuments` produced, because MiniSearch keeps
  // insertion order in its internal structures and that order reaches the serialized bytes.
  engine.addAll(records);

  const file: SearchIndexFile = {
    version: SEARCH_INDEX_VERSION,
    documentHash: document.hash,
    documentCount: records.length,
    index: densify(engine.toJSON()),
  };

  return {
    documentHash: document.hash,
    documentCount: records.length,
    serialized: JSON.stringify(file),
  };
}

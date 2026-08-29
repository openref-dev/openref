import type { IRDocument } from '@openref/core';
import type { FederationConflictMode } from './federation-options';

/**
 * What the merge did, in the words of the thing it did it to, per the T044 done-when.
 *
 * "EXPLAINABLE WHEN IT RENAMES SOMETHING" IS THIS FILE. A merged reference is read by somebody
 * who knows one of the services, and every id they knew it by can have moved. A report that says
 * how many things were renamed explains nothing; one that says which name became which name, in
 * which service, and which other service contested it, is the difference between a reader
 * finding their endpoint and a reader concluding it was dropped.
 */

/** What sort of name was renamed. */
export type MergeRenameKind =
  'node' | 'schema' | 'security-scheme' | 'path' | 'channel-address' | 'navigation' | 'webhook';

/** Why a name moved. */
export type MergeRenameReason =
  /** The `<serviceId>_` rule of SPEC 15, which applies to every node id whether or not it clashed. */
  | 'service-namespace'
  /** The service declared a mount prefix, so every address of the service moved under it. */
  | 'service-prefix'
  /** Two or more services answered one address, and the mode said to move them. */
  | 'address-conflict'
  /** Two or more services declared one name for things that are not the same, per the mode. */
  | 'name-conflict'
  /**
   * The schema turned out to be the same component as another service's, and the class took one id.
   *
   * ONLY EVER A SCHEMA, and only when the members of a class were registered under ids that are
   * not all the same, which happens when two services reached one component by different routes.
   * Nothing was lost: the entry the id now names is the same component the old id named.
   */
  | 'deduplicated'
  /** The name the rules above produced was already taken by something else. */
  | 'uniqueness';

/** One name, before and after, with the reason it moved. */
export interface MergeRename {
  readonly kind: MergeRenameKind;
  /** Service whose name moved. */
  readonly serviceId: string;
  /** The name as the service's own document wrote it. */
  readonly from: string;
  /** The name in the merged document. */
  readonly to: string;
  readonly reason: MergeRenameReason;
  /**
   * The other services that claimed the same name, sorted, when the reason is a conflict.
   *
   * Empty for a rename that a rule performed rather than a clash: prefixing every node id is not
   * a conflict, and recording an empty contest for it keeps the two readable apart.
   */
  readonly contestedBy: readonly string[];
}

/** One schema that several services turned out to be describing identically. */
export interface MergeDeduplication {
  /** Id the single surviving entry has in the merged document. */
  readonly schemaId: string;
  /** Every source that collapsed into it, sorted by service id. Always two or more. */
  readonly sources: readonly MergeDeduplicationSource[];
}

/** Where one member of a deduplicated schema class came from. */
export interface MergeDeduplicationSource {
  readonly serviceId: string;
  /** Schema id in that service's own document. */
  readonly schemaId: string;
}

/** Everything the merge decided, beside the document it decided it about. */
export interface MergeReport {
  /** Service ids, sorted, which is also the order the merge processed them in. */
  readonly serviceIds: readonly string[];
  /** The mode the merge ran under, so a report read later is not read under the wrong policy. */
  readonly onConflict: FederationConflictMode;
  /** Every rename, ordered by kind, then service, then source name. */
  readonly renames: readonly MergeRename[];
  /** Every schema class with more than one source, ordered by merged schema id. */
  readonly deduplicated: readonly MergeDeduplication[];
}

/** A merged document and the account of how it was made. */
export interface MergeResult {
  readonly document: IRDocument;
  readonly report: MergeReport;
}

/** Order renames are printed and asserted in, so two runs produce one report. */
const RENAME_KIND_ORDER: readonly MergeRenameKind[] = [
  'node',
  'webhook',
  'schema',
  'security-scheme',
  'path',
  'channel-address',
  'navigation',
];

/**
 * Sorts renames into the one order a report is written in.
 *
 * The order is total: kind, then service, then the source name, and no two renames of one
 * service share a kind and a source name.
 *
 * @param renames - Renames in whatever order the merge produced them
 * @returns The same renames, in report order
 */
export function sortRenames(renames: readonly MergeRename[]): MergeRename[] {
  return [...renames].sort((left, right) => {
    const byKind = RENAME_KIND_ORDER.indexOf(left.kind) - RENAME_KIND_ORDER.indexOf(right.kind);
    if (byKind !== 0) return byKind;

    const byService = compareText(left.serviceId, right.serviceId);
    if (byService !== 0) return byService;

    return compareText(left.from, right.from);
  });
}

/**
 * Compares two strings by code point, which is the comparison the canonical form uses.
 *
 * @param left - First string
 * @param right - Second string
 * @returns Negative, zero or positive, as a comparator wants
 */
export function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

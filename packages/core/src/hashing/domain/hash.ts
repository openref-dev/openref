import type { IRDocument } from '../../ir/domain/document.types';
import { canonicalize } from './canonical';
import { sha256Hex } from './sha256';

/**
 * Deterministic hashing of IR values, per SPEC 5.3.
 *
 * The hash is the SSR cache key and the basis of reproducibility, so it always goes through
 * canonical serialization. `sha256(JSON.stringify(ir))` would silently invalidate the cache on
 * any restructuring of the document.
 */

/**
 * Hashes any IR value.
 *
 * @param value - Value to hash
 * @returns Lowercase hexadecimal sha256 digest of the canonical serialization
 * @throws {NormalizeError} When the value has no canonical representation
 *
 * @example
 * hash({ b: 1, a: 2 }) === hash({ a: 2, b: 1 }); // true
 */
export function hash(value: unknown): string {
  return sha256Hex(canonicalize(value));
}

/**
 * Hashes a document, excluding the `hash` field itself.
 *
 * A document cannot contain its own digest, so the field is blanked before hashing. Two
 * documents that differ only in `hash` therefore produce the same value, which is what makes
 * the field verifiable.
 *
 * @param document - Document to hash
 * @returns Lowercase hexadecimal sha256 digest
 */
export function hashDocument(document: IRDocument): string {
  return hash({ ...document, hash: '' });
}

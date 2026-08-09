import { ErrorCode, RefResolutionError } from '../../shared/errors/index';
import { isPlainObject, isUnknownArray } from './guards';

/**
 * JSON Pointer, RFC 6901, and the `uri#pointer` form a `$ref` is written in.
 */

/** A `$ref` split into the document it points at and the pointer inside that document. */
export interface ParsedReference {
  /** Document URI, empty for a reference inside the current document. */
  readonly uri: string;
  /** Pointer including its leading slash, empty when the reference points at the whole document. */
  readonly pointer: string;
  /** Whether the reference leaves the current document. */
  readonly external: boolean;
}

/**
 * Splits a `$ref` into its document part and its pointer part.
 *
 * @param reference - Reference exactly as written in the document
 * @returns The two parts, and whether the reference is external
 *
 * @example
 * parseReference('other.yaml#/components/schemas/Order');
 * // { uri: 'other.yaml', pointer: '/components/schemas/Order', external: true }
 */
export function parseReference(reference: string): ParsedReference {
  const hash = reference.indexOf('#');
  const uri = hash === -1 ? reference : reference.slice(0, hash);
  const pointer = hash === -1 ? '' : reference.slice(hash + 1);

  return { uri, pointer, external: uri !== '' };
}

/**
 * Splits a pointer into its unescaped segments.
 *
 * @param pointer - Pointer, with or without its leading slash
 * @returns Segments with `~1` decoded to `/` and `~0` decoded to `~`
 * @throws {RefResolutionError} When the pointer is not empty and does not start with a slash
 */
export function parseJsonPointer(pointer: string): string[] {
  if (pointer === '' || pointer === '/') return [];

  if (!pointer.startsWith('/')) {
    throw new RefResolutionError(
      `pointer ${pointer} does not start with a slash`,
      ErrorCode.NORM_REF_UNRESOLVED,
      undefined,
      { pointer },
    );
  }

  return pointer
    .slice(1)
    .split('/')
    .map((segment) => decodeURIComponent(segment).replace(/~1/g, '/').replace(/~0/g, '~'));
}

/**
 * Walks a pointer through a document.
 *
 * @param document - Document to walk
 * @param pointer - Pointer into that document
 * @returns The value at the pointer
 * @throws {RefResolutionError} When any segment is missing, which means the document is broken
 *         rather than merely incomplete
 */
export function resolveJsonPointer(document: unknown, pointer: string): unknown {
  let current = document;

  for (const segment of parseJsonPointer(pointer)) {
    if (isUnknownArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new RefResolutionError(
          `pointer ${pointer} leaves the document at index ${segment}`,
          ErrorCode.NORM_REF_UNRESOLVED,
          undefined,
          { pointer, segment },
        );
      }
      current = current[index];
      continue;
    }

    if (isPlainObject(current) && Object.hasOwn(current, segment)) {
      current = current[segment];
      continue;
    }

    throw new RefResolutionError(
      `pointer ${pointer} leaves the document at segment ${segment}`,
      ErrorCode.NORM_REF_UNRESOLVED,
      undefined,
      { pointer, segment },
    );
  }

  return current;
}

/**
 * Derives a readable schema name from a reference.
 *
 * The last pointer segment is the name in every layout used by OpenAPI and AsyncAPI, for
 * example `#/components/schemas/Order`. A reference with no pointer falls back to its URI.
 *
 * @param reference - Reference exactly as written
 * @returns A name suitable as a schema id and as a variant label
 */
export function schemaNameFromReference(reference: string): string {
  const { uri, pointer } = parseReference(reference);
  const segments = parseJsonPointer(pointer);
  const last = segments.at(-1);

  if (last !== undefined && last !== '') return last;
  return uri === '' ? reference : uri;
}

import { CycleDepthError, ErrorCode, RefResolutionError } from '../../shared/errors/index';
import { asString, isPlainObject, isUnknownArray } from './guards';

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
 * Percent decodes one pointer segment, or says why it could not.
 *
 * `decodeURIComponent` throws a bare `URIError` on a malformed percent sequence, and that used
 * to leave `core` as a foreign error through every public entry that resolves a reference:
 * `#/components/schemas/Disc%unt` was enough. Found by T016 as F3. Fail closed said the
 * normalizer refuses; it did not say what refused it, which is what an error contract is for.
 */
function decodeSegment(segment: string, pointer: string): string {
  try {
    return decodeURIComponent(segment);
  } catch (cause) {
    throw new RefResolutionError(
      `pointer ${pointer} has a malformed percent sequence in the segment ${segment}`,
      ErrorCode.NORM_REF_MALFORMED,
      cause instanceof Error ? cause : undefined,
      { pointer, segment },
    );
  }
}

/**
 * Splits a pointer into its unescaped segments.
 *
 * @param pointer - Pointer, with or without its leading slash
 * @returns Segments with `~1` decoded to `/` and `~0` decoded to `~`
 * @throws {RefResolutionError} When the pointer is not empty and does not start with a slash,
 *         or when a segment carries a malformed percent sequence
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
    .map((segment) => decodeSegment(segment, pointer).replace(/~1/g, '/').replace(/~0/g, '~'));
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

/** Every object a chain of `$ref` members stood on, and what the last of them names. */
export interface StructuralReferenceChain {
  /** The objects walked, nearest first: the member as written, then each `$ref` it stands on. */
  readonly chain: readonly object[];
  /** What the last link names, which is not always an object. */
  readonly value: unknown;
}

/**
 * Walks a chain of `$ref` members to the value a structural reference names.
 *
 * IT TERMINATES BY CONSTRUCTION rather than by a depth counter: each hop records the object it
 * came from, and a document holds finitely many objects, so the walk either reaches something
 * that is not a reference or meets an object it has already stood on. The second is a cycle and
 * is refused, because a definition that is its own definition describes nothing.
 *
 * A STRUCTURAL REFERENCE STAYS INSIDE ITS DOCUMENT, which is not the rule for schemas. SPEC 5.1.1
 * gives an external schema target an id space and a registry; a channel, a message, a server or a
 * callback in another file has neither, so pointing at one is refused rather than resolved to
 * nothing.
 *
 * IT IS SHARED BY BOTH NORMALIZERS, per SPEC 9.3. The AsyncAPI reader has walked references this
 * way since `T048`; the OpenAPI reader reached `T052` without it, which is why a callback written
 * at the canonical `#/components/callbacks/*` spelling was walked as if the key `$ref` were a
 * runtime expression and left the document with no callback at all.
 *
 * @param document - The document references are resolved against
 * @param value - The member as written, which may or may not be a reference
 * @param where - What is being resolved, for the message a reader gets
 * @param subject - What kind of thing this is, for the message an external reference gets
 * @returns Every object stood on, and the value the last link names
 * @throws {RefResolutionError} When the reference leaves the document or resolves to nothing
 * @throws {CycleDepthError} When the chain of references returns to where it has been
 */
export function structuralReferenceChain(
  document: Record<string, unknown>,
  value: unknown,
  where: string,
  subject: string,
): StructuralReferenceChain {
  const chain: object[] = [];
  const visited = new Set<object>();
  let current = value;

  while (isPlainObject(current)) {
    chain.push(current);

    const reference = asString(current.$ref);
    if (reference === undefined) return { chain, value: current };

    if (visited.has(current)) {
      throw new CycleDepthError(
        `${where} follows a chain of references that returns to ${reference}`,
        ErrorCode.NORM_CYCLE_DEPTH_EXCEEDED,
        undefined,
        { reference, where },
      );
    }
    visited.add(current);

    const parsed = parseReference(reference);
    if (parsed.external) {
      throw new RefResolutionError(
        `${where} points at ${reference}, and ${subject} is resolved inside ` +
          'the document that writes it rather than in another file',
        ErrorCode.NORM_REF_UNRESOLVED,
        undefined,
        { reference, where },
      );
    }

    // THE POSITION IS PUT BACK ON, because `resolveJsonPointer` knows the pointer and not who
    // wrote it, and SPEC 9.4 asks a refusal here to name both what did not resolve and where it
    // was written. The pointer's own account of which segment failed is kept as the cause.
    try {
      current = resolveJsonPointer(document, parsed.pointer);
    } catch (cause) {
      throw new RefResolutionError(
        `${where} points at ${reference}, which this document does not have`,
        ErrorCode.NORM_REF_UNRESOLVED,
        cause instanceof Error ? cause : undefined,
        { reference, where },
      );
    }
  }

  return { chain, value: current };
}

/**
 * Follows a chain of `$ref` members to the object a structural reference names.
 *
 * @param document - The document references are resolved against
 * @param value - The member as written, which may or may not be a reference
 * @param where - What is being resolved, for the message a reader gets
 * @param subject - What kind of thing this is, for the message an external reference gets
 * @returns The object the reference names, or the value itself when it is not one
 * @throws {RefResolutionError} When the reference leaves the document or resolves to nothing
 * @throws {CycleDepthError} When the chain of references returns to where it has been
 */
export function followStructuralReference(
  document: Record<string, unknown>,
  value: unknown,
  where: string,
  subject: string,
): unknown {
  return structuralReferenceChain(document, value, where, subject).value;
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

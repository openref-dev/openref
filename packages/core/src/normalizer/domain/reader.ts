/**
 * Which reader a specification asks for, decided by the specification itself.
 *
 * THE MEMBER IS THE ANSWER AND AN OPTION WOULD NOT BE, per SPEC 8.3. Both formats require a root
 * member named after themselves carrying their version, `openapi` and `asyncapi`, so a document
 * states which reader it needs. An option beside the document would be a second statement of the
 * same fact, and the two disagree the first time a host copies an entry and changes one half.
 *
 * IT LIVES HERE BECAUSE TWO SURFACES ASK IT. `@openref/nest` asks it of the `document` a host
 * hands `setup`, and `@openref/federation` asks it of the body a remote answered with; until
 * `T053` only the first had an answer at all and the second called the OpenAPI reader
 * unconditionally, so an events remote was refused by name and federation was HTTP-only on the
 * wire. One exported pair rather than one copy per package is the standing rule about a
 * vocabulary spoken by more than one surface.
 */

import type { IRDocument } from '../../ir/domain/document.types';
import { normalizeAsyncApiDocument } from './asyncapi-normalizer';
import type { NormalizeAsyncApiOptions } from './asyncapi-normalizer';
import { normalizeOpenApiDocument } from './openapi-normalizer';
import type { NormalizeOpenApiOptions } from './openapi-normalizer';

/**
 * What both readers take, so a caller that does not know which one will run can still configure it.
 *
 * An intersection rather than a third declaration: the day one reader gains an option of its own,
 * this type gains it too and a caller passing it to the other reader fails to compile, which is
 * the report a hand written copy would not make.
 */
export type NormalizeSpecificationOptions = NormalizeOpenApiOptions & NormalizeAsyncApiOptions;

/**
 * Whether a parsed specification is an AsyncAPI one, asked of the document itself.
 *
 * @param input - The parsed document, whatever it turned out to be
 * @returns True when it declares an `asyncapi` version
 *
 * @example
 * isAsyncApiSource({ asyncapi: '3.0.0' }); // true
 * isAsyncApiSource({ openapi: '3.1.0' }); // false
 */
export function isAsyncApiSource(input: unknown): boolean {
  return (
    typeof input === 'object' &&
    input !== null &&
    typeof (input as { asyncapi?: unknown }).asyncapi === 'string'
  );
}

/**
 * Normalizes a parsed specification with the reader the document names.
 *
 * A DOCUMENT DECLARING NEITHER MEMBER IS THE OPENAPI READER'S REFUSAL, not a third message
 * invented here. That reader already refuses it by name, saying the version field is missing,
 * which is the sentence a host has to act on; a message from this function would hide it behind
 * a wrapper that knows less.
 *
 * @param input - The parsed document
 * @param options - Identity, external documents and depth limit, as either reader takes them
 * @returns The normalized document, `kind` decided by the reader that ran
 * @throws {NormalizeError} Whatever the reader that ran refuses, unchanged
 *
 * @example
 * const document = normalizeSpecification(parseSpecification(body), { documentId: 'orders' });
 */
export function normalizeSpecification(
  input: unknown,
  options: NormalizeSpecificationOptions = {},
): IRDocument {
  return isAsyncApiSource(input)
    ? normalizeAsyncApiDocument(input, options)
    : normalizeOpenApiDocument(input, options);
}

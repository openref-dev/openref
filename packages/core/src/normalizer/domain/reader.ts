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
import { ErrorCode } from '../../shared/errors/codes';
import { NormalizeError } from '../../shared/errors/index';
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
 * The version a document writes under one of the two root members, when it writes a string there.
 *
 * @param input - The parsed document
 * @param member - `openapi` or `asyncapi`
 * @returns The version string, or nothing when the member is absent or is not a string
 */
function declaredVersion(input: unknown, member: 'openapi' | 'asyncapi'): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const value: unknown = (input as Record<string, unknown>)[member];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Normalizes a parsed specification with the reader the document names.
 *
 * A DOCUMENT DECLARING NEITHER MEMBER IS THE OPENAPI READER'S REFUSAL, not a third message
 * invented here. That reader already refuses it by name, saying the version field is missing,
 * which is the sentence a host has to act on; a message from this function would hide it behind
 * a wrapper that knows less.
 *
 * A DOCUMENT DECLARING BOTH IS THIS FUNCTION'S OWN REFUSAL, per SPEC 8.3, and it is the one
 * question the predicate above cannot answer. SPEC 8.3's rule is that a document says which
 * reader it needs; a document writing `openapi` and `asyncapi` in its root says it twice and
 * differently, and taking the first answer is a silent choice between two statements a host made
 * on purpose. Measured on the adversarial pass of `T054`: such a document went to the events
 * reader, every HTTP operation it declared vanished, `unreadKeys` stayed empty and nothing was
 * reported, which is a reference drawing a service as though it served no endpoint at all. The
 * refusal names both members and both versions, because the person who has to fix it is the one
 * who wrote them.
 *
 * @param input - The parsed document
 * @param options - Identity, external documents and depth limit, as either reader takes them
 * @returns The normalized document, `kind` decided by the reader that ran
 * @throws {NormalizeError} When the document declares both root members, and whatever the reader
 *         that ran refuses, unchanged
 *
 * @example
 * const document = normalizeSpecification(parseSpecification(body), { documentId: 'orders' });
 */
export function normalizeSpecification(
  input: unknown,
  options: NormalizeSpecificationOptions = {},
): IRDocument {
  const asyncapi = declaredVersion(input, 'asyncapi');
  const openapi = declaredVersion(input, 'openapi');

  if (asyncapi !== undefined && openapi !== undefined) {
    throw new NormalizeError(
      `the document declares both root members, openapi ${openapi} and asyncapi ${asyncapi}, ` +
        'so it states two specifications and neither reader can be the right one; ' +
        'remove the member the document does not mean',
      ErrorCode.NORM_DOCUMENT_INVALID,
      undefined,
      { openapi, asyncapi },
    );
  }

  return isAsyncApiSource(input)
    ? normalizeAsyncApiDocument(input, options)
    : normalizeOpenApiDocument(input, options);
}

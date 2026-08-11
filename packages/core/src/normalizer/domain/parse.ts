import { parse as parseYaml } from 'yaml';
import { ErrorCode, NormalizeError } from '../../shared/errors/index';

/**
 * Specification intake: JSON and YAML through the pinned `yaml` package.
 *
 * The result is `unknown`. A parsed document is still untrusted input and is narrowed by the
 * guards in `guards.ts` from here on.
 */

/**
 * How large a document may be before intake refuses it, in UTF-16 code units.
 *
 * DECLARED BECAUSE THE ALTERNATIVE WAS AN UNBOUNDED STALL. Measured in T016: YAML intake is
 * superlinear in the number of keys of one mapping, at 0.13 s for 255 KB, 2.1 s for 2 MB and
 * 7.2 s for 4.2 MB of the same shape, and a 50 MB document of it had not returned after ten
 * minutes in one synchronous call. There was no refusal at any size, so a document too large
 * to process presented as a hung process rather than as a rejected input.
 *
 * The limit is generous against anything real: the largest document in the corpus of SPEC 21
 * is Stripe at 6.4 MB, which this leaves five times over.
 *
 * IT BOUNDS SIZE AND NOT SHAPE, and that distinction is worth keeping in view. The cost is
 * driven by how many keys share one mapping rather than by bytes, so a 4 MB document of the
 * hostile shape still takes seconds and passes this check. What the limit buys is that the
 * unbounded case ends in an error with a code. Bounding the shape is a parse budget, and it
 * belongs beside the normalization cost bounds rather than here.
 *
 * Counted in code units rather than bytes so that the check costs nothing: encoding a 50 MB
 * string to measure it would allocate the thing being refused. The two differ by at most a
 * factor of three, and the limit carries far more headroom than that.
 */
export const MAX_SPECIFICATION_LENGTH = 32 * 1024 * 1024;

/** Options for {@link parseSpecification}. */
export interface ParseSpecificationOptions {
  /** File name or URL, used only in error messages. */
  readonly source?: string;
  /** Ceiling on document length. Defaults to {@link MAX_SPECIFICATION_LENGTH}. */
  readonly maxLength?: number;
}

function looksLikeJson(text: string): boolean {
  const first = text.trimStart().charAt(0);
  return first === '{' || first === '[';
}

/**
 * Parses a specification written as JSON or as YAML.
 *
 * YAML is a superset of JSON, but JSON is parsed by the JSON parser when the text plainly is
 * JSON: it is faster and its errors point at the right place.
 *
 * @param text - Document text
 * @param options - Source name for error messages, and the length ceiling
 * @returns The parsed document, still untrusted
 * @throws {NormalizeError} When the text parses as neither, parses to nothing, or is longer
 *         than {@link MAX_SPECIFICATION_LENGTH}
 *
 * @example
 * parseSpecification('openapi: 3.1.0\ninfo:\n  title: API\n  version: 1.0.0');
 */
export function parseSpecification(text: string, options: ParseSpecificationOptions = {}): unknown {
  const source = options.source ?? 'specification';
  const maxLength = options.maxLength ?? MAX_SPECIFICATION_LENGTH;

  if (text.trim() === '') {
    throw new NormalizeError(`${source} is empty`, ErrorCode.NORM_DOCUMENT_INVALID, undefined, {
      source,
    });
  }

  // Before the parse rather than after, which is the whole point: past this size the parse is
  // the thing that does not come back.
  if (text.length > maxLength) {
    throw new NormalizeError(
      `${source} is ${String(text.length)} characters, past the ${String(maxLength)} this reads`,
      ErrorCode.NORM_DOCUMENT_TOO_LARGE,
      undefined,
      { source, length: text.length, limit: maxLength },
    );
  }

  const parse = (): unknown => {
    if (looksLikeJson(text)) {
      return JSON.parse(text);
    }
    return parseYaml(text, { prettyErrors: true });
  };

  let parsed: unknown;
  try {
    parsed = parse();
  } catch (error) {
    throw new NormalizeError(
      `${source} is neither valid JSON nor valid YAML`,
      ErrorCode.NORM_DOCUMENT_INVALID,
      error instanceof Error ? error : undefined,
      { source },
    );
  }

  if (parsed === null || parsed === undefined) {
    throw new NormalizeError(
      `${source} parsed to nothing`,
      ErrorCode.NORM_DOCUMENT_INVALID,
      undefined,
      { source },
    );
  }

  return parsed;
}

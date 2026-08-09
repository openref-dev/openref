import { parse as parseYaml } from 'yaml';
import { ErrorCode, NormalizeError } from '../../shared/errors/index';

/**
 * Specification intake: JSON and YAML through the pinned `yaml` package.
 *
 * The result is `unknown`. A parsed document is still untrusted input and is narrowed by the
 * guards in `guards.ts` from here on.
 */

/** Options for {@link parseSpecification}. */
export interface ParseSpecificationOptions {
  /** File name or URL, used only in error messages. */
  readonly source?: string;
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
 * @param options - Source name for error messages
 * @returns The parsed document, still untrusted
 * @throws {NormalizeError} When the text parses as neither, or parses to nothing
 *
 * @example
 * parseSpecification('openapi: 3.1.0\ninfo:\n  title: API\n  version: 1.0.0');
 */
export function parseSpecification(text: string, options: ParseSpecificationOptions = {}): unknown {
  const source = options.source ?? 'specification';

  if (text.trim() === '') {
    throw new NormalizeError(`${source} is empty`, ErrorCode.NORM_DOCUMENT_INVALID, undefined, {
      source,
    });
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

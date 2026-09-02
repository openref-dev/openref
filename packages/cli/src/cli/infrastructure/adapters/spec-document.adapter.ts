import { ErrorCode, normalizeOpenApiDocument, parseSpecification, UsageError } from '@openref/core';
import type { LoadedDocument } from '../../domain/loaded-document.types';
import { readHandedFile } from './regular-file.adapter';

/**
 * Loads a document from a spec file on disk: `--spec`, or the positional argument `lint` and
 * `diff` take directly.
 *
 * No application is involved, so there is nothing to close: `close` is a no-op kept so this
 * loader returns the same shape every other one does.
 *
 * @param path - Path to a JSON or YAML OpenAPI document, resolved against the current directory
 * @throws {UsageError} When the file cannot be read, or is not a regular file
 * @throws {NormalizeError} When the file does not parse, or does not normalize, as OpenAPI
 */
export async function loadSpecDocument(path: string): Promise<LoadedDocument> {
  let text: string;
  try {
    text = await readHandedFile(path, refusal);
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(
      `could not read ${path}: ${describe(error)}`,
      ErrorCode.CLI_USAGE_INVALID,
      asCause(error),
    );
  }

  const parsed = parseSpecification(text, { source: path });
  const document = normalizeOpenApiDocument(parsed);

  return { document, close: () => Promise.resolve() };
}

function refusal(reason: string): UsageError {
  return new UsageError(`could not read ${reason}`, ErrorCode.CLI_USAGE_INVALID);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asCause(error: unknown): Error | undefined {
  return error instanceof Error ? error : undefined;
}

import { dirname, isAbsolute, resolve } from 'node:path';
import { ErrorCode, UsageError } from '@openref/core';
import type { LoadedDocument } from '../../domain/loaded-document.types';
import { readHandedFile } from './regular-file.adapter';
import { loadSpecDocument } from './spec-document.adapter';

/** The one shape a config file is read as, in this task: a path to a spec, nothing more yet. */
interface OpenRefCliConfig {
  readonly spec?: string;
}

function isConfigShape(value: unknown): value is OpenRefCliConfig {
  if (typeof value !== 'object' || value === null) return false;
  const spec = (value as Record<string, unknown>).spec;
  return spec === undefined || typeof spec === 'string';
}

/**
 * Loads a document from `--config`, a JSON file naming the spec to read.
 *
 * JSON ONLY, IN THIS TASK. A JS or TS config able to compute its own options is a real future
 * need and not this one: `T036` asks for a path that works without a running application, and a
 * JSON file naming one is the whole of what that requires.
 *
 * @param path - Path to a JSON config file, resolved against the current directory
 * @throws {UsageError} When the file cannot be read, is not a regular file, is not valid JSON, or
 *         names no usable `spec`
 */
export async function loadConfigDocument(path: string): Promise<LoadedDocument> {
  let text: string;
  try {
    text = await readHandedFile(
      path,
      (reason) => new UsageError(`could not read ${reason}`, ErrorCode.CLI_USAGE_INVALID),
    );
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(
      `could not read ${path}: ${describe(error)}`,
      ErrorCode.CLI_USAGE_INVALID,
      asCause(error),
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new UsageError(
      `${path} is not valid JSON: ${describe(error)}`,
      ErrorCode.CLI_USAGE_INVALID,
      asCause(error),
    );
  }

  if (!isConfigShape(parsed) || parsed.spec === undefined) {
    throw new UsageError(`${path} does not name a "spec" path`, ErrorCode.CLI_USAGE_INVALID);
  }

  const specPath = isAbsolute(parsed.spec) ? parsed.spec : resolve(dirname(path), parsed.spec);
  return loadSpecDocument(specPath);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asCause(error: unknown): Error | undefined {
  return error instanceof Error ? error : undefined;
}

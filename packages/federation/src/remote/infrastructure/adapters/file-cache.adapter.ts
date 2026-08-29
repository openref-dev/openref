import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ErrorCode,
  FederationError,
  InvalidOptionsError,
  isFederationServiceId,
} from '@openref/core';
import {
  readCacheRecord,
  type FederationCacheRecord,
  type IFederationCacheDriver,
} from '../../application/ports/cache-driver.port';

/**
 * The cache driver that supports a restart: one JSON file per remote in one directory.
 *
 * This is the driver the task's "cache persistence across a process restart" is proved with. A
 * record read back is bytes from a disk this process did not necessarily write, so everything
 * revived goes through `readCacheRecord` and a file that cannot be read as a record is refused
 * by name with `FED_CACHE_INVALID` rather than treated as silently absent: the lifecycle
 * records the refusal on the remote's state, where an operator can see it, and proceeds as if
 * there were no cache, which is the conservative direction.
 *
 * THE FILE NAME IS THE REMOTE ID AND THE ID IS RE-CHECKED HERE. The lifecycle validates ids at
 * configuration time, but this class is exported on its own, and a path built from an
 * unchecked string is how a cache directory reaches a file outside itself. The id grammar is
 * `core`'s `isFederationServiceId`, the same rule everything else holds the id to.
 */

/** Where the files go. */
export interface FileCacheOptions {
  /** Directory holding one `<remoteId>.json` per remote. Created on the first save. */
  readonly directory: string;
}

/** Keeps each remote's last successful fetch as a JSON file, atomically replaced. */
export class FileCacheAdapter implements IFederationCacheDriver {
  private readonly directory: string;

  /** @param options - The directory to keep records in */
  constructor(options: FileCacheOptions) {
    this.directory = options.directory;
  }

  /**
   * @param remoteId - The configured remote id
   * @param url - The URL the remote is configured at now
   * @returns The record fetched from that URL, or undefined when there is none for it
   * @throws {InvalidOptionsError} When the id is not a federation service id
   * @throws {FederationError} With `FED_CACHE_INVALID` when the file exists and cannot be read
   *         as a record
   */
  async load(remoteId: string, url: string): Promise<FederationCacheRecord | undefined> {
    const path = this.pathFor(remoteId);

    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (cause) {
      if (isMissingFile(cause)) return undefined;
      throw new FederationError(
        `the cache file for remote "${remoteId}" exists and could not be read`,
        ErrorCode.FED_CACHE_INVALID,
        cause instanceof Error ? cause : undefined,
        { remoteId, path },
      );
    }

    let revived: unknown;
    try {
      revived = JSON.parse(text);
    } catch (cause) {
      throw new FederationError(
        `the cache file for remote "${remoteId}" is not JSON`,
        ErrorCode.FED_CACHE_INVALID,
        cause instanceof Error ? cause : undefined,
        { remoteId, path },
      );
    }

    const record = readCacheRecord(revived);
    return record.url === url ? record : undefined;
  }

  /**
   * Writes the record through a sibling temporary file and a rename.
   *
   * The rename is what makes a crash mid-write leave either the old record or the new one on
   * disk, never a truncated half of the new one that the next start would then refuse.
   *
   * @param remoteId - The configured remote id
   * @param record - The record to keep, replacing any earlier one for this remote
   * @throws {InvalidOptionsError} When the id is not a federation service id
   */
  async save(remoteId: string, record: FederationCacheRecord): Promise<void> {
    const path = this.pathFor(remoteId);
    const temporary = `${path}.tmp`;

    await mkdir(this.directory, { recursive: true });
    await writeFile(
      temporary,
      JSON.stringify({ url: record.url, fetchedAt: record.fetchedAt, body: record.body }),
      'utf8',
    );

    try {
      await rename(temporary, path);
    } catch (cause) {
      await unlink(temporary).catch(() => undefined);
      throw cause;
    }
  }

  private pathFor(remoteId: string): string {
    if (!isFederationServiceId(remoteId)) {
      throw new InvalidOptionsError(
        `the remote id ${JSON.stringify(remoteId)} is not a federation service id, and this ` +
          'driver builds a file name from it; refusing keeps the cache directory the only ' +
          'place this class can touch',
        ErrorCode.CONFIG_INVALID_OPTIONS,
        undefined,
        { remoteId },
      );
    }

    return join(this.directory, `${remoteId}.json`);
  }
}

function isMissingFile(cause: unknown): boolean {
  return (
    typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === 'ENOENT'
  );
}

import { ErrorCode, FederationError } from '@openref/core';

/**
 * The cache behind SPEC 15's `degrade`: the last successful version of each remote.
 *
 * WHAT IS STORED IS THE RAW FETCHED TEXT, NOT THE NORMALIZED DOCUMENT, and the reason is the
 * process boundary this port exists to cross. The IR's shape belongs to whatever version of
 * this package is running; a record written by last month's build and revived into this month's
 * types would be a document nothing validated. The raw text re-normalizes under the normalizer
 * that is actually running, which is fail-closed, so a record that no longer normalizes is
 * refused instead of served.
 *
 * THE URL IS PART OF A RECORD'S VALIDITY, ENCODED IN THE CONTRACT RATHER THAN CHECKED BY EVERY
 * CALLER. `load` takes the URL the remote is configured at now, and a driver answers only with
 * a record fetched from that address: an operator who repoints a remote must not be served
 * yesterday's document from the address they moved away from. A mismatch is simply no record.
 */

/** One remote's last successful fetch, as stored. */
export interface FederationCacheRecord {
  /** The URL the body was fetched from. */
  readonly url: string;
  /** When it was fetched, ISO 8601. */
  readonly fetchedAt: string;
  /** The raw document text, exactly as the remote sent it. */
  readonly body: string;
}

/**
 * Read and write side of the remote cache.
 *
 * A driver that keeps records only in memory does not survive a restart, and that is a stated
 * property rather than a defect: the task's wording is "when a cache driver supports it". A
 * driver backed by disk or a store makes the restart case work, and the file adapter in this
 * package is one.
 *
 * A DRIVER BOUNDS ITS OWN IO. The lifecycle bounds the remote fetch, because a remote is a
 * network peer by definition; a driver is handed in by the operator as part of the deployment,
 * so one backed by a network store carries its own timeout, the way it would in any other part
 * of the application that called it.
 */
export interface IFederationCacheDriver {
  /**
   * @param remoteId - The configured remote id
   * @param url - The URL the remote is configured at now
   * @returns The record fetched from that URL, or undefined when there is none for it
   * @throws {FederationError} With `FED_CACHE_INVALID` when a record exists and cannot be read
   */
  load(remoteId: string, url: string): Promise<FederationCacheRecord | undefined>;
  /**
   * @param remoteId - The configured remote id
   * @param record - The record to keep, replacing any earlier one for this remote
   */
  save(remoteId: string, record: FederationCacheRecord): Promise<void>;
}

/**
 * Reads an untrusted value as a cache record, refusing anything else.
 *
 * For drivers whose records cross a process boundary: whatever was on the disk or in the store
 * is bytes somebody else wrote, and a field-by-field check is the difference between refusing a
 * corrupt record by name and serving whatever it decodes to.
 *
 * @param value - The revived value, untrusted
 * @returns The value as a record
 * @throws {FederationError} With `FED_CACHE_INVALID`, naming the first field that is wrong
 */
export function readCacheRecord(value: unknown): FederationCacheRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidRecord('is not an object');
  }

  const record = value as Record<string, unknown>;
  const url = record.url;
  const fetchedAt = record.fetchedAt;
  const body = record.body;

  if (typeof url !== 'string') throw invalidRecord('has no "url" string');
  if (typeof fetchedAt !== 'string') throw invalidRecord('has no "fetchedAt" string');
  if (typeof body !== 'string') throw invalidRecord('has no "body" string');
  if (!isInstant(fetchedAt)) {
    throw invalidRecord(
      `carries ${JSON.stringify(fetchedAt.slice(0, 40))} as "fetchedAt", which is not a moment in time`,
    );
  }

  return { url, fetchedAt, body };
}

/**
 * Whether a string is the ISO 8601 instant this record declares `fetchedAt` to be.
 *
 * THE FIELD WAS TYPED AND NOT CHECKED, AND T047 MEASURED WHERE THAT REACHES. Anything a planted
 * record put here travelled unaltered into the remote's state and out of `<mount>/_federation`,
 * measured with `<img src=x onerror=alert(1)>` arriving whole at the snapshot. Escaping on the way
 * out is the last line rather than the first one: a field declared as a time and holding something
 * else is a record that cannot be trusted to be a fetched document, which is what this reader is
 * for. Refusing it is also the only place the two halves can disagree, since the writer's own
 * value comes from `toISOString`.
 *
 * NOTHING HERE COMPARES IT WITH NOW, and that is the design rather than an omission. A record has
 * no expiry: what makes it usable is the URL it was fetched from and the fact that its text still
 * normalizes, so two services whose clocks disagree cannot make one another's records unusable.
 *
 * @param value - The revived field
 * @returns True when it parses as an instant and spells one
 */
function isInstant(value: string): boolean {
  // The round trip is what makes this a format check rather than a permissive parse: `Date` will
  // read many things, and only a real ISO 8601 instant comes back as itself.
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function invalidRecord(reason: string): FederationError {
  return new FederationError(
    `the cached record ${reason}, so it cannot be trusted to be a fetched document`,
    ErrorCode.FED_CACHE_INVALID,
  );
}

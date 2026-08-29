import type {
  FederationCacheRecord,
  IFederationCacheDriver,
} from '../../application/ports/cache-driver.port';

/**
 * The default cache driver: a map in this process.
 *
 * IT DOES NOT SURVIVE A RESTART, AND NOTHING ABOUT IT PRETENDS TO. The task's cache persistence
 * is "when a cache driver supports it", and this one is the driver for a deployment that never
 * asked for more: it exists so that the lifecycle always has a driver to write to. Its state
 * lives in the instance, not in the process: a lifecycle constructed without a cache gets its
 * own fresh adapter and starts from nothing, so a second lifecycle in the same process starts
 * from the last successful versions only when the caller constructs one adapter and hands it
 * to both.
 */
export class MemoryCacheAdapter implements IFederationCacheDriver {
  private readonly records = new Map<string, FederationCacheRecord>();

  /**
   * @param remoteId - The configured remote id
   * @param url - The URL the remote is configured at now
   * @returns The record fetched from that URL, or undefined when there is none for it
   */
  load(remoteId: string, url: string): Promise<FederationCacheRecord | undefined> {
    const record = this.records.get(remoteId);
    return Promise.resolve(record?.url === url ? record : undefined);
  }

  /**
   * @param remoteId - The configured remote id
   * @param record - The record to keep, replacing any earlier one for this remote
   */
  save(remoteId: string, record: FederationCacheRecord): Promise<void> {
    this.records.set(remoteId, record);
    return Promise.resolve();
  }
}

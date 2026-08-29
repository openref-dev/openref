import type { IRNode } from '@openref/core';
import type {
  FederationCacheRecord,
  IFederationCacheDriver,
  IRemoteFetcher,
  RemoteDocumentSource,
  RemoteFetchRequest,
} from '../../src/index';
import { readCacheRecord } from '../../src/index';

/**
 * Remotes for the lifecycle suites: a fetcher whose behaviour is a script, and a cache driver
 * whose records cross a serialization boundary.
 *
 * NOTHING HERE TOUCHES A NETWORK. The suites prove degradation, timeouts and recovery, and a
 * suite that needed a real socket to fail would be proving the socket. The one place a real
 * server appears is the integration suite, over loopback.
 */

/** What a scripted URL does on the next fetch. */
export type RemoteScript =
  /** Answer 200 with this body. */
  | { readonly kind: 'ok'; readonly body: string }
  /** Answer this status with no body. */
  | { readonly kind: 'status'; readonly status: number }
  /** Reject as a network failure. */
  | { readonly kind: 'down' }
  /** Never settle until the signal aborts, then reject with its reason. */
  | { readonly kind: 'hang' };

/** One recorded call: which URL, and when in the suite's (fake) clock it happened. */
export interface RecordedFetch {
  readonly url: string;
  readonly at: number;
}

/** A fetcher that does what the script for the URL says, and records every call. */
export class ScriptedFetcher implements IRemoteFetcher {
  public readonly calls: RecordedFetch[] = [];
  private readonly scripts = new Map<string, RemoteScript>();

  /** Sets what the URL does from now on. */
  set(url: string, script: RemoteScript): void {
    this.scripts.set(url, script);
  }

  fetch(request: RemoteFetchRequest): Promise<RemoteDocumentSource> {
    this.calls.push({ url: request.url, at: Date.now() });

    const script = this.scripts.get(request.url);
    if (script === undefined) {
      return Promise.reject(new Error(`no script for ${request.url}`));
    }

    switch (script.kind) {
      case 'ok':
        return Promise.resolve({ status: 200, body: script.body });
      case 'status':
        return Promise.resolve({ status: script.status, body: '' });
      case 'down':
        return Promise.reject(new Error(`connect ECONNREFUSED ${request.url}`));
      case 'hang':
        return new Promise((_resolve, reject) => {
          const fail = (): void => {
            reject(
              request.signal.reason instanceof Error ? request.signal.reason : new Error('aborted'),
            );
          };
          if (request.signal.aborted) {
            fail();
            return;
          }
          request.signal.addEventListener('abort', fail);
        });
    }
  }

  /** The calls made to one URL. */
  callsTo(url: string): RecordedFetch[] {
    return this.calls.filter((call) => call.url === url);
  }
}

/**
 * A driver whose records pass through JSON text on every save and load.
 *
 * THE SERIALIZATION IS THE POINT. A `Map` of live objects would "survive a restart" because
 * there was no restart; a record that went to a string and came back proves the shape crosses a
 * process boundary, and `readCacheRecord` on the way in proves the same reader used on real
 * revived bytes accepts it.
 */
export class SerializingCacheDriver implements IFederationCacheDriver {
  private readonly stored = new Map<string, string>();

  load(remoteId: string, url: string): Promise<FederationCacheRecord | undefined> {
    const text = this.stored.get(remoteId);
    if (text === undefined) return Promise.resolve(undefined);

    const record = readCacheRecord(JSON.parse(text));
    return Promise.resolve(record.url === url ? record : undefined);
  }

  save(remoteId: string, record: FederationCacheRecord): Promise<void> {
    this.stored.set(remoteId, JSON.stringify(record));
    return Promise.resolve();
  }

  /** Plants raw stored text, for the suites about records that cannot be read. */
  plant(remoteId: string, text: string): void {
    this.stored.set(remoteId, text);
  }
}

/** A minimal OpenAPI document, as the text a remote would serve. */
export function openApiBody(title: string, paths: Readonly<Record<string, unknown>>): string {
  return JSON.stringify({
    openapi: '3.1.0',
    info: { title, version: '1.0.0' },
    paths,
  });
}

/** One `get` operation for `openApiBody`, answering 200 and nothing else. */
export function getOperation(operationId: string): Record<string, unknown> {
  return { get: { operationId, responses: { '200': { description: 'ok' } } } };
}

/** True when some node of the document is an operation on this path. */
export function hasPath(nodes: ReadonlyMap<string, IRNode>, path: string): boolean {
  return [...nodes.values()].some((node) => node.kind === 'operation' && node.path === path);
}

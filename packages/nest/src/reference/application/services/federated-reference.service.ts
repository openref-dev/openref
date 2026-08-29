/**
 * The federated reference of SPEC 15.3: the same route table, answered from a snapshot.
 *
 * THE ROUTE READS A DECISION AND NEVER MAKES ONE. Every request begins with `snapshot()`, which
 * is a synchronous read of settled state, per SPEC 15.2, and the HTTP status lies in it
 * precomputed: `ready` delegates to an ordinary `ReferenceService` built for the merged
 * document, and `unavailable` is a 503 in the words the snapshot gives. Serving a page never
 * waits on a network.
 *
 * ONE INNER SERVICE PER COMPOSITION, KEYED BY DOCUMENT HASH. A refresh that changed nothing
 * produces the same hash and keeps the same service, warm caches and all; a changed remote
 * produces a new hash and the next request builds a new inner service over the same render
 * cache, whose keys already carry the hash, so nothing stale can answer.
 *
 * ASSETS ANSWER EVEN WHEN THE DOCUMENT CANNOT. The catalog is a fact about the build, not about
 * any remote, and a 503 page that could not load its stylesheet would be a worse sentence than
 * the one it is trying to say.
 */

import type { IRDocument } from '@openref/core';
import { buildAssetCatalog, createMemoryRenderCache } from '@openref/render';
import type { AssetCatalog, IRenderCache } from '@openref/render';
import type { FederationSnapshot, RemoteLifecycleService } from '@openref/federation';
import { ReferenceService, type ReferenceServiceOptions } from './reference.service';
import { IMMUTABLE, NO_STORE, notFoundReply } from '../../../http/domain/reply';
import { ASSET_PARAM, type ReferenceRouteId } from '../../domain/routes';
import type {
  ReferenceReply,
  ReferenceRequest,
} from '../../../http/application/ports/reference-http.port';

/** Everything the federated host is built with: the lifecycle, and how pages are served. */
export type FederatedReferenceOptions = Omit<
  ReferenceServiceOptions,
  'document' | 'ir' | 'augment'
>;

/** The route ids that answer with a page, whose 503 is words in HTML rather than JSON. */
const PAGE_ROUTES: ReadonlySet<ReferenceRouteId> = new Set<ReferenceRouteId>([
  'overview',
  'node',
  'schema',
  'bench',
  'health',
  'shapes',
  'states',
  'service',
]);

/** Answers the routes of SPEC 13.3 for a federation of services. */
export class FederatedReferenceService {
  private readonly lifecycle: RemoteLifecycleService;
  private readonly options: FederatedReferenceOptions;
  private readonly cache: IRenderCache;
  private readonly catalog: AssetCatalog;

  /** The inner service for the composition being served, keyed by its document hash. */
  private inner: { readonly hash: string; readonly service: ReferenceService } | undefined;

  /**
   * @param lifecycle - The remote lifecycle, constructed and owned by the caller
   * @param options - Mount point, assets and rendering choices, as `ReferenceService` takes them
   */
  constructor(lifecycle: RemoteLifecycleService, options: FederatedReferenceOptions) {
    this.lifecycle = lifecycle;
    this.options = options;
    // One render cache across compositions: its keys carry the document hash, so a rebuilt
    // inner service reuses every page of an unchanged document and can never serve a stale one.
    this.cache = options.cache ?? createMemoryRenderCache();
    this.catalog = buildAssetCatalog(options.assets.sources);
  }

  /** The lifecycle, so the module can start and stop what it mounted. */
  get remotes(): RemoteLifecycleService {
    return this.lifecycle;
  }

  /**
   * Answers one route from the current snapshot.
   *
   * @param id - Which route was matched
   * @param request - Parameters, headers and the nonce for this response
   * @returns The reply
   */
  async handle(id: ReferenceRouteId, request: ReferenceRequest): Promise<ReferenceReply> {
    // The one route that is about the federation rather than about the document: the snapshot
    // itself, minus the document and the report, whose bytes belong to the pages.
    if (id === 'federation') return Promise.resolve(this.federationReply());

    // Assets are readiness independent, so the 503 page keeps its stylesheet.
    if (id === 'asset') return Promise.resolve(this.asset(request));

    const snapshot = this.lifecycle.snapshot();

    if (snapshot.availability === 'unavailable') {
      return Promise.resolve(unavailableReply(id, snapshot.httpStatus, snapshot.reason));
    }

    return this.serviceFor(snapshot.document).handle(id, request);
  }

  /**
   * The live snapshot as the page fetches it, per SPEC 15.3: states without documents.
   *
   * ALWAYS 200 AND ALWAYS `no-store`. The endpoint reports the federation's state, and it
   * succeeded at reporting whichever state that is; the 503 belongs to the document routes,
   * whose promise is a document.
   */
  private federationReply(): ReferenceReply {
    const snapshot = this.lifecycle.snapshot();

    return {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': NO_STORE },
      body: JSON.stringify(publicSnapshot(snapshot)),
    };
  }

  /** One static file, the `ReferenceService` answer without a document behind it. */
  private asset(request: ReferenceRequest): ReferenceReply {
    const name = request.params[ASSET_PARAM] ?? '';
    const asset = this.catalog.byServedName.get(name);

    if (asset === undefined) return notFoundReply('asset');

    return {
      status: 200,
      headers: { 'content-type': asset.contentType, 'cache-control': IMMUTABLE },
      body: asset.bytes,
    };
  }

  /** The inner service for this composition, rebuilt only when the document changed. */
  private serviceFor(document: IRDocument): ReferenceService {
    if (this.inner?.hash !== document.hash) {
      this.inner = {
        hash: document.hash,
        service: new ReferenceService({ ...this.options, ir: document, cache: this.cache }),
      };
    }

    return this.inner.service;
  }
}

/**
 * The snapshot as it crosses the wire: everything but the document and the merge report.
 *
 * The two stay behind because they are the pages' material and the largest things the lifecycle
 * holds; what the page's status wiring needs is the states, and what an operator needs is the
 * reason.
 */
function publicSnapshot(snapshot: FederationSnapshot): Record<string, unknown> {
  if (snapshot.availability === 'unavailable') {
    return {
      availability: snapshot.availability,
      httpStatus: snapshot.httpStatus,
      reason: snapshot.reason,
      remotes: snapshot.remotes,
    };
  }

  return {
    availability: snapshot.availability,
    httpStatus: snapshot.httpStatus,
    degraded: snapshot.degraded,
    documentHash: snapshot.document.hash,
    remotes: snapshot.remotes,
    ...(snapshot.mergeError === undefined ? {} : { mergeError: snapshot.mergeError }),
  };
}

/**
 * The 503 of SPEC 15's `fail`, in the shape the route family answers with.
 *
 * PAGES GET WORDS IN HTML AND MACHINE ROUTES GET JSON, and both get the snapshot's own reason:
 * a reader and a probe are debugging the same outage and deserve the same sentence. No inline
 * style and no script, so the page stands under the strict CSP of SPEC 19 like every other.
 */
function unavailableReply(id: ReferenceRouteId, status: 503, reason: string): ReferenceReply {
  if (!PAGE_ROUTES.has(id)) {
    return {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': NO_STORE },
      body: JSON.stringify({ error: reason }),
    };
  }

  const body =
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Reference unavailable</title></head><body>' +
    '<h1>The federated reference is unavailable</h1>' +
    `<p>${escapeHtml(reason)}</p>` +
    '</body></html>';

  return {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': NO_STORE },
    body,
  };
}

/** The four characters that stop text being markup, escaped. */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

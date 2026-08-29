import {
  ErrorCode,
  FederationError,
  InvalidOptionsError,
  OpenRefError,
  RemoteUnavailableError,
  normalizeOpenApiDocument,
  parseSpecification,
} from '@openref/core';
import type { IRDocument } from '@openref/core';
import { mergeDocuments } from '../../../merge/domain/merge-documents';
import { compareText } from '../../../merge/domain/merge-report';
import type { MergeReport } from '../../../merge/domain/merge-report';
import { validateServices } from '../../../merge/domain/federation-options';
import type {
  FederationService,
  MergeDocumentsOptions,
} from '../../../merge/domain/federation-options';
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_REFRESH_MS,
  MAX_BACKOFF_MULTIPLIER,
  refreshDelayMs,
  resolveFailureMode,
  resolveIntervalMs,
  validateRemotes,
} from '../../domain/remote-config';
import type { FederationFailureMode, FederationRemoteConfig } from '../../domain/remote-config';
import { abortedPromise } from '../../domain/abort';
import { remoteStatusOf, toStateError } from '../../domain/remote-state';
import type {
  FederationRemoteState,
  FederationSnapshot,
  FederationStateError,
  RemoteAttemptOutcome,
} from '../../domain/remote-state';
import type { FederationCacheRecord, IFederationCacheDriver } from '../ports/cache-driver.port';
import type { IRemoteFetcher } from '../ports/remote-fetcher.port';
import { FetchRemoteAdapter } from '../../infrastructure/adapters/fetch-remote.adapter';
import { MemoryCacheAdapter } from '../../infrastructure/adapters/memory-cache.adapter';

/**
 * The remote lifecycle of SPEC 15: fetch, poll, degrade, recover.
 *
 * THE DONE-WHEN OF `T045` IS THE SHAPE OF THIS CLASS: one bad service cannot take down the
 * documentation of the others. Every mechanism here serves that sentence. Each remote is
 * fetched and polled on its own schedule, so a slow one delays nobody; every fetch is bounded
 * by a timeout the lifecycle enforces itself, so a hung one cannot hold a promise forever; a
 * failing remote keeps serving its last successful version under `degrade`, marked rather than
 * silent; and `snapshot()` is a synchronous read of settled state, so serving a page never
 * waits on a network.
 *
 * A MALFORMED DOCUMENT IS A FAILURE, NOT A PARTIAL MERGE. The body goes through the fail-closed
 * normalizer before anything else sees it, so a remote answering 200 with garbage degrades to
 * its cached version exactly like a remote answering nothing at all. There is no path on which
 * half a document reaches the merge.
 *
 * THE MERGE IS RECOMPUTED WHEN ITS INPUTS CHANGE AND ONLY THEN. The composition is keyed by the
 * sorted `(id, document hash)` pairs of the services it was built from; a refresh that fetched
 * byte-identical content produces the same key and the served document keeps its identity. The
 * hash comes from `core`'s canonical serialization, so the key is a fact about content rather
 * than about arrival order.
 */

/** Everything the lifecycle is configured with. */
export interface RemoteLifecycleOptions {
  /** The remotes to fetch and poll. May be empty only when `services` is not. */
  readonly remotes: readonly FederationRemoteConfig[];
  /**
   * Local services of this process, per SPEC 15.3: documents that already exist here, runtime
   * facts and health included, joining every composition as they are.
   *
   * THEY ARE NOT POLLED AND THEY HAVE NO STATUS, deliberately. The five statuses of SPEC 15.2
   * partition the outcomes of fetching, and a local document is not fetched: it is this
   * process's own, current by construction. It appears in the merged document's `services` and
   * in no remote state, and that absence is what says "local".
   */
  readonly services?: readonly FederationService[];
  /** Identity, header and conflict policy of the merged document, as the merge takes them. */
  readonly document: MergeDocumentsOptions;
  /** Poll interval while healthy. Defaults to SPEC 15's 60 000. */
  readonly refreshMs?: number;
  /** Ceiling on one fetch. Defaults to 10 000. */
  readonly timeoutMs?: number;
  /** What the route serves when a remote is not fresh. Defaults to `degrade`. */
  readonly failureMode?: FederationFailureMode;
  /** The fetcher to reach remotes with. Defaults to the runtime's own `fetch`. */
  readonly fetcher?: IRemoteFetcher;
  /** Where last successful versions are kept. Defaults to this process's memory. */
  readonly cache?: IFederationCacheDriver;
}

/** One version as held: the document itself, beside the facts the state reports about it. */
interface HeldVersion {
  readonly document: IRDocument;
  readonly fetchedAt: string;
  readonly fromCache: boolean;
}

/**
 * One remote's live bookkeeping. Mutable, private to the lifecycle.
 *
 * The clearable fields are `T | undefined` rather than optional, because clearing one is an
 * assignment this file performs and `exactOptionalPropertyTypes` holds an optional property to
 * presence, not to value.
 */
interface RemoteRuntime {
  readonly config: FederationRemoteConfig;
  outcome: RemoteAttemptOutcome;
  consecutiveFailures: number;
  version: HeldVersion | undefined;
  lastAttemptAt: string | undefined;
  nextAttemptAt: string | undefined;
  lastError: FederationStateError | undefined;
  timer: NodeJS.Timeout | undefined;
  inFlight: Promise<void> | undefined;
  controller: AbortController | undefined;
}

/** The merged document being served, with the key of the inputs it was built from. */
interface Composition {
  readonly key: string;
  readonly document: IRDocument;
  readonly report: MergeReport;
}

/** Fetches, polls and serves a federation of remotes. */
export class RemoteLifecycleService {
  private readonly remotes: Map<string, RemoteRuntime>;
  private readonly locals: readonly FederationService[];
  private readonly documentOptions: MergeDocumentsOptions;
  private readonly refreshMs: number;
  private readonly timeoutMs: number;
  private readonly failureMode: FederationFailureMode;
  private readonly fetcher: IRemoteFetcher;
  private readonly cache: IFederationCacheDriver;

  private running = false;
  private initialRound: Promise<void> | undefined;
  private composition: Composition | undefined;
  private mergeError: FederationStateError | undefined;

  /**
   * @param options - Remotes, local services, document identity, polling and failure policy
   * @throws {InvalidOptionsError} When a remote, a local service, an interval or a mode is
   *         unusable, or when neither a remote nor a local service is configured
   */
  constructor(options: RemoteLifecycleOptions) {
    const locals = options.services ?? [];
    // ONE GRAMMAR OVER THE WHOLE SET. Locals and remotes end up in one merge, so an id clash
    // between the two families is the same defect as one inside either, and it is refused by
    // the same validator. The URL rule stays the remotes' own, since a local has none.
    validateServices([...locals, ...options.remotes]);
    if (options.remotes.length > 0) validateRemotes(options.remotes);
    this.locals = [...locals].sort((left, right) => compareText(left.id, right.id));
    this.failureMode = resolveFailureMode(options.failureMode);
    // THE BACKOFF CEILING IS PART OF WHAT `refreshMs` MAY BE, because `refreshDelayMs` schedules up
    // to that many intervals and a timer cannot hold more than `MAX_TIMER_DELAY_MS`.
    this.refreshMs = resolveIntervalMs(
      options.refreshMs,
      'refreshMs',
      DEFAULT_REFRESH_MS,
      MAX_BACKOFF_MULTIPLIER,
    );
    this.timeoutMs = resolveIntervalMs(options.timeoutMs, 'timeoutMs', DEFAULT_FETCH_TIMEOUT_MS);
    this.documentOptions = options.document;
    this.fetcher = options.fetcher ?? new FetchRemoteAdapter();
    this.cache = options.cache ?? new MemoryCacheAdapter();

    // Sorted at construction, so every iteration below is in one order and nothing anywhere
    // depends on the order the configuration listed the remotes in. Same rule as the merge.
    const sorted = [...options.remotes].sort((left, right) => compareText(left.id, right.id));
    this.remotes = new Map(
      sorted.map((config) => [
        config.id,
        {
          config,
          outcome: 'none' as const,
          consecutiveFailures: 0,
          version: undefined,
          lastAttemptAt: undefined,
          nextAttemptAt: undefined,
          lastError: undefined,
          timer: undefined,
          inFlight: undefined,
          controller: undefined,
        },
      ]),
    );

    // A local document exists now, so a composition can too: a local-only federation serves
    // before and without `start()`, and a mixed one serves its locals while the first round of
    // fetches is still in flight, which is the degrade principle at second zero.
    if (this.locals.length > 0) this.recompute();
  }

  /**
   * Loads cached versions, then refreshes every remote once and starts polling.
   *
   * The returned promise settles when every remote's first attempt has settled, each bounded by
   * the fetch timeout, so awaiting it costs at most one timeout. A caller that would rather
   * serve the cache immediately and let the first round land in the background is free not to
   * await it: `snapshot()` is correct at every moment in between.
   *
   * Idempotent while running: a second call returns the same first round.
   *
   * @returns Settled when the first round is done
   */
  start(): Promise<void> {
    if (this.initialRound === undefined) {
      this.running = true;
      this.initialRound = this.runInitialRound();
    }
    return this.initialRound;
  }

  /**
   * Stops polling and abandons in-flight fetches.
   *
   * The last served state remains readable: stopping the lifecycle is not forgetting what it
   * knew. A later `start()` begins a new first round.
   */
  stop(): void {
    this.running = false;
    this.initialRound = undefined;

    for (const runtime of this.remotes.values()) {
      this.clearTimer(runtime);
      runtime.nextAttemptAt = undefined;
      runtime.controller?.abort(
        new RemoteUnavailableError(
          `the lifecycle was stopped while the request to remote "${runtime.config.id}" was in flight`,
          ErrorCode.FED_REMOTE_UNAVAILABLE,
          undefined,
          { remoteId: runtime.config.id },
        ),
      );
    }
  }

  /**
   * Refreshes one remote, or all of them, now.
   *
   * An attempt already in flight for a remote is joined rather than doubled, so a button wired
   * to this cannot stack requests onto a slow remote.
   *
   * @param remoteId - The remote to refresh, or nothing for all of them
   * @throws {InvalidOptionsError} When the id names no configured remote
   */
  async refresh(remoteId?: string): Promise<void> {
    if (remoteId === undefined) {
      await Promise.all([...this.remotes.values()].map((runtime) => this.refreshRemote(runtime)));
      return;
    }

    const runtime = this.remotes.get(remoteId);
    if (runtime === undefined) {
      throw new InvalidOptionsError(
        `no remote is configured with the id "${remoteId}"`,
        ErrorCode.CONFIG_INVALID_OPTIONS,
        undefined,
        { remoteId },
      );
    }

    await this.refreshRemote(runtime);
  }

  /**
   * What is being served right now: the merged document, or the reason there is none.
   *
   * Synchronous and side-effect free, so a route can call it on every request. Under `degrade`
   * the document is built from every remote that has any version, and the states say which of
   * them are not fresh; under `fail` anything short of every remote fresh is a 503, cache or no
   * cache, because that mode's promise is that a served document is a current one.
   *
   * @returns The snapshot
   */
  snapshot(): FederationSnapshot {
    const remotes = [...this.remotes.values()].map((runtime) => this.publicState(runtime));

    if (this.failureMode === 'fail') {
      const notFresh = remotes.filter((state) => state.status !== 'fresh').map((state) => state.id);
      if (notFresh.length > 0) {
        return {
          availability: 'unavailable',
          httpStatus: 503,
          reason:
            `failureMode is "fail" and ${notFresh.length === 1 ? 'remote' : 'remotes'} ` +
            `${notFresh.map((id) => `"${id}"`).join(', ')} ` +
            `${notFresh.length === 1 ? 'is' : 'are'} not serving a fresh version`,
          remotes,
        };
      }

      if (this.mergeError !== undefined) {
        return {
          availability: 'unavailable',
          httpStatus: 503,
          reason: `failureMode is "fail" and the services could not be merged: ${this.mergeError.message}`,
          remotes,
        };
      }
    }

    if (this.composition === undefined) {
      return {
        availability: 'unavailable',
        httpStatus: 503,
        reason:
          this.mergeError !== undefined
            ? `the services could not be merged: ${this.mergeError.message}`
            : 'no remote has a fetched or cached version to serve yet',
        remotes,
      };
    }

    const degraded = remotes.some((state) => state.status !== 'fresh');
    return {
      availability: 'ready',
      httpStatus: 200,
      document: this.composition.document,
      report: this.composition.report,
      remotes,
      degraded,
      ...(this.mergeError === undefined ? {} : { mergeError: this.mergeError }),
    };
  }

  /** Runs the cache load and the first refresh round. */
  private async runInitialRound(): Promise<void> {
    await Promise.all([...this.remotes.values()].map((runtime) => this.loadCached(runtime)));
    this.recompute();
    await Promise.all([...this.remotes.values()].map((runtime) => this.refreshRemote(runtime)));
  }

  /**
   * Revives one remote's cached version, when the driver has one this configuration can use.
   *
   * The body is re-normalized by the running normalizer, which is fail-closed: a record that no
   * longer parses is recorded on the remote's state by name and treated as absent, never served
   * as whatever it decodes to. A driver that throws is handled the same way, so a broken cache
   * cannot stop a start.
   */
  private async loadCached(runtime: RemoteRuntime): Promise<void> {
    if (runtime.version !== undefined) return;

    let record: FederationCacheRecord | undefined;
    try {
      record = await this.cache.load(runtime.config.id, runtime.config.url);
    } catch (cause) {
      runtime.lastError = toStateError(cause, this.now());
      return;
    }
    if (record === undefined) return;

    try {
      const document = this.readDocument(runtime.config, record.body);
      runtime.version = { document, fetchedAt: record.fetchedAt, fromCache: true };
      // Same coherence rule as a successful fetch: the version and the composition appear in
      // one synchronous step, so a snapshot between two remotes' cache loads is consistent.
      this.recompute();
    } catch (cause) {
      runtime.lastError = toStateError(
        new FederationError(
          `the cached version of remote "${runtime.config.id}" no longer normalizes and was discarded`,
          ErrorCode.FED_CACHE_INVALID,
          cause instanceof Error ? cause : undefined,
          { remoteId: runtime.config.id },
        ),
        this.now(),
      );
    }
  }

  /** Starts or joins one remote's refresh; schedules the next poll when it settles. */
  private refreshRemote(runtime: RemoteRuntime): Promise<void> {
    if (runtime.inFlight !== undefined) return runtime.inFlight;

    this.clearTimer(runtime);
    runtime.inFlight = this.attempt(runtime).finally(() => {
      runtime.inFlight = undefined;
      this.scheduleNext(runtime);
    });

    return runtime.inFlight;
  }

  /**
   * One refresh attempt. Never rejects: every outcome becomes recorded state.
   *
   * The timeout is enforced here rather than trusted to the fetcher, by aborting the signal
   * with a `RemoteUnavailableError` naming the limit; `fetch` rejects with the abort reason, so
   * the recorded failure is that error. A fetcher that ignores the signal entirely can keep its
   * own promise pending, but this attempt has already failed and the document moved on, which
   * is what "does not block beyond a bounded timeout" means.
   */
  private async attempt(runtime: RemoteRuntime): Promise<void> {
    const { id, url } = runtime.config;
    runtime.lastAttemptAt = this.now();

    const controller = new AbortController();
    runtime.controller = controller;

    // A box rather than a boolean, because the assignment happens inside the timer callback and
    // a plain `let` would be narrowed to `false` at the read below by control flow that cannot
    // see the callback run.
    const timedOut = { fired: false };
    const timeout = setTimeout(() => {
      timedOut.fired = true;
      controller.abort(
        new RemoteUnavailableError(
          `remote "${id}" did not answer inside ${String(this.timeoutMs)} ms`,
          ErrorCode.FED_REMOTE_UNAVAILABLE,
          undefined,
          { remoteId: id, url, timeoutMs: this.timeoutMs },
        ),
      );
    }, this.timeoutMs);
    timeout.unref();

    try {
      let raced;
      try {
        raced = await Promise.race([
          this.fetcher.fetch({ url, signal: controller.signal }),
          abortedPromise(controller.signal),
        ]);
      } catch (cause) {
        // Whatever a fetcher throws, the fact for the page is one: the remote could not be
        // fetched. A project error, the timeout above included, already says which fact it is
        // and keeps its code; a foreign one is classified here so the recorded code does not
        // depend on which fetcher implementation was plugged in.
        if (cause instanceof OpenRefError) throw cause;
        throw new RemoteUnavailableError(
          `remote "${id}" could not be fetched`,
          ErrorCode.FED_REMOTE_UNAVAILABLE,
          cause instanceof Error ? cause : undefined,
          { remoteId: id, url },
        );
      }

      if (raced.status < 200 || raced.status >= 300) {
        throw new RemoteUnavailableError(
          `remote "${id}" answered ${String(raced.status)} instead of a document`,
          ErrorCode.FED_REMOTE_UNAVAILABLE,
          undefined,
          { remoteId: id, url, status: raced.status },
        );
      }

      const document = this.readDocument(runtime.config, raced.body);
      const fetchedAt = this.now();

      runtime.version = { document, fetchedAt, fromCache: false };
      runtime.outcome = 'success';
      runtime.consecutiveFailures = 0;
      runtime.lastError = undefined;
      // Recomputed here, in the same synchronous block as the state change, and not only in the
      // `finally`: the cache save below is an await, and a snapshot taken inside that window
      // would otherwise show a remote already fresh beside a document not yet carrying its new
      // version. The state and the page move together or the mark is a lie for a tick.
      this.recompute();

      try {
        await this.cache.save(id, { url, fetchedAt, body: raced.body });
      } catch (cause) {
        // A cache that cannot be written must not fail a fetch that succeeded; the document is
        // served either way. The failure is recorded where an operator can see that a restart
        // would not find this version.
        runtime.lastError = toStateError(cause, this.now());
      }
    } catch (cause) {
      // A stop mid-flight aborts the fetch; that is the lifecycle's doing, not a fact about the
      // remote, so it is not recorded as one. THE ABORT IS THE TEST, NOT THE RUNNING FLAG: a
      // `refresh()` called while stopped or never started runs with `running` false the whole
      // way, and its real failure, network or status alike, was being swallowed here, leaving
      // the status at pending or stale with no `lastError`. Carried from `T045`'s review and
      // closed with the route that made the surface reachable. The timeout stays recorded even
      // though it aborts the same signal, because its firing is a fact about the remote.
      if (!this.running && controller.signal.aborted && !timedOut.fired) return;

      runtime.outcome = 'failure';
      runtime.consecutiveFailures += 1;
      runtime.lastError = toStateError(cause, this.now());
    } finally {
      clearTimeout(timeout);
      runtime.controller = undefined;
      this.recompute();
    }
  }

  /** Schedules the next poll of one remote, backing off while it fails. */
  private scheduleNext(runtime: RemoteRuntime): void {
    if (!this.running) {
      runtime.nextAttemptAt = undefined;
      return;
    }

    const delay = refreshDelayMs(this.refreshMs, runtime.consecutiveFailures);
    runtime.nextAttemptAt = new Date(Date.now() + delay).toISOString();

    const timer = setTimeout(() => {
      runtime.timer = undefined;
      void this.refreshRemote(runtime);
    }, delay);
    timer.unref();
    runtime.timer = timer;
  }

  /**
   * Rebuilds the served composition when the set of available versions changed.
   *
   * A merge refusal keeps the last good composition and records the refusal: dropping the whole
   * reference because one refresh introduced a conflict would be one bad service taking down
   * the documentation of the others, which is the exact sentence this task forbids. The
   * refusal is visible on the snapshot, and under `fail` it is a 503 instead.
   */
  private recompute(): void {
    const services = this.availableServices();
    if (services.length === 0) return;

    const key = services.map((service) => `${service.id}:${service.document.hash}`).join(' ');
    if (this.composition?.key === key) {
      this.mergeError = undefined;
      return;
    }

    try {
      const result = mergeDocuments(services, this.documentOptions);
      this.composition = { key, document: result.document, report: result.report };
      this.mergeError = undefined;
    } catch (cause) {
      this.mergeError = toStateError(cause, this.now());

      // A held composition survives the refusal only when it is a previous version of the same
      // set of services. A composition of a smaller set is a transient of the initial round,
      // and serving it under a standing refusal would make the page depend on which remote
      // answered first, which is the tie-by-network the merge itself refuses to break.
      const ids = services.map((service) => service.id).join(' ');
      if (this.composition !== undefined && this.composition.report.serviceIds.join(' ') !== ids) {
        this.composition = undefined;
      }
    }
  }

  /**
   * The services the current mode would serve, in sorted id order: every local service, per
   * SPEC 15.3, and every remote with a version.
   */
  private availableServices(): FederationService[] {
    const services: FederationService[] = [...this.locals];

    for (const runtime of this.remotes.values()) {
      if (runtime.version === undefined) continue;
      services.push({
        id: runtime.config.id,
        document: runtime.version.document,
        ...(runtime.config.prefix === undefined ? {} : { prefix: runtime.config.prefix }),
      });
    }

    return services.sort((left, right) => compareText(left.id, right.id));
  }

  /** Parses and normalizes one fetched body. Fail-closed: garbage throws, nothing guesses. */
  private readDocument(config: FederationRemoteConfig, body: string): IRDocument {
    const parsed = parseSpecification(body, { source: config.url });
    return normalizeOpenApiDocument(parsed, { documentId: config.id });
  }

  /** One remote's state as the page sees it. */
  private publicState(runtime: RemoteRuntime): FederationRemoteState {
    const version = runtime.version;

    return {
      id: runtime.config.id,
      status: remoteStatusOf(runtime.outcome, version !== undefined),
      consecutiveFailures: runtime.consecutiveFailures,
      ...(version === undefined
        ? {}
        : {
            version: {
              fetchedAt: version.fetchedAt,
              documentHash: version.document.hash,
              fromCache: version.fromCache,
            },
          }),
      ...(runtime.lastAttemptAt === undefined ? {} : { lastAttemptAt: runtime.lastAttemptAt }),
      ...(runtime.nextAttemptAt === undefined ? {} : { nextAttemptAt: runtime.nextAttemptAt }),
      ...(runtime.lastError === undefined ? {} : { lastError: runtime.lastError }),
    };
  }

  private clearTimer(runtime: RemoteRuntime): void {
    if (runtime.timer !== undefined) {
      clearTimeout(runtime.timer);
      runtime.timer = undefined;
    }
  }

  private now(): string {
    return new Date().toISOString();
  }
}

import { OpenRefError } from '@openref/core';
import type { IRDocument } from '@openref/core';
import type { MergeReport } from '../../merge/domain/merge-report';

/**
 * What the lifecycle knows about its remotes and its document, said out loud.
 *
 * THE TASK'S OWN WORDS ARE "VISIBLE RATHER THAN SILENT", AND THIS FILE IS WHERE VISIBLE IS
 * DEFINED. A degraded remote that renders exactly like a fresh one is a lie with a cache behind
 * it, so every state here carries the facts a page needs to say so: which version is being
 * served, where it came from, what the last failure was and when the next attempt is. All of it
 * is plain serializable data, because `T046` puts it in front of a reader.
 */

/**
 * Where one remote stands, as a partition over two observable facts: whether a version is being
 * served, and how the last completed attempt of this process ended.
 *
 * - `pending`: no attempt has completed and there is nothing to serve.
 * - `stale`: no attempt has completed, and a version from the cache driver is being served.
 *   It exists for the window right after a restart, which is not `fresh`, because this process
 *   has confirmed nothing, and not `degraded`, because nothing has failed.
 * - `fresh`: the last attempt succeeded; the served version is the remote's current document.
 * - `degraded`: the last attempt failed and an earlier version is still being served, which is
 *   SPEC 15's `degrade` in effect.
 * - `failed`: the last attempt failed and there is no version to serve at all.
 */
export type RemoteStatus = 'pending' | 'stale' | 'fresh' | 'degraded' | 'failed';

/** How the last completed refresh attempt of this process ended, or that none has. */
export type RemoteAttemptOutcome = 'none' | 'success' | 'failure';

/**
 * Derives the status from the two facts it is defined over.
 *
 * A total function rather than a field kept by hand, so the status can never disagree with the
 * facts it summarizes.
 *
 * @param outcome - How the last completed attempt ended
 * @param hasVersion - Whether any version is available to serve
 * @returns The status of the partition
 */
export function remoteStatusOf(outcome: RemoteAttemptOutcome, hasVersion: boolean): RemoteStatus {
  if (outcome === 'success') return 'fresh';
  if (outcome === 'failure') return hasVersion ? 'degraded' : 'failed';
  return hasVersion ? 'stale' : 'pending';
}

/**
 * One recorded failure, reduced to what a page and a log both need.
 *
 * `code` is the `ErrorCode` value when the failure carried one, and the error's name otherwise,
 * because a fetch can fail inside a runtime library that has never heard of this project and
 * the provenance still matters.
 */
export interface FederationStateError {
  /** When the failure was recorded, ISO 8601. */
  readonly at: string;
  /** `ErrorCode` value, or the error's constructor name for a foreign error. */
  readonly code: string;
  /** Human readable description, safe to render. */
  readonly message: string;
}

/**
 * Reduces an unknown failure to the recorded shape.
 *
 * @param cause - Whatever was thrown
 * @param at - When it was recorded, ISO 8601
 * @returns The failure as state
 */
export function toStateError(cause: unknown, at: string): FederationStateError {
  if (cause instanceof OpenRefError) return { at, code: cause.code, message: cause.message };
  if (cause instanceof Error) return { at, code: cause.name, message: cause.message };
  return { at, code: 'UnknownError', message: String(cause) };
}

/** The version of one remote being served, described rather than carried. */
export interface RemoteVersionInfo {
  /** When this version was fetched from the remote, ISO 8601. */
  readonly fetchedAt: string;
  /** Hash of the normalized document, so two states can be compared without the documents. */
  readonly documentHash: string;
  /** True when the version arrived from the cache driver rather than a fetch of this process. */
  readonly fromCache: boolean;
}

/** Everything one remote's row on a page needs. */
export interface FederationRemoteState {
  readonly id: string;
  readonly status: RemoteStatus;
  /** Failures since the last success. Zero while healthy; drives the backoff. */
  readonly consecutiveFailures: number;
  /** The version being served. Absent when there is none. */
  readonly version?: RemoteVersionInfo;
  /** When the last refresh attempt started, ISO 8601. Absent before the first. */
  readonly lastAttemptAt?: string;
  /** When the next scheduled attempt is due, ISO 8601. Absent while polling is stopped. */
  readonly nextAttemptAt?: string;
  /** The last recorded failure. Cleared by a successful refresh. */
  readonly lastError?: FederationStateError;
}

/**
 * The document is being served.
 *
 * `degraded` is the one-line answer for a banner: true whenever any configured remote is not
 * serving a fresh version, whether it is failing over its cache or missing entirely. The detail
 * of which one and why is in `remotes`.
 */
export interface FederationReadySnapshot {
  readonly availability: 'ready';
  /** What the route answers, so the route reads a decision instead of making one. */
  readonly httpStatus: 200;
  readonly document: IRDocument;
  readonly report: MergeReport;
  /** Per remote state, sorted by id. */
  readonly remotes: readonly FederationRemoteState[];
  /** True when any remote is not fresh. The visible mark the task requires. */
  readonly degraded: boolean;
  /**
   * The last merge refusal, when the served composition predates it.
   *
   * Present, it says the current set of fetched versions could not be merged and the document
   * shown is the last one that could, which is the `degrade` principle applied one level up:
   * serve the last good thing and say so.
   */
  readonly mergeError?: FederationStateError;
}

/** Nothing can be served, and the route answers 503, per SPEC 15's `fail`. */
export interface FederationUnavailableSnapshot {
  readonly availability: 'unavailable';
  /** What the route answers, so the route reads a decision instead of making one. */
  readonly httpStatus: 503;
  /** Why, naming the remotes or the merge failure responsible. */
  readonly reason: string;
  /** Per remote state, sorted by id, so the page can still say what is known. */
  readonly remotes: readonly FederationRemoteState[];
}

/** What the lifecycle serves at one moment: a document, or the reason there is none. */
export type FederationSnapshot = FederationReadySnapshot | FederationUnavailableSnapshot;

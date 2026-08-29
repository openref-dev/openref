import { ErrorCode, InvalidOptionsError } from '@openref/core';
import { validateServices } from '../../merge/domain/federation-options';

/**
 * What one federated remote is, and the polling rules SPEC 15 configures around it.
 *
 * EVERYTHING HERE IS CHECKED BEFORE THE FIRST REQUEST LEAVES THE PROCESS. A remote's id shares
 * the obligations of a merge service id, because it is one: the same value later prefixes node
 * ids and names a cache file. Its URL is the one address class this product is permitted to
 * fetch from the server side, per SPEC 16's "zero external requests except federation remote
 * URLs", so what counts as a URL is an allowlist of two schemes rather than whatever `fetch`
 * would accept.
 */

/** What happens to the route when a remote cannot be served fresh, per SPEC 15. */
export type FederationFailureMode = 'degrade' | 'fail';

/** Every failure mode, in the order SPEC 15 prints them. */
export const FEDERATION_FAILURE_MODES: readonly FederationFailureMode[] = ['degrade', 'fail'];

/** The default, which is the mode SPEC 15's own example configures. */
export const DEFAULT_FAILURE_MODE: FederationFailureMode = 'degrade';

/** Poll interval when the last attempt succeeded, from SPEC 15's example. */
export const DEFAULT_REFRESH_MS = 60_000;

/**
 * How long one fetch may take before it is cancelled.
 *
 * The task's own wording is the reason a default exists at all: a remote that is slow rather
 * than down must not block the document beyond a bounded time. Ten seconds is far above what a
 * healthy service needs to serve a static document and far below a reader deciding the page is
 * broken. An operator who knows their remote is slower says so with `timeoutMs`.
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

/**
 * Ceiling on the failure backoff, as a multiple of `refreshMs`.
 *
 * BOUNDED, BECAUSE THE POINT OF POLLING IS TO NOTICE RECOVERY. An unbounded doubling turns one
 * long outage into a poller that effectively never looks again, which reads as a remote that
 * never came back. Eight keeps a failing remote from being hammered while keeping the worst
 * recovery lag at eight refresh intervals.
 */
export const MAX_BACKOFF_MULTIPLIER = 8;

/** One remote in the federation configuration: identity, address and mount. */
export interface FederationRemoteConfig {
  /** Identity of the service, under the same grammar as a merge service id. */
  readonly id: string;
  /** Where the remote's specification document is fetched from. `http` or `https` only. */
  readonly url: string;
  /** Path prefix the service is mounted under, such as `/billing`. */
  readonly prefix?: string;
}

/**
 * Refuses a remote list that cannot be polled.
 *
 * Ids and prefixes go through the merge's own `validateServices`, because a remote is a merge
 * service in waiting and two rules about one grammar is the defect class this repository keeps
 * finding. The URL check is this file's own, since a merge never sees one.
 *
 * @param remotes - The remotes as configured, in any order
 * @throws {InvalidOptionsError} When the list is empty, an id or prefix is unusable, an id is
 *         repeated, or a URL is not absolute `http` or `https`
 */
export function validateRemotes(remotes: readonly FederationRemoteConfig[]): void {
  validateServices(remotes);

  for (const remote of remotes) {
    validateRemoteUrl(remote.id, remote.url);
  }
}

/**
 * Refuses a failure mode string that is not one of the two.
 *
 * @param mode - Whatever the caller configured, or nothing
 * @returns The mode to serve under
 * @throws {InvalidOptionsError} When the value is not a mode SPEC 15 defines
 */
export function resolveFailureMode(mode: FederationFailureMode | undefined): FederationFailureMode {
  if (mode === undefined) return DEFAULT_FAILURE_MODE;

  if (!FEDERATION_FAILURE_MODES.includes(mode)) {
    throw new InvalidOptionsError(
      `failureMode is "${mode as string}", which is not one of ` +
        FEDERATION_FAILURE_MODES.join(', '),
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { failureMode: mode },
    );
  }

  return mode;
}

/**
 * Resolves one of the millisecond options, refusing a value that is not a duration.
 *
 * @param value - Whatever the caller configured, or nothing
 * @param name - Option name, so a message says which one
 * @param fallback - Default when nothing was configured
 * @returns Milliseconds, a positive integer
 * @throws {InvalidOptionsError} When the value is not a positive integer
 */
export function resolveIntervalMs(
  value: number | undefined,
  name: string,
  fallback: number,
): number {
  if (value === undefined) return fallback;

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidOptionsError(
      `${name} is ${String(value)}, and it is a duration in milliseconds: a positive integer`,
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { [name]: value },
    );
  }

  return value;
}

/**
 * How long to wait before the next poll of one remote.
 *
 * A healthy remote is polled every `refreshMs`. A failing one backs off by doubling, capped at
 * {@link MAX_BACKOFF_MULTIPLIER} times the interval: the first failure retries after one plain
 * interval, because one blip does not deserve a penalty, and sustained failure grows the gap so
 * a down remote is not hammered at the healthy rate.
 *
 * DETERMINISTIC, WITH NO JITTER, AND THAT IS A DECISION RATHER THAN AN OMISSION. Jitter defends
 * a fleet of clients against synchronizing on one origin; this poller is one process asking for
 * one document, and a deterministic schedule is the one a test can assert and an operator can
 * predict.
 *
 * @param refreshMs - The configured healthy interval
 * @param consecutiveFailures - Failures since the last success, zero when healthy
 * @returns Milliseconds until the next attempt
 */
export function refreshDelayMs(refreshMs: number, consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return refreshMs;

  const multiplier = Math.min(2 ** (consecutiveFailures - 1), MAX_BACKOFF_MULTIPLIER);
  return refreshMs * multiplier;
}

/**
 * Checks one remote URL against the allowlist.
 *
 * `http` is allowed beside `https` deliberately: the primary shape of federation is a gateway
 * reading sibling services inside one cluster, where plain HTTP on a private network is the
 * ordinary case. What is refused is everything else, because a `file:` or custom scheme here
 * would turn a configuration value into a local file read performed by this process.
 *
 * @param id - Remote the URL belongs to, so a message names it
 * @param url - The configured URL
 * @throws {InvalidOptionsError} When the URL does not parse or carries another scheme
 */
function validateRemoteUrl(id: string, url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (cause) {
    throw new InvalidOptionsError(
      `the url of remote "${id}" is not an absolute URL: ${JSON.stringify(url)}`,
      ErrorCode.CONFIG_INVALID_OPTIONS,
      cause instanceof Error ? cause : undefined,
      { remoteId: id },
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidOptionsError(
      `the url of remote "${id}" uses the scheme "${parsed.protocol}", and a remote is fetched ` +
        'over http or https only',
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { remoteId: id },
    );
  }
}

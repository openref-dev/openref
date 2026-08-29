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

/**
 * Longest delay a platform timer holds, which is a 32 bit signed millisecond count.
 *
 * A LONGER DELAY DOES NOT WAIT LONGER, IT FIRES AT ONCE, and T047 measured both halves of what
 * that costs. A `refreshMs` of 2 147 484 648 produced 44 fetches in 60 ms instead of one every
 * 24.9 days, so the configuration that asks for the rarest possible poll produces the busiest
 * one; a `timeoutMs` of the same size cut off an answer that arrived in 20 ms and recorded that
 * the remote "did not answer inside 2147484648 ms", which is a page telling an operator something
 * untrue about their service. Recorded in SPEC 15.2 with the measurement.
 */
export const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

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
 * THE UPPER BOUND IS PART OF BEING A DURATION HERE, because the value becomes a timer delay and a
 * delay a timer cannot hold does not wait longer, it fires at once. See {@link MAX_TIMER_DELAY_MS}
 * for the two measurements. The caller passes the largest multiple of this value that will be
 * scheduled, which is the backoff ceiling for `refreshMs` and one for `timeoutMs`, so the refusal
 * is about the delay that will really be asked for rather than about the option in isolation.
 *
 * ROUNDING DOWN WAS REFUSED. An operator who asks for one poll a week and silently gets one a day
 * has been answered by something that never says so, which is the class of quiet substitution this
 * project refuses everywhere else.
 *
 * @param value - Whatever the caller configured, or nothing
 * @param name - Option name, so a message says which one
 * @param fallback - Default when nothing was configured
 * @param scheduledMultiple - Largest multiple of the value that reaches a timer. Defaults to one
 * @returns Milliseconds, a positive integer a timer can hold at that multiple
 * @throws {InvalidOptionsError} When the value is not a positive integer, or when the multiple of
 *         it that will be scheduled is past what a timer holds
 */
export function resolveIntervalMs(
  value: number | undefined,
  name: string,
  fallback: number,
  scheduledMultiple = 1,
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

  const ceiling = Math.floor(MAX_TIMER_DELAY_MS / scheduledMultiple);
  if (value > ceiling) {
    throw new InvalidOptionsError(
      `${name} is ${String(value)} ms and the limit is ${String(ceiling)} ms, because ` +
        (scheduledMultiple === 1
          ? 'a timer holds a delay of at most ' + String(MAX_TIMER_DELAY_MS) + ' ms'
          : `the backoff schedules up to ${String(scheduledMultiple)} of these intervals and a ` +
            `timer holds a delay of at most ${String(MAX_TIMER_DELAY_MS)} ms`) +
        '; a longer delay does not wait longer, it fires at once, which turns a rare poll into a ' +
        'hot loop and a long timeout into an immediate one',
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { [name]: value, limitMs: ceiling },
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

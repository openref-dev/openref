/**
 * Every control SPEC 14.8 names, with the default each one arrives at.
 *
 * THE LIMITER IS THE FEATURE AND NOT A REFINEMENT OF IT, which is why the defaults are the strict
 * end of every scale and why two of them refuse everything. A broker hands out thousands of
 * messages a second; a bridge that pipes them into a response is a Node process that dies by
 * memory, and it dies on the deployment rather than here. So `enabled` is false, `channels` is
 * empty and empty means nothing is allowed, and every other number is a ceiling rather than a
 * hint.
 *
 * NOTHING HERE IS INFERRED FROM THE DOCUMENT, which is the one place this differs from the proxy
 * of SPEC 14.5. The proxy builds its allowlist out of the document's own `servers`, because a
 * server is an address the document already published. A channel is not: the document says a
 * channel exists, not that a reader may subscribe to it through this deployment, and reading the
 * allowlist off the document would turn every declared channel into a live subscription the day
 * the bridge is switched on.
 */

import { ErrorCode, InvalidOptionsError } from '@openref/core';
import type { IBridgeSource } from '../application/ports/bridge-source.port';

/** What happens to a message when the ring is full, per SPEC 14.8. */
export type BridgeOverflowMode = 'drop-oldest' | 'drop-new' | 'disconnect';

/** Every value {@link BridgeOverflowMode} allows, as data, so a value off the type is refused. */
export const BRIDGE_OVERFLOW_MODES: readonly BridgeOverflowMode[] = [
  'drop-oldest',
  'drop-new',
  'disconnect',
];

/** The bridge of SPEC 14.8, off unless this says otherwise. */
export interface BridgeOptions {
  /**
   * Turns the bridge on. Absent or false means every subscription is refused.
   *
   * OFF IS THE DEFAULT FOR THE REASON THE PROXY IS OFF BY DEFAULT, one step further along. The
   * proxy sends one request and answers it; the bridge holds a response open and keeps a broker
   * subscription alive behind it, so what a host turns on here is a resource that stays.
   */
  readonly enabled?: boolean;
  /**
   * The channels a reader may subscribe to, by address.
   *
   * AN EXPLICIT LIST, AND EMPTY MEANS NOTHING, per SPEC 14.8. It is not defaulted from the
   * document's channels: a document says a channel exists, and this says a reader may listen to
   * it through this deployment, which are two different statements about two different systems.
   */
  readonly channels?: readonly string[];
  /** Ceiling on how many messages a second reach one reader. Defaults to 50. */
  readonly maxMessagesPerSecond?: number;
  /** Entries the ring holds while the reader is behind. Defaults to 500. */
  readonly bufferSize?: number;
  /**
   * Bytes the ring holds while the reader is behind. Defaults to 1 MiB.
   *
   * THE SECOND CEILING ON ONE BUFFER, AND SPEC 14.8 RECORDS WHY IT EXISTS. `bufferSize` bounds how
   * many entries wait and says nothing about how large they are, so a producer of large messages
   * fills a bounded ring with unbounded memory: measured at `T059`, 200 messages of one megabyte
   * against a ring of fifty left `buffered: 50`, which is 50.0 MB retained where this ceiling
   * retains 1.0 MB. Retention rather than RSS, which reads 351 to 403 MB on unchanged code and so
   * measures allocation churn rather than the bound. Both ceilings are the same
   * question and are answered by the same three overflow voices, so nothing is lost in silence.
   */
  readonly maxBufferedBytes?: number;
  /** What a full ring does with a message. Defaults to `drop-oldest`. */
  readonly onOverflow?: BridgeOverflowMode;
  /** Ceiling on one subscription, in seconds. Defaults to 300. */
  readonly maxConnectionSeconds?: number;
  /** How many subscriptions this mount serves at once. Defaults to 5. */
  readonly maxConcurrentSubscriptions?: number;
  /**
   * Where messages come from, per SPEC 14.8.
   *
   * REQUIRED WHEN THE BRIDGE IS ENABLED, AND CHECKED AT BOOT. This package ships no broker client
   * and may not choose one for a host; what it can do is refuse to mount a bridge that has nothing
   * to bridge, so "enabled with nothing behind it" is a state the wire never sees.
   */
  readonly source?: IBridgeSource;
}

/** Ceiling on messages a second, when the host names none. */
export const DEFAULT_BRIDGE_MESSAGES_PER_SECOND = 50;

/** Entries the ring holds, when the host names none. */
export const DEFAULT_BRIDGE_BUFFER_SIZE = 500;

/**
 * Bytes the ring holds, when the host names none.
 *
 * DERIVED RATHER THAN CHOSEN, per SPEC 14.8: it is {@link DEFAULT_BRIDGE_BUFFER_SIZE} entries at
 * about two kilobytes each, which is the size the old flat memory claim silently assumed. A host
 * whose messages are larger raises it and knows that it is raising it.
 */
export const DEFAULT_BRIDGE_BUFFERED_BYTES = 1_048_576;

/**
 * Longest `maxConnectionSeconds` a timer can actually hold, per SPEC 14.8.
 *
 * `setTimeout` in Node takes a 32-bit signed millisecond delay, and a larger one fires at once with
 * a `TimeoutOverflowWarning`. Measured at `T059`: `maxConnectionSeconds: 2_147_484` closed the
 * subscription on the first millisecond saying it had reached its ceiling of 2147484 seconds, and
 * 2_147_483 held it open. A ceiling that ends the thing it is meant to bound is the `T047` defect
 * class, which the check below already named and refused on one side only.
 */
export const MAX_BRIDGE_CONNECTION_SECONDS = 2_147_483;

/** What a full ring does, when the host names nothing. */
export const DEFAULT_BRIDGE_OVERFLOW: BridgeOverflowMode = 'drop-oldest';

/** Ceiling on one subscription in seconds, when the host names none. */
export const DEFAULT_BRIDGE_CONNECTION_SECONDS = 300;

/** Subscriptions served at once, when the host names none. */
export const DEFAULT_BRIDGE_CONCURRENT_SUBSCRIPTIONS = 5;

/** How often a coalesced drop notice reaches the reader, in milliseconds. */
export const BRIDGE_DROP_NOTICE_MS = 1000;

/** The options with every default filled in, which is what the service is built from. */
export interface ResolvedBridgeOptions {
  readonly enabled: boolean;
  readonly channels: readonly string[];
  readonly maxMessagesPerSecond: number;
  readonly bufferSize: number;
  readonly maxBufferedBytes: number;
  readonly onOverflow: BridgeOverflowMode;
  readonly maxConnectionSeconds: number;
  readonly maxConcurrentSubscriptions: number;
}

/**
 * Refuses a bridge configuration that cannot do what it says, before anything is mounted.
 *
 * EVERY NUMBER IS CHECKED AS A FINITE POSITIVE INTEGER RATHER THAN AS A TRUTHY VALUE, because the
 * failure modes of the alternatives are silent. `maxMessagesPerSecond: 0` is a bridge that
 * delivers nothing while reporting itself open; `bufferSize: 0` is a ring that drops every message
 * and calls it overflow; a fractional second on `maxConnectionSeconds` is a timer that fires
 * immediately, which is the defect `T047` found in the federation lifecycle and which is refused
 * here at construction for the same reason.
 *
 * @param label - What is being configured, for the message
 * @param options - Whatever the host wrote, if anything
 * @throws {InvalidOptionsError} When the bridge is switched on with nothing behind it, or when a
 *   control is not a value the limiter can honour
 */
export function assertBridgeOptions(label: string, options: BridgeOptions | undefined): void {
  if (options === undefined) return;

  if (options.enabled === true && options.source === undefined) {
    throw invalid(
      `${label} enables the broker bridge and hands it no source. The bridge subscribes through ` +
        'the IBridgeSource a host supplies, because this package ships no broker client and may ' +
        'not choose one; an enabled bridge with nothing behind it is refused here rather than ' +
        'answered with an empty stream',
    );
  }

  positive(label, 'maxMessagesPerSecond', options.maxMessagesPerSecond);
  positive(label, 'bufferSize', options.bufferSize);
  positive(label, 'maxBufferedBytes', options.maxBufferedBytes);
  positive(label, 'maxConnectionSeconds', options.maxConnectionSeconds);
  positive(label, 'maxConcurrentSubscriptions', options.maxConcurrentSubscriptions);

  // THE OTHER END OF THE SAME CHECK, added at `T059`. `positive` refuses a fraction because a
  // fractional second is a timer that fires at once; a value past the 32-bit millisecond ceiling
  // fires at once for the same reason and was accepted. Both directions now name the same defect.
  if (
    options.maxConnectionSeconds !== undefined &&
    options.maxConnectionSeconds > MAX_BRIDGE_CONNECTION_SECONDS
  ) {
    throw invalid(
      `${label} sets bridge.maxConnectionSeconds to ${String(options.maxConnectionSeconds)}. The ` +
        `longest a timer can hold is ${String(MAX_BRIDGE_CONNECTION_SECONDS)} seconds, because ` +
        'setTimeout takes a 32-bit millisecond delay and a larger one fires immediately: the ' +
        'subscription would close on its first millisecond claiming it had reached a ceiling of ' +
        'that many seconds, which is a limit that ends the thing it is meant to bound',
    );
  }

  if (options.onOverflow !== undefined && !BRIDGE_OVERFLOW_MODES.includes(options.onOverflow)) {
    throw invalid(
      `${label} asks for the overflow mode "${options.onOverflow}", and the modes SPEC ` +
        `14.8 names are ${BRIDGE_OVERFLOW_MODES.join(', ')}`,
    );
  }

  for (const channel of options.channels ?? []) {
    if (typeof channel !== 'string' || channel === '') {
      throw invalid(
        `${label} lists an empty channel address in the bridge allowlist. An empty list is how a ` +
          'host says that nothing is allowed; an empty entry inside one says nothing at all',
      );
    }
  }
}

/**
 * Fills in every default SPEC 14.8 prints.
 *
 * @param options - Whatever the host wrote, if anything
 * @returns The controls the service reads, with no member left to be decided later
 */
export function resolveBridgeOptions(options: BridgeOptions | undefined): ResolvedBridgeOptions {
  return {
    enabled: options?.enabled === true,
    channels: options?.channels === undefined ? [] : [...options.channels],
    maxMessagesPerSecond: options?.maxMessagesPerSecond ?? DEFAULT_BRIDGE_MESSAGES_PER_SECOND,
    bufferSize: options?.bufferSize ?? DEFAULT_BRIDGE_BUFFER_SIZE,
    maxBufferedBytes: options?.maxBufferedBytes ?? DEFAULT_BRIDGE_BUFFERED_BYTES,
    onOverflow: options?.onOverflow ?? DEFAULT_BRIDGE_OVERFLOW,
    maxConnectionSeconds: options?.maxConnectionSeconds ?? DEFAULT_BRIDGE_CONNECTION_SECONDS,
    maxConcurrentSubscriptions:
      options?.maxConcurrentSubscriptions ?? DEFAULT_BRIDGE_CONCURRENT_SUBSCRIPTIONS,
  };
}

/**
 * Refuses a control that is not a finite positive integer.
 *
 * @param label - What is being configured
 * @param name - Which control
 * @param value - What the host wrote, if anything
 * @throws {InvalidOptionsError} When the value cannot be honoured as a ceiling
 */
function positive(label: string, name: string, value: number | undefined): void {
  if (value === undefined) return;

  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalid(
      `${label} sets bridge.${name} to ${String(value)}. It is a ceiling, so it has to be a whole ` +
        'number of at least one: anything else is a limiter that reports a limit it does not have',
    );
  }
}

/**
 * The error every refusal above raises.
 *
 * @param message - What is wrong, phrased for whoever wrote the options
 * @returns The error to throw
 */
function invalid(message: string): InvalidOptionsError {
  return new InvalidOptionsError(message, ErrorCode.CONFIG_INVALID_OPTIONS);
}

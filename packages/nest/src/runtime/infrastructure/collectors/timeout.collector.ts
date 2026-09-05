/**
 * `timeoutCollector({ metadataKey })`, the collector of SPEC 6.2.1 for the timeout row.
 *
 * THE VALUE COMES FROM METADATA UNDER THE HOST'S KEY AND FROM NOTHING ELSE. An interceptor's
 * class name is not a number, and its logic is never read, on the same grounds a guard's is
 * never read: what an interceptor does depends on the observable it wraps, and the number it
 * would race against lives in its code. The application that wants the number in its reference
 * declares it where its own interceptor reads it, which is the same declare-once shape as the
 * scopes key.
 *
 * `getAllAndOverride`, THE SCOPES RULE AND NOT THE GUARDS RULE: a route that overrides its
 * timeout has that timeout, not both. A value that is not a positive finite number becomes a
 * `doctor` problem rather than a coerced fact, and no 504 contract is derived from any of this,
 * per SPEC 6.4's exactly-two rule.
 */

import type { IRNodeRuntime } from '@openref/core';
import type {
  CollectorContext,
  IRuntimeCollector,
  SkippedCollector,
} from '../../application/ports/collector.port';

/** The name this collector stamps on everything it reports, per SPEC 6.2. */
export const TIMEOUT_COLLECTOR_NAME = 'timeoutCollector';

/** What a host must tell the collector, because it cannot be worked out. */
export interface TimeoutCollectorOptions {
  /** The key the application's own decorator writes the milliseconds under. Never guessed. */
  readonly metadataKey: string | symbol;
}

/** What the collector could not read, kept per node for `doctor`. */
export interface TimeoutCollectorProblem {
  /** `OrdersController.list`, as a reader recognises it. */
  readonly subject: string;
  /** The cause and what is not known because of it, in one clause, per SPEC 7.1. */
  readonly reason: string;
  /** The action, or that there is none and why the finding is recorded anyway, per SPEC 7.1. */
  readonly action: string;
  /** The reasoning behind it, for a reader who opens it. Absent where the cause is its own. */
  readonly detail?: string;
}

/** The collector, with the record of what it could not read. */
export interface TimeoutCollector extends IRuntimeCollector {
  problems(): readonly TimeoutCollectorProblem[];
}

/** What the factory may return, since a missing key means it never runs. */
export type TimeoutCollectorRegistration = TimeoutCollector | SkippedCollector;

/**
 * Builds the timeout collector.
 *
 * @param options - The key the application writes its timeout under
 * @returns The collector, or a skip when no usable key was given
 */
export function timeoutCollector(options: TimeoutCollectorOptions): TimeoutCollectorRegistration {
  const key: unknown = options.metadataKey;

  if (!isUsableKey(key)) {
    return {
      name: TIMEOUT_COLLECTOR_NAME,
      skipped:
        'it was registered without a metadata key, so there is nothing for it to read. Pass ' +
        'timeoutCollector({ metadataKey: YOUR_KEY }) with the key your own decorator writes ' +
        'under; this package never guesses one',
    };
  }

  const problems: TimeoutCollectorProblem[] = [];

  return {
    name: TIMEOUT_COLLECTOR_NAME,

    collect(context: CollectorContext): IRNodeRuntime | undefined {
      const raw: unknown = context.reflector.getAllAndOverride(key, [
        context.handler,
        context.controller,
      ]);
      if (raw === undefined || raw === null) return undefined;

      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
        problems.push({
          subject: `${context.declaredOn.name}.${context.handlerName}`,
          reason: `the metadata under ${describe(key)} is not a duration, so no timeout is known`,
          action: 'write a positive number of milliseconds under that key',
          detail:
            'Nothing was reported for this route rather than a coerced value, because a coerced ' +
            'value would document a timeout this route does not enforce.',
        });

        return undefined;
      }

      // `derived` AND NEVER HIGHER, per the SPEC 6.1 table: metadata under a known key, read
      // from a decorator written for the interceptor's own enforcement rather than for
      // documentation.
      return { timeout: context.fact({ ms: raw }, 'derived') };
    },

    problems(): readonly TimeoutCollectorProblem[] {
      return problems;
    },
  };
}

/**
 * Reports whether a value can be used as a metadata key, the metadata collector rule.
 *
 * @param value - Whatever the host passed
 * @returns True when metadata can be read under it
 */
function isUsableKey(value: unknown): value is string | symbol {
  if (typeof value === 'symbol') return true;

  return typeof value === 'string' && value.length > 0;
}

/**
 * Renders a key for a message.
 *
 * @param key - The key
 * @returns Its printable form
 */
function describe(key: string | symbol): string {
  return typeof key === 'string' ? `"${key}"` : String(key);
}

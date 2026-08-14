/**
 * `headersCollector({ metadataKey })`, the collector of SPEC 6.2.1 for the required headers row.
 *
 * THE METADATA NAMES THE HEADERS AND THE REQUIREDNESS IS A CONCLUSION, which is why this is the
 * one metadata collector that emits `inferred` rather than `derived`. Metadata under a known key
 * ordinarily earns `derived`, and the list of names does; the claim the fact makes, that the
 * route refuses a request without these headers, is the guard's decision, and guard logic is
 * never read. One best effort step past the metadata is the definition of `inferred` in the
 * SPEC 6.1 table, and the design's own cell agrees: the prototype draws this row at INF.
 *
 * `getAllAndOverride`, THE SCOPES RULE: a route that restates its required headers restates
 * them, it does not add to the class's. Names are facts as written; every comparison against
 * the document folds case, because HTTP headers have none, and that folding belongs to the rule
 * and the row rather than to the fact.
 */

import type { IRNodeRuntime } from '@openref/core';
import type {
  CollectorContext,
  IRuntimeCollector,
  SkippedCollector,
} from '../../application/ports/collector.port';

/** The name this collector stamps on everything it reports, per SPEC 6.2. */
export const HEADERS_COLLECTOR_NAME = 'headersCollector';

/** What a host must tell the collector, because it cannot be worked out. */
export interface HeadersCollectorOptions {
  /** The key the application's own decorator writes header names under. Never guessed. */
  readonly metadataKey: string | symbol;
}

/** What the collector could not read, kept per node for `doctor`. */
export interface HeadersCollectorProblem {
  /** `OrdersController.list`, as a reader recognises it. */
  readonly subject: string;
  readonly reason: string;
}

/** The collector, with the record of what it could not read. */
export interface HeadersCollector extends IRuntimeCollector {
  problems(): readonly HeadersCollectorProblem[];
}

/** What the factory may return, since a missing key means it never runs. */
export type HeadersCollectorRegistration = HeadersCollector | SkippedCollector;

/**
 * Builds the required headers collector.
 *
 * @param options - The key the application writes its required header names under
 * @returns The collector, or a skip when no usable key was given
 */
export function headersCollector(options: HeadersCollectorOptions): HeadersCollectorRegistration {
  const key: unknown = options.metadataKey;

  if (!isUsableKey(key)) {
    return {
      name: HEADERS_COLLECTOR_NAME,
      skipped:
        'it was registered without a metadata key, so there is nothing for it to read. Pass ' +
        'headersCollector({ metadataKey: YOUR_KEY }) with the key your own decorator writes ' +
        'under; this package never guesses one',
    };
  }

  const problems: HeadersCollectorProblem[] = [];

  return {
    name: HEADERS_COLLECTOR_NAME,

    collect(context: CollectorContext): IRNodeRuntime | undefined {
      const raw: unknown = context.reflector.getAllAndOverride(key, [
        context.handler,
        context.controller,
      ]);
      if (raw === undefined || raw === null) return undefined;

      const names = asStringList(raw);
      if (names === undefined || names.length === 0) {
        problems.push({
          subject: `${context.declaredOn.name}.${context.handlerName}`,
          reason:
            `the metadata under ${describe(key)} is not a non-empty list of header names, so ` +
            'nothing was reported for this route rather than a coerced value',
        });

        return undefined;
      }

      // `inferred` AND NEVER HIGHER, per the file note: the names are metadata, the
      // requiredness is one best effort step past it.
      return { requiredHeaders: context.fact<readonly string[]>(names, 'inferred') };
    },

    problems(): readonly HeadersCollectorProblem[] {
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
 * Narrows a metadata value to a list of strings.
 *
 * @param value - Whatever was under the key
 * @returns The strings, or undefined when it is not a list of them
 */
function asStringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const items: unknown[] = value;

  return items.every((item) => typeof item === 'string') ? items : undefined;
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

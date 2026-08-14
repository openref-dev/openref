/**
 * `httpCodeCollector()`, the collector of SPEC 6.2.1 for the explicit success status.
 *
 * ONLY THE EXPLICIT `@HttpCode` IS A FACT. A route without the decorator answers the framework
 * default, 200 or 201 by method, and a default is behaviour rather than a decision written on
 * the route: reporting it would put a fact on every operation of every application and make
 * `status-drift` fire on documents that are perfectly honest about their defaults. The absence
 * of the fact is what keeps SP012 quiet on every ordinary route, per SPEC 7.1.
 *
 * THE KEY IS NESTJS'S OWN, so this collector takes no options: there is nothing about it for an
 * application to name. The decorator writes on the handler and nowhere else, so one target is
 * read. `derived`, per the SPEC 6.1 table: metadata under a known key, written for the
 * framework's routing rather than for documentation.
 */

import type { IRNodeRuntime } from '@openref/core';
import type { CollectorContext, IRuntimeCollector } from '../../application/ports/collector.port';
import { NEST_HTTP_CODE_METADATA } from '../../../shared/types/nest-surface';

/** The name this collector stamps on everything it reports, per SPEC 6.2. */
export const HTTP_CODE_COLLECTOR_NAME = 'httpCodeCollector';

/** What the collector could not read, kept per node for `doctor`. */
export interface HttpCodeCollectorProblem {
  /** `OrdersController.list`, as a reader recognises it. */
  readonly subject: string;
  readonly reason: string;
}

/** The collector, with the record of what it could not read. */
export interface HttpCodeCollector extends IRuntimeCollector {
  problems(): readonly HttpCodeCollectorProblem[];
}

/**
 * Builds the explicit status code collector.
 *
 * @returns The collector, ready to register in `runtime.collectors`
 */
export function httpCodeCollector(): HttpCodeCollector {
  const problems: HttpCodeCollectorProblem[] = [];

  return {
    name: HTTP_CODE_COLLECTOR_NAME,

    collect(context: CollectorContext): IRNodeRuntime | undefined {
      const raw: unknown = context.reflector.get(NEST_HTTP_CODE_METADATA, context.handler);
      if (raw === undefined || raw === null) return undefined;

      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 100 || raw > 599) {
        problems.push({
          subject: `${context.declaredOn.name}.${context.handlerName}`,
          reason:
            'the @HttpCode metadata is not an HTTP status code, so nothing was reported for ' +
            'this route rather than a coerced value',
        });

        return undefined;
      }

      return { statusCode: context.fact(raw, 'derived') };
    },

    problems(): readonly HttpCodeCollectorProblem[] {
      return problems;
    },
  };
}

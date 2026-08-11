/**
 * `guardsCollector()`, the collector of SPEC 6.2 that reports what protects a route.
 *
 * IT NAMES CLASSES AND PROMISES NOTHING ELSE. SPEC 6.1 lists reading a guard's logic first among
 * the three things this project will never do, and the reason it is first is that it is the one a
 * reader most wants. What a guard decides depends on the request, so it is not a property of the
 * route; what class stands in front of the route is. The reference shows the second and says so.
 *
 * A ROUTE WITH NO GUARDS OF ITS OWN GETS NO `guards` FIELD, rather than an empty list. The two
 * read differently and only one of them is true: an empty list says "this route was examined and
 * nothing protects it", which would be a claim about global guards this collector cannot make.
 * `app.useGlobalGuards` leaves nothing on any route, so a globally protected application looks
 * exactly like an unprotected one from here, and the honest answer is silence.
 *
 * THE FACTS ARE `derived`, per the SPEC 6.1 table, which names a guard's class name as the
 * example of that level. Nothing here can reach `declared`: that level belongs to a decorator
 * somebody wrote for this purpose, and `@UseGuards` was written to protect the route rather than
 * to document it.
 */

import type { IRGuard, IRNodeRuntime } from '@openref/core';
import type { CollectorContext, IRuntimeCollector } from '../../application/ports/collector.port';
import { readGuards } from '../../domain/guards';

/** The name this collector stamps on everything it reports, per SPEC 6.2. */
export const GUARDS_COLLECTOR_NAME = 'guardsCollector';

/** What the collector saw and could not report, kept per node for `doctor`. */
export interface GuardsCollectorProblem {
  /** `OrdersController.list`, as a reader recognises it. */
  readonly subject: string;
  readonly reason: string;
}

/** The collector, with the record of what it could not name. */
export interface GuardsCollector extends IRuntimeCollector {
  /** Every guard that was present and could not be named, in the order it was met. */
  problems(): readonly GuardsCollectorProblem[];
}

/**
 * Builds the guards collector.
 *
 * @returns The collector, ready to register in `runtime.collectors`
 */
export function guardsCollector(): GuardsCollector {
  const problems: GuardsCollectorProblem[] = [];

  return {
    name: GUARDS_COLLECTOR_NAME,

    collect(context: CollectorContext): IRNodeRuntime | undefined {
      const reading = readGuards(context.reflector, context.controller, context.handler);

      if (reading.anonymous > 0) {
        problems.push({
          subject: `${context.declaredOn.name}.${context.handlerName}`,
          reason:
            `${String(reading.anonymous)} guard(s) are applied and have no class name to report, ` +
            'so they are counted here and absent from the reference. An anonymous class or a ' +
            'plain object passed to @UseGuards produces this',
        });
      }

      if (reading.names.length === 0) return undefined;

      const guards: readonly IRGuard[] = reading.names.map((name) => ({
        name,
        confidence: 'derived',
        collector: GUARDS_COLLECTOR_NAME,
      }));

      return { guards };
    },

    problems(): readonly GuardsCollectorProblem[] {
      return problems;
    },
  };
}

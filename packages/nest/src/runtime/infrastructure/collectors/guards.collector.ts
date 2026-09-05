/**
 * `guardsCollector()`, the collector of SPEC 6.2 that reports what protects a route.
 *
 * IT NAMES CLASSES AND PROMISES NOTHING ELSE. SPEC 6.1 lists reading a guard's logic first among
 * the three things this project will never do, and the reason it is first is that it is the one a
 * reader most wants. What a guard decides depends on the request, so it is not a property of the
 * route; what class stands in front of the route is. The reference shows the second and says so.
 *
 * A ROUTE WITH NO GUARDS AT EITHER SCOPE GETS NO `guards` FIELD, rather than an empty list. The
 * two read differently and only one of them is true: an empty list says "this route was examined
 * and nothing protects it", and the collector can only say that about what it is able to read.
 *
 * A GLOBAL GUARD IS REPORTED ON EVERY ROUTE, AT `scope: 'global'`, per SPEC 6.2.1 and
 * TX-GLOBALGUARD. Until 2026-08-12 this file said the opposite, that a globally protected
 * application "looks exactly like an unprotected one from here, and the honest answer is
 * silence". It was measured to be the wrong answer on the first outside application this package
 * ever met: every route behind one `APP_GUARD` provider, zero guards reported on all 73, and
 * `security-drift` printing a clean line on an application that documents no security at all.
 * Silence about a fact the container will hand over on request is not honesty, it is a missing
 * reading. What stays is the scope beside the name, because "protected by a decision about this
 * route" and "protected by a decision about the application" are different answers to the
 * question a reader is asking.
 *
 * THE FACTS ARE `derived`, per the SPEC 6.1 table, which names a guard's class name as the
 * example of that level. Nothing here can reach `declared`: that level belongs to a decorator
 * somebody wrote for this purpose, and `@UseGuards` was written to protect the route rather than
 * to document it.
 */

import type { IRGuard, IRGuardScope, IRNodeRuntime } from '@openref/core';
import type { CollectorContext, IRuntimeCollector } from '../../application/ports/collector.port';
import { readGuards } from '../../domain/guards';

/** The name this collector stamps on everything it reports, per SPEC 6.2. */
export const GUARDS_COLLECTOR_NAME = 'guardsCollector';

/** What the collector saw and could not report, kept per node for `doctor`. */
export interface GuardsCollectorProblem {
  /** `OrdersController.list`, as a reader recognises it. */
  readonly subject: string;
  /** The cause and what is not known because of it, in one clause, per SPEC 7.1. */
  readonly reason: string;
  /** The action, or that there is none and why the finding is recorded anyway, per SPEC 7.1. */
  readonly action: string;
  /** The reasoning behind it, for a reader who opens it. Absent where the cause is its own. */
  readonly detail?: string;
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
          reason: `${String(reading.anonymous)} guard(s) here have no class name, so none is shown`,
          action: 'pass a named class to @UseGuards if these guards should appear by name',
          detail:
            'An anonymous class or a plain object passed to @UseGuards has nothing to print. ' +
            'They are counted here so the route is not read as carrying fewer guards than it does.',
        });
      }

      // THE ROUTE'S OWN GUARDS COME FIRST, and the order is what a reader scans rather than what
      // NestJS runs: a global guard runs before either of them. What is being answered here is
      // "what was decided about this endpoint", and the nearer decision is the one that names it.
      const guards: readonly IRGuard[] = [
        ...named(reading.names, 'route'),
        ...named(context.globalGuards, 'global'),
      ];

      return guards.length === 0 ? undefined : { guards };
    },

    problems(): readonly GuardsCollectorProblem[] {
      return problems;
    },
  };
}

/**
 * Turns class names at one scope into facts.
 *
 * @param names - Class names, already deduplicated within their scope
 * @param scope - Where they were registered
 * @returns One `derived` fact per name
 */
function named(names: readonly string[], scope: IRGuardScope): readonly IRGuard[] {
  return names.map((name) => ({
    name,
    scope,
    confidence: 'derived',
    collector: GUARDS_COLLECTOR_NAME,
  }));
}

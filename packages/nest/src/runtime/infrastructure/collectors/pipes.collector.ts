/**
 * `pipesCollector()`, the collector of SPEC 6.2.1 that reports what stands on a route's input.
 *
 * IT NAMES CLASSES AND PROMISES NOTHING ELSE, the guards rule applied to the other enhancer.
 * What a pipe decides depends on the value, so it is not a property of the route; which classes
 * stand in front of the input is. No 400 is derived from any of this: SPEC 6.4's two derivation
 * rules do not grow, and a pipe's presence is a fact about the route, not a contract.
 *
 * THE SCOPE IS PART OF THE FACT, per SPEC 6.2.1 and the APP_GUARD precedent: the same class
 * registered under `APP_PIPE`, named in `@UsePipes`, or passed inside a parameter decorator is
 * three different decisions, and a reader deciding whether input is validated needs to know
 * which one they are looking at. Route pipes come first, then parameter pipes, then the
 * application's, nearest decision first, the order `guardsCollector` already draws.
 *
 * THE FACTS ARE `derived`: a registration is read, never a decorator written to document.
 */

import type { IRNodeRuntime, IRPipe, IRPipeScope } from '@openref/core';
import type { CollectorContext, IRuntimeCollector } from '../../application/ports/collector.port';
import { metadataReflect } from '../../../shared/types/nest-surface';
import { readParameterPipes, readRoutePipes } from '../../domain/pipes';

/** The name this collector stamps on everything it reports, per SPEC 6.2. */
export const PIPES_COLLECTOR_NAME = 'pipesCollector';

/** What the collector saw and could not report, kept per node for `doctor`. */
export interface PipesCollectorProblem {
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
export interface PipesCollector extends IRuntimeCollector {
  /** Every pipe that was present and could not be named, in the order it was met. */
  problems(): readonly PipesCollectorProblem[];
}

/**
 * Builds the pipes collector.
 *
 * @returns The collector, ready to register in `runtime.collectors`
 */
export function pipesCollector(): PipesCollector {
  const problems: PipesCollectorProblem[] = [];

  return {
    name: PIPES_COLLECTOR_NAME,

    collect(context: CollectorContext): IRNodeRuntime | undefined {
      const subject = `${context.declaredOn.name}.${context.handlerName}`;
      const route = readRoutePipes(context.reflector, context.controller, context.handler);
      const parameter = readParameterPipes(
        metadataReflect(),
        context.controller,
        context.handlerName,
      );

      const anonymous = route.anonymous + parameter.anonymous;
      if (anonymous > 0) {
        problems.push({
          subject,
          reason: `${String(anonymous)} pipe(s) here have no class name, so none is shown`,
          action: 'pass a named class to @UsePipes if these pipes should appear by name',
          detail:
            'An anonymous class or a plain object passed to @UsePipes or to a parameter ' +
            'decorator has nothing to print. They are counted here so the route is not read as ' +
            'carrying fewer pipes than it does.',
        });
      }

      const pipes: readonly IRPipe[] = [
        ...named(route.names, 'route'),
        ...named(parameter.names, 'parameter'),
        ...named(context.globalPipes, 'global'),
      ];

      return pipes.length === 0 ? undefined : { pipes };
    },

    problems(): readonly PipesCollectorProblem[] {
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
function named(names: readonly string[], scope: IRPipeScope): readonly IRPipe[] {
  return names.map((name) => ({
    name,
    scope,
    confidence: 'derived',
    collector: PIPES_COLLECTOR_NAME,
  }));
}

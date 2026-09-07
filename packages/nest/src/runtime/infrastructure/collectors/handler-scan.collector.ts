/**
 * `handlerScanCollector()`, the scan of SPEC 6.2.1: which declared parameters was the handler
 * seen to read.
 *
 * `inferred` AND ONLY `inferred`, per the task that built it. The bindings alone would earn
 * `derived`, but the fact is one conclusion drawn from bindings plus a scan of the emitted
 * source, and a fact takes the confidence of its weakest step. The verdict vocabulary carries
 * the discipline: a parameter the scan did not see read is `not-seen-read` only when every
 * access path of its location was accounted for, `unaccounted` when it was not, and a handler
 * the scan cannot account for at all produces no fact and a `doctor` reason, because a blind
 * instrument says nothing, per SPEC 6.1.
 *
 * OPERATIONS ONLY, AND ONLY ONES THAT DECLARE PARAMETERS. A channel has no handler bindings,
 * and an operation with no declared parameters has nothing for a verdict to be about: the spec
 * side of the row already says "no parameters declared" by itself.
 */

import type { IRNodeRuntime } from '@openref/core';
import type { CollectorContext, IRuntimeCollector } from '../../application/ports/collector.port';
import { metadataReflect } from '../../../shared/types/nest-surface';
import { scanHandlerReads } from '../../domain/handler-scan';

/** The name this collector stamps on everything it reports, per SPEC 6.2. */
export const HANDLER_SCAN_COLLECTOR_NAME = 'handlerScanCollector';

/** A handler the scan could not account for, kept per node for `doctor`. */
export interface HandlerScanProblem {
  /** `OrdersController.list`, as a reader recognises it. */
  readonly subject: string;
  /** The cause and what is not known because of it, in one clause, per SPEC 7.1. */
  readonly reason: string;
  /** That there is nothing to do and why the finding is recorded anyway, per SPEC 7.1. */
  readonly action: string;
  /** Why this handler cannot be accounted for, for a reader who opens it. */
  readonly detail: string;
}

/** The collector, with the record of every handler it refused. */
export interface HandlerScanCollector extends IRuntimeCollector {
  problems(): readonly HandlerScanProblem[];
}

/**
 * Builds the handler scan collector.
 *
 * @returns The collector, ready to register in `runtime.collectors`
 */
export function handlerScanCollector(): HandlerScanCollector {
  const problems: HandlerScanProblem[] = [];

  return {
    name: HANDLER_SCAN_COLLECTOR_NAME,

    collect(context: CollectorContext): IRNodeRuntime | undefined {
      if (context.node.kind !== 'operation') return undefined;

      const declared = context.node.parameters.map((parameter) => ({
        in: parameter.in,
        name: parameter.name,
      }));
      if (declared.length === 0) return undefined;

      const result = scanHandlerReads(
        metadataReflect(),
        context.controller,
        context.handlerName,
        context.handler,
        declared,
      );

      if (result.kind === 'blind') {
        // THE CAUSE, THE ACTION AND THE REASONING ARE THREE MEMBERS, per SPEC 7.1. They were one
        // sentence, and on the maintainer's application that sentence ran to fifty words and was
        // then printed twice in every finding, once with the subject glued to the front of it.
        // `scanHandlerReads` writes the short half and the long one beside each other so the two
        // cannot come to describe different refusals.
        problems.push({
          subject: `${context.declaredOn.name}.${context.handlerName}`,
          reason: result.reason,
          action:
            'nothing to do here: this route reports no unread parameters, and the finding is ' +
            'what says the row is unmeasured rather than clean',
          detail:
            `${result.detail} No parameter read fact was reported for this route, because a ` +
            'scan that cannot account for the handler says nothing rather than guessing.',
        });

        return undefined;
      }

      return {
        parameterReads: context.fact({ parameters: result.parameters }, 'inferred'),
      };
    },

    problems(): readonly HandlerScanProblem[] {
      return problems;
    },
  };
}

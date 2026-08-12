/**
 * The collector that reads this package's own decorators, which is the `declared` level of SPEC 6.1.
 *
 * IT IS THE ONLY COLLECTOR THAT MAY SAY `declared`, and that is what separates it from
 * `scopesCollector`. That one reads a key the application's own authorization decorator writes, at
 * `derived`, because a key readable by accident says what the code does rather than what the
 * endpoint promises. `@ApiScopes` exists for no other purpose than to document the route, so what
 * it says is a declaration and outranks anything observed, whatever order the two are registered
 * in. SPEC 6.2's precedence rule does the outranking; this file only has to be honest about which
 * level it is reporting.
 *
 * `@ApiErrors` IS READ AND NOT YET TURNED INTO A CONTRACT, which is the T020 to T021 boundary and
 * is stated here so the absence does not read as an oversight. The decorator stores the error
 * classes; `IRErrorContract`, the RFC 9457 shape and the three groups that must never be merged are
 * T021's, and inventing a contract here from a class name would be exactly the guess this project
 * refuses. The problem list records nothing for it: a declaration that is stored and not yet mapped
 * is scheduled work, not a defect a reader should be told about.
 *
 * `@ApiStream` IS NOT READ HERE EITHER. It is level one of the four in SPEC 13.6, and reading one
 * level in one collector and three in another would put the priority in two places.
 */

import type { IRNodeRuntime } from '@openref/core';
import { OPENREF_METADATA } from '../../../api/decorators/metadata';
import type { CollectorContext, IRuntimeCollector } from '../../application/ports/collector.port';

/** The name this collector stamps on everything it reports. */
export const DECLARATIONS_COLLECTOR_NAME = 'declarationsCollector';

/** What a declaration said that could not be used, kept per node for `doctor`. */
export interface DeclarationsCollectorProblem {
  /** `OrdersController.list`, as a reader recognises it. */
  readonly subject: string;
  readonly reason: string;
}

/** The collector, with the record of what it could not read. */
export interface DeclarationsCollector extends IRuntimeCollector {
  /** Declarations that were present and unusable, in the order they were met. */
  problems(): readonly DeclarationsCollectorProblem[];
}

/**
 * Builds the collector that reads `@ApiScopes`.
 *
 * NO OPTIONS, WHICH IS THE POINT OF IT. A metadata collector needs to be told the key because the
 * key belongs to the application. This one reads keys this package defines, so there is nothing to
 * configure and nothing to get wrong.
 *
 * @returns The collector
 */
export function declarationsCollector(): DeclarationsCollector {
  const problems: DeclarationsCollectorProblem[] = [];

  return {
    name: DECLARATIONS_COLLECTOR_NAME,

    collect(context: CollectorContext): IRNodeRuntime | undefined {
      // `getAllAndOverride`, SO A METHOD REPLACES A CLASS RATHER THAN ADDING TO IT. A controller
      // marked `orders:read` with one route marked `orders:write` has a route that requires
      // `orders:write`, which is what writing the second decorator means.
      const raw: unknown = context.reflector.getAllAndOverride(OPENREF_METADATA.scopes, [
        context.handler,
        context.controller,
      ]);

      if (raw === undefined || raw === null) return undefined;

      const scopes = asStringList(raw);
      if (scopes === undefined) {
        problems.push({
          subject: `${context.declaredOn.name}.${context.handlerName}`,
          reason:
            '@ApiScopes was applied with something other than strings, so no scope fact was ' +
            'reported for this route. Pass scope names: @ApiScopes("orders:read")',
        });

        return undefined;
      }

      return { scopes: context.fact(scopes, 'declared') };
    },

    problems(): readonly DeclarationsCollectorProblem[] {
      return problems;
    },
  };
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

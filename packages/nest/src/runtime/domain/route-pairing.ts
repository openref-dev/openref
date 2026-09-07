/**
 * Pairing a discovered route with the IR node that documents it.
 *
 * THIS IS WHERE THE WHOLE PRODUCT CLAIM IS EITHER TRUE OR A GUESS. Every runtime fact of SPEC 6
 * is attached to a node through this function, so a wrong pair does not produce a missing fact,
 * it produces a fact attributed to the wrong endpoint, which is worse than none: a reader has no
 * way to tell one from the other. The rules below are therefore ordered from certain to
 * inferred, each one is exact rather than fuzzy, and anything that matches two nodes is refused
 * rather than resolved by picking one. Every refusal is written into one of the three lists this
 * returns, and `runtime-pass.service.ts` carries all three onto the document as discovery
 * problems, so a reader is told which of the three happened rather than being left to infer it
 * from a fact that is missing.
 *
 * THREE RULES, IN THIS ORDER.
 *
 * 1. The operation id, probed with the name the handler was given and then with the name
 *    `@nestjs/swagger` derives. `@ApiOperation({ operationId })` is the name a person wrote and
 *    the one the document carries; with no decorator the generator writes
 *    `OrdersController_findAll`, which names the class and the method outright. Either way this is
 *    not an inference. A host with its own `operationIdFactory` matches neither and falls through.
 * 2. Method and path, equal, under the application's global prefix. The route path is probed as
 *    the controller declares it, which is a document generated with `ignoreGlobalPrefix` or an
 *    application with no prefix, and then with the prefix `setGlobalPrefix` set in front of it,
 *    which is what `@nestjs/swagger` writes by default. Both probes are exact and both are
 *    anchored at the start of the string.
 * 3. Method, and the document's path ending in the route's path at a segment boundary. This is
 *    the last resort and it is the only rule here with no anchor. It is what still answers when
 *    the prefix could not be read, and when the document was written under a base path that is
 *    not the application's prefix. It is applied only when it selects exactly one node.
 *
 * WHY RULE TWO GAINED THE PREFIX, MEASURED RATHER THAN ARGUED. It had never paired anything in an
 * application that calls `setGlobalPrefix`, because `/dashboards` is not `/api/v1/dashboards`, and
 * that was masked by rule one rather than by rule three: simulated against the maintainer's served
 * document on 2026-09-06, rule two paired 0 of 58 while rule one paired all 58. With the prefix
 * read it pairs 58 of 58.
 *
 * WHY RULE THREE IS NOW LAST IN FACT AND NOT ONLY IN ORDER. A suffix has no anchor, so on that
 * same document `/dashboards` ends both `/api/v1/dashboards` and `/api/v1/admin/dashboards`: the
 * rule matched two operations, refused both, and the operation it should have paired was then
 * reported as having no handler at all.
 *
 * WHAT IS NOT DONE, and each was considered. No matching on the handler name alone, because two
 * controllers sharing `findAll` is the norm rather than the exception. No falling back to a
 * longest common prefix, because a document written with `ignoreGlobalPrefix` and one written
 * without are two different strings and only one of them is a prefix relationship. No falling back
 * to position, ever.
 */

import type { IRNode, IROperation } from '@openref/core';
import type { CollectorTarget } from '../application/services/collector-registry.service';
import type {
  DiscoveredRoute,
  DiscoveryProblem,
} from '../infrastructure/adapters/controller-discovery.adapter';

/**
 * One route that could not be attributed to exactly one node, and why.
 *
 * IT IS A `DiscoveryProblem` WITH ONE MEMBER MORE, so that `runtime-pass.service.ts` can put it on
 * the document without translating it. Until `TX-PAIRING` these three lists were returned, held on
 * a result nothing downstream read, and reached no reader at all: a route that matched two nodes
 * was silently attributed to neither, and the node it should have had was drawn as an
 * `orphan-operation` saying no handler was found for it.
 */
export interface PairingProblem extends DiscoveryProblem {
  /** The route, as `GET /orders/{id}`, or the node id when the node is the unmatched side. */
  readonly subject: string;
  /** Which class and method declared it, when a route is the subject. */
  readonly declaredBy?: string;
}

/** What one pairing pass produced. */
export interface PairingResult {
  /** Node, controller and handler, ready for the registry T017 froze. */
  readonly targets: readonly CollectorTarget[];
  /** Routes the application serves that the document does not describe. */
  readonly routesWithoutNode: readonly PairingProblem[];
  /** Operations the document describes that no route was found for. */
  readonly nodesWithoutRoute: readonly PairingProblem[];
  /** Routes that matched more than one node, which are attributed to none. */
  readonly ambiguous: readonly PairingProblem[];
}

/** What the pass knows about the application that the two lists cannot say themselves. */
export interface PairingOptions {
  /**
   * The prefix `setGlobalPrefix` put on every route, with a leading slash and no trailing one.
   *
   * ABSENT MEANS IT COULD NOT BE READ, and the empty string means it was read and there is none.
   * `runtime/domain/global-prefix.ts` is what reads it, and `runtime-pass.service.ts` reports the
   * first of those two to a reader rather than letting rule two quietly go back to pairing nothing.
   */
  readonly globalPrefix?: string;
}

/**
 * Pairs the application's routes with the document's operations.
 *
 * @param nodes - The IR nodes, as the normalizer produced them
 * @param routes - What the discovery pass found
 * @param options - What the pass read off the application, per {@link PairingOptions}
 * @returns The targets, and every unpaired thing on both sides
 */
export function pairRoutes(
  nodes: Iterable<IRNode>,
  routes: readonly DiscoveredRoute[],
  options: PairingOptions = {},
): PairingResult {
  const operations = [...nodes].filter(isOperation);
  const unclaimed = new Map(operations.map((operation) => [operation.id, operation]));

  const targets: CollectorTarget[] = [];
  const routesWithoutNode: PairingProblem[] = [];
  const ambiguous: PairingProblem[] = [];
  // Which node lost which route to an ambiguity, so that the node side can name the cause instead
  // of reporting the absence that the cause produced.
  const contested = new Map<string, PairingProblem>();

  const byOperationId = new Map<string, IROperation[]>();
  const byMethodAndPath = new Map<string, IROperation[]>();
  for (const operation of operations) {
    if (operation.rawOperationId !== undefined) {
      append(byOperationId, operation.rawOperationId, operation);
    }
    append(byMethodAndPath, methodAndPath(operation.method, operation.path), operation);
  }

  for (const route of routes) {
    const found = matchOne(route, byOperationId, byMethodAndPath, operations, options.globalPrefix);

    const operation = found.matches.length === 1 ? found.matches[0] : undefined;

    if (operation !== undefined) {
      // A second route reaching the same node cannot happen through rules 1 and 2, which are
      // keyed lookups, but rule 3 can pair two controllers under different prefixes with one
      // document path. The node is claimed once, and the loser is reported rather than dropped.
      if (unclaimed.delete(operation.id)) {
        targets.push({
          node: operation,
          controller: route.controller,
          declaredOn: route.declaredOn,
          handler: route.handler,
          handlerName: route.handlerName,
        });
      } else {
        ambiguous.push({
          subject: describe(route),
          declaredBy: `${route.controllerName}.${route.handlerName}`,
          reason: `the operation ${operation.id} was already paired with another route`,
          action:
            'give this handler an @ApiOperation operationId matching the operation it serves, ' +
            'so it is paired by name instead of by the shape of its path',
          detail:
            'Two handlers under different controller prefixes end in the same path, and only ' +
            'one document operation describes it. Attributing the operation to both would put ' +
            "one route's guards, rate limit and status codes on the other route's page.",
        });
      }
      continue;
    }

    if (found.matches.length > 1) {
      const problem: PairingProblem = {
        subject: describe(route),
        declaredBy: `${route.controllerName}.${route.handlerName}`,
        reason: `it matches ${String(found.matches.length)} operations, ${found.matches
          .map((operation) => operation.id)
          .join(', ')}, so no fact is attributed to any of them`,
        action:
          'give this handler an @ApiOperation operationId matching the operation it serves, or ' +
          'set the global prefix before the reference is mounted so the paths compare exactly',
        detail:
          'It was reached by the last rule, which asks only whether a document path ends in ' +
          'the route path, so two operations under different prefixes both answered. No ' +
          'runtime fact is attached to either, because attaching it to the wrong one is worse.',
      };
      ambiguous.push(problem);
      for (const candidate of found.matches) contested.set(candidate.id, problem);
      continue;
    }

    routesWithoutNode.push({
      subject: describe(route),
      declaredBy: `${route.controllerName}.${route.handlerName}`,
      reason: 'the document describes no operation with this method and path',
      action:
        'nothing, when the route is deliberately absent from the document; otherwise document ' +
        'it, since no runtime fact of this handler can be shown anywhere',
      detail:
        'The route is served by the application and the document has no operation for it, so ' +
        'there is no page for its guards, its rate limit or its status codes to appear on.',
    });
  }

  const nodesWithoutRoute = [...unclaimed.values()].map((operation) =>
    nodeWithoutRoute(operation, contested.get(operation.id)),
  );

  return { targets, routesWithoutNode, nodesWithoutRoute, ambiguous };
}

/**
 * Says why one operation ended the pass with no handler, which is two different things.
 *
 * THE TWO WERE ONE SENTENCE AND THE SENTENCE WAS WRONG HALF THE TIME. "No handler was found" is
 * true of an operation nothing serves and false of one whose handler was found, matched twice and
 * discarded, and a reader had no way to tell those apart.
 *
 * @param operation - The unclaimed operation
 * @param contested - The ambiguity that consumed its route, when there was one
 * @returns The problem, worded to whichever of the two happened
 */
function nodeWithoutRoute(
  operation: IROperation,
  contested: PairingProblem | undefined,
): PairingProblem {
  if (contested === undefined) {
    return {
      subject: operation.id,
      reason: `no handler was found for ${methodAndPath(operation.method, operation.path)}`,
      action:
        'nothing, when the operation is documented ahead of the code; otherwise check that the ' +
        'controller serving it is registered in a module this application loads',
      detail:
        'No route of the application was attributed to it, so it carries no runtime fact and ' +
        'the drift rules count it as an operation nothing serves.',
    };
  }

  return {
    subject: operation.id,
    reason: `${contested.subject} matched it and other operations, so it was attributed to none`,
    action:
      'give the handler an @ApiOperation operationId matching this operation, so it is paired ' +
      'by name instead of by the shape of its path',
    detail:
      `The route was declared by ${String(contested.declaredBy)} and reached the last pairing ` +
      'rule, which matched more than one operation. This operation was one of the candidates, ' +
      'so its handler was found and then discarded rather than never found at all.',
  };
}

/**
 * Applies the three rules to one route, stopping at the first that matches anything.
 *
 * @param route - The route being attributed
 * @param byOperationId - Operations indexed by their raw operation id
 * @param byMethodAndPath - Operations indexed by method and path
 * @param operations - All operations, for the suffix rule, which cannot be a keyed lookup
 * @param globalPrefix - The application's prefix, when it could be read
 * @returns The operations this route matched, which may be none or several
 */
function matchOne(
  route: DiscoveredRoute,
  byOperationId: ReadonlyMap<string, IROperation[]>,
  byMethodAndPath: ReadonlyMap<string, IROperation[]>,
  operations: readonly IROperation[],
  globalPrefix: string | undefined,
): { readonly matches: readonly IROperation[] } {
  // THE PROBE IS WHAT CHANGED AND NOT THE INDEX. The index has always been keyed by whatever the
  // document wrote; it was the probe that was always the derived string, so a host that named its
  // own operations matched nothing here. The written name goes first because it is the one the
  // document carries when both exist.
  for (const id of [route.operationId, `${route.controllerName}_${route.handlerName}`]) {
    if (id === undefined) continue;

    const byId = byOperationId.get(id);
    if (byId !== undefined) return { matches: byId };
  }

  // THE UNPREFIXED PROBE GOES FIRST AND THAT ORDER IS LOAD BEARING. A document generated with
  // `ignoreGlobalPrefix` writes the controller's own path, and a host that mounts a controller
  // under both spellings has to get the one the controller declares.
  for (const path of [route.path, prefixed(globalPrefix, route.path)]) {
    if (path === undefined) continue;

    const byPath = byMethodAndPath.get(methodAndPath(route.method, path));
    if (byPath !== undefined) return { matches: byPath };
  }

  return {
    matches: operations.filter(
      (operation) =>
        operation.method.toLowerCase() === route.method &&
        endsAtSegment(operation.path, route.path),
    ),
  };
}

/**
 * The path a document writes for a route once the global prefix is in front of it.
 *
 * @param globalPrefix - The prefix, or undefined when it could not be read
 * @param path - The path as the controller declares it
 * @returns The prefixed path, or undefined when there is no second key to probe
 */
function prefixed(globalPrefix: string | undefined, path: string): string | undefined {
  if (globalPrefix === undefined || globalPrefix === '') return undefined;

  return path === '/' ? globalPrefix : `${globalPrefix}${path}`;
}

/**
 * Reports whether a document path ends in a route path at a segment boundary.
 *
 * THE LEADING SLASH OF THE ROUTE PATH IS THE BOUNDARY CHECK, which is why there is no second
 * one. `joinPath` gives every route path a leading slash, so `/reorders` does not end with
 * `/orders` and the endpoint that merely reads alike is refused by the comparison itself. A
 * separate check on the preceding character would be the same test written twice, and written
 * wrongly the second time, since the character before the suffix is the last of the prefix.
 *
 * The route path being shorter is required as well: an equal pair was already answered by rule
 * two, and treating it here would report every ordinary match as a prefixed one.
 *
 * IT IS UNANCHORED AND THAT IS WHY IT IS LAST. `/dashboards` ends `/api/v1/dashboards` and
 * `/api/v1/admin/dashboards` alike, and this rule cannot tell which of the two leading strings is
 * the application's prefix. Rule two can, when the prefix was read, and this is what answers when
 * it was not.
 *
 * @param documentPath - Path as the document writes it
 * @param routePath - Path as the controller declares it
 * @returns True when the difference is a whole number of leading segments
 */
function endsAtSegment(documentPath: string, routePath: string): boolean {
  if (routePath === '/') return false;

  return documentPath.length > routePath.length && documentPath.endsWith(routePath);
}

/**
 * Reports whether a node is an HTTP operation.
 *
 * @param node - Any IR node
 * @returns True for an operation, false for a channel
 */
function isOperation(node: IRNode): node is IROperation {
  return node.kind === 'operation';
}

/**
 * The pairing key for a method and a path.
 *
 * @param method - HTTP method, in any case
 * @param path - Path, in the document's dialect
 * @returns `GET /orders/{id}`, which is also what a problem prints
 */
function methodAndPath(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/**
 * Names a route the way a reader of `doctor` recognises it.
 *
 * @param route - The route
 * @returns `GET /orders/{id}`
 */
function describe(route: DiscoveredRoute): string {
  return methodAndPath(route.method, route.path);
}

/**
 * Adds a value to a list held under a key.
 *
 * @param index - The index being built
 * @param key - Where to put it
 * @param operation - What to add
 */
function append(index: Map<string, IROperation[]>, key: string, operation: IROperation): void {
  const existing = index.get(key);
  if (existing === undefined) index.set(key, [operation]);
  else existing.push(operation);
}

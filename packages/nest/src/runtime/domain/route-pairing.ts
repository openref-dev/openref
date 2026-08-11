/**
 * Pairing a discovered route with the IR node that documents it.
 *
 * THIS IS WHERE THE WHOLE PRODUCT CLAIM IS EITHER TRUE OR A GUESS. Every runtime fact of SPEC 6
 * is attached to a node through this function, so a wrong pair does not produce a missing fact,
 * it produces a fact attributed to the wrong endpoint, which is worse than none: a reader has no
 * way to tell one from the other. The rules below are therefore ordered from certain to
 * inferred, each one is exact rather than fuzzy, and anything that matches two nodes is reported
 * as ambiguous rather than resolved by picking one.
 *
 * THREE RULES, IN THIS ORDER.
 *
 * 1. The raw operation id. `@nestjs/swagger` writes `OrdersController_findAll` by default, which
 *    names the class and the method outright, so when it is present it is not an inference at
 *    all. A host with its own `operationIdFactory` simply does not match here and falls through.
 * 2. Method and path, equal. The ordinary case for a host with no global prefix.
 * 3. Method, and the document's path ending in the route's path at a segment boundary. This is
 *    the global prefix, and only that: `setGlobalPrefix('api')` puts `/api/orders/{id}` in the
 *    document while the controller still declares `/orders/{id}`. It is applied last and only
 *    when it selects exactly one node.
 *
 * WHAT IS NOT DONE, and each was considered. No matching on the handler name alone, because two
 * controllers sharing `findAll` is the norm rather than the exception. No matching on a common
 * prefix, because a document written with `ignoreGlobalPrefix` and one written without are two
 * different strings and only one of them is a suffix relationship. No falling back to position,
 * ever.
 */

import type { IRNode, IROperation } from '@openref/core';
import type { CollectorTarget } from '../application/services/collector-registry.service';
import type { DiscoveredRoute } from '../infrastructure/adapters/controller-discovery.adapter';

/** One route that could not be attributed to exactly one node, and why. */
export interface PairingProblem {
  /** The route, as `GET /orders/{id}`, or the node id when the node is the unmatched side. */
  readonly subject: string;
  /** Which class and method declared it, when a route is the subject. */
  readonly declaredBy?: string;
  readonly reason: string;
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

/**
 * Pairs the application's routes with the document's operations.
 *
 * @param nodes - The IR nodes, as the normalizer produced them
 * @param routes - What the discovery pass found
 * @returns The targets, and every unpaired thing on both sides
 */
export function pairRoutes(
  nodes: Iterable<IRNode>,
  routes: readonly DiscoveredRoute[],
): PairingResult {
  const operations = [...nodes].filter(isOperation);
  const unclaimed = new Map(operations.map((operation) => [operation.id, operation]));

  const targets: CollectorTarget[] = [];
  const routesWithoutNode: PairingProblem[] = [];
  const ambiguous: PairingProblem[] = [];

  const byOperationId = new Map<string, IROperation[]>();
  const byMethodAndPath = new Map<string, IROperation[]>();
  for (const operation of operations) {
    if (operation.rawOperationId !== undefined) {
      append(byOperationId, operation.rawOperationId, operation);
    }
    append(byMethodAndPath, methodAndPath(operation.method, operation.path), operation);
  }

  for (const route of routes) {
    const found = matchOne(route, byOperationId, byMethodAndPath, operations);

    const operation = found.matches.length === 1 ? found.matches[0] : undefined;

    if (operation !== undefined) {
      // A second route reaching the same node cannot happen through rules 1 and 2, which are
      // keyed lookups, but rule 3 can pair two controllers under different prefixes with one
      // document path. The node is claimed once, and the loser is reported rather than dropped.
      if (unclaimed.delete(operation.id)) {
        targets.push({ node: operation, controller: route.controller, handler: route.handler });
      } else {
        ambiguous.push({
          subject: describe(route),
          declaredBy: `${route.controllerName}.${route.handlerName}`,
          reason: `the operation ${operation.id} was already paired with another route`,
        });
      }
      continue;
    }

    if (found.matches.length > 1) {
      ambiguous.push({
        subject: describe(route),
        declaredBy: `${route.controllerName}.${route.handlerName}`,
        reason: `it matches ${String(found.matches.length)} operations, ${found.matches
          .map((operation) => operation.id)
          .join(', ')}, so no fact is attributed to any of them`,
      });
      continue;
    }

    routesWithoutNode.push({
      subject: describe(route),
      declaredBy: `${route.controllerName}.${route.handlerName}`,
      reason: 'the document describes no operation with this method and path',
    });
  }

  const nodesWithoutRoute = [...unclaimed.values()].map((operation) => ({
    subject: operation.id,
    reason: `no handler was found for ${methodAndPath(operation.method, operation.path)}`,
  }));

  return { targets, routesWithoutNode, nodesWithoutRoute, ambiguous };
}

/**
 * Applies the three rules to one route, stopping at the first that matches anything.
 *
 * @param route - The route being attributed
 * @param byOperationId - Operations indexed by their raw operation id
 * @param byMethodAndPath - Operations indexed by method and path
 * @param operations - All operations, for the suffix rule, which cannot be a keyed lookup
 * @returns The operations this route matched, which may be none or several
 */
function matchOne(
  route: DiscoveredRoute,
  byOperationId: ReadonlyMap<string, IROperation[]>,
  byMethodAndPath: ReadonlyMap<string, IROperation[]>,
  operations: readonly IROperation[],
): { readonly matches: readonly IROperation[] } {
  const byId = byOperationId.get(`${route.controllerName}_${route.handlerName}`);
  if (byId !== undefined) return { matches: byId };

  const byPath = byMethodAndPath.get(methodAndPath(route.method, route.path));
  if (byPath !== undefined) return { matches: byPath };

  return {
    matches: operations.filter(
      (operation) =>
        operation.method.toLowerCase() === route.method &&
        endsAtSegment(operation.path, route.path),
    ),
  };
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

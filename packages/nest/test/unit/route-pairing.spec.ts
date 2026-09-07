import { describe, expect, it } from 'vitest';
import type { IROperation } from '@openref/core';
import { pairRoutes } from '../../src/runtime/domain/route-pairing';
import type { DiscoveredRoute } from '../../src/runtime/infrastructure/adapters/controller-discovery.adapter';

/**
 * Pairing, which is where a runtime fact either lands on the right endpoint or lies about one.
 *
 * A WRONG PAIR IS WORSE THAN NO PAIR, so every case below asks not only whether the right node
 * was found but whether a near miss was refused. The three rules are ordered from certain to
 * inferred and the last one is applied only when it selects exactly one node.
 */

function operation(partial: Partial<IROperation> & { id: string }): IROperation {
  return {
    kind: 'operation',
    method: 'get',
    path: '/orders',
    tags: [],
    deprecated: false,
    parameters: [],
    responses: [],
    security: [],
    servers: [],
    ...partial,
  };
}

class OrdersController {
  findAll(): string {
    return 'orders';
  }
}
class CustomersController {
  findAll(): string {
    return 'customers';
  }
}

function route(partial: Partial<DiscoveredRoute> = {}): DiscoveredRoute {
  const handler = (): string => 'handled';
  return {
    controller: OrdersController,
    controllerName: 'OrdersController',
    declaredOn: OrdersController,
    handler,
    handlerName: 'findAll',
    method: 'get',
    path: '/orders',
    ...partial,
  };
}

describe('pairRoutes, rule one: the operation id a person wrote', () => {
  it('should pair on the operationId the handler carries, which is what the document holds', () => {
    // Given a host that names its own operations, which `@ApiOperation({ operationId })` writes on
    // the handler and `@nestjs/swagger` copies into the document verbatim. WHAT USED TO HAPPEN: the
    // index was keyed by the written name and the probe was the derived one, so the two never met.
    const node = operation({
      id: 'op-1',
      path: '/api/v1/navigation',
      rawOperationId: 'getNavigation',
    });

    // When, from a route whose path resembles the document's nowhere, so nothing but the name pairs
    const result = pairRoutes(
      [node],
      [route({ handlerName: 'navigation', operationId: 'getNavigation', path: '/dashboards' })],
    );

    // Then
    expect(result.targets.map((target) => target.node.id)).toEqual(['op-1']);
    expect(result.nodesWithoutRoute).toEqual([]);
  });

  it('should prefer the written id over the derived one when the document holds both', () => {
    // Given, the written name is the one the document indexes this handler's operation under
    const nodes = [
      operation({ id: 'written', path: '/a', rawOperationId: 'getNavigation' }),
      operation({ id: 'derived', path: '/b', rawOperationId: 'OrdersController_findAll' }),
    ];

    // When
    const result = pairRoutes(nodes, [route({ operationId: 'getNavigation' })]);

    // Then
    expect(result.targets.map((target) => target.node.id)).toEqual(['written']);
  });

  it('should still pair on the derived id when the handler carries no written one', () => {
    // Given, the default: nobody wrote an operationId and the generator derived one
    const node = operation({
      id: 'op-1',
      path: '/v2/orders',
      rawOperationId: 'OrdersController_findAll',
    });

    // When
    const result = pairRoutes([node], [route({ path: '/orders' })]);

    // Then
    expect(result.targets.map((target) => target.node.id)).toEqual(['op-1']);
  });
});

describe('pairRoutes, rule one: the raw operation id', () => {
  it('should pair on the id @nestjs/swagger writes, even when the paths disagree', () => {
    // Given, a versioned route whose document path no longer resembles the controller's
    const node = operation({
      id: 'op-1',
      path: '/v2/orders',
      rawOperationId: 'OrdersController_findAll',
    });

    // When
    const result = pairRoutes([node], [route({ path: '/orders' })]);

    // Then
    expect(result.targets.map((target) => target.node.id)).toEqual(['op-1']);
    expect(result.nodesWithoutRoute).toEqual([]);
  });

  it('should not pair two controllers sharing a method name with one another', () => {
    // Given, `findAll` on two controllers is the norm rather than the exception
    const nodes = [
      operation({ id: 'orders', path: '/orders', rawOperationId: 'OrdersController_findAll' }),
      operation({
        id: 'customers',
        path: '/customers',
        rawOperationId: 'CustomersController_findAll',
      }),
    ];
    const routes = [
      route({ path: '/orders' }),
      route({
        controller: CustomersController,
        controllerName: 'CustomersController',
        declaredOn: CustomersController,
        path: '/customers',
      }),
    ];

    // When
    const result = pairRoutes(nodes, routes);

    // Then
    expect(result.targets.map((target) => `${target.node.id}:${target.controller.name}`)).toEqual([
      'orders:OrdersController',
      'customers:CustomersController',
    ]);
  });
});

describe('pairRoutes, rule two: method and path', () => {
  it('should pair on method and path when the document carries no operation id', () => {
    // Given
    const node = operation({ id: 'op-1', method: 'GET', path: '/orders/{id}' });

    // When
    const result = pairRoutes([node], [route({ path: '/orders/{id}' })]);

    // Then
    expect(result.targets.map((target) => target.node.id)).toEqual(['op-1']);
  });

  it('should refuse a path that differs, rather than reaching for the nearest one', () => {
    // Given
    const node = operation({ id: 'op-1', path: '/orders/{orderId}' });

    // When
    const result = pairRoutes([node], [route({ path: '/orders/{id}' })]);

    // Then
    expect(result.targets).toEqual([]);
    expect(result.routesWithoutNode.map((problem) => problem.subject)).toEqual([
      'GET /orders/{id}',
    ]);
    expect(result.nodesWithoutRoute.map((problem) => problem.subject)).toEqual(['op-1']);
  });

  it('should refuse a matching path under a different method', () => {
    // Given
    const node = operation({ id: 'op-1', method: 'post', path: '/orders' });

    // When
    const result = pairRoutes([node], [route({ method: 'get', path: '/orders' })]);

    // Then
    expect(result.targets).toEqual([]);
  });

  it('should pair a prefixed document exactly, where the suffix rule matched two', () => {
    // Given the shape the maintainer's application has: a global prefix, and one controller nested
    // under another's name. WHAT USED TO HAPPEN: rule two compared `/dashboards` with
    // `/api/v1/dashboards` and never matched, and the unanchored rule below it matched both
    // operations, so the route was attributed to neither and the operation it serves was reported
    // as having no handler at all.
    const nodes = [
      operation({ id: 'navigation', path: '/api/v1/dashboards' }),
      operation({ id: 'admin-list', path: '/api/v1/admin/dashboards' }),
    ];

    // When
    const result = pairRoutes(nodes, [route({ path: '/dashboards' })], {
      globalPrefix: '/api/v1',
    });

    // Then
    expect(result.targets.map((target) => target.node.id)).toEqual(['navigation']);
    expect(result.ambiguous).toEqual([]);
  });

  it('should take the unprefixed path first, for a document written with ignoreGlobalPrefix', () => {
    // Given a document generated with `ignoreGlobalPrefix`, from an application that has a prefix
    const nodes = [
      operation({ id: 'plain', path: '/orders' }),
      operation({ id: 'prefixed', path: '/api/v1/orders' }),
    ];

    // When
    const result = pairRoutes(nodes, [route({ path: '/orders' })], { globalPrefix: '/api/v1' });

    // Then, the controller's own spelling wins, because that is the one it declares
    expect(result.targets.map((target) => target.node.id)).toEqual(['plain']);
  });

  it('should read a prefix set as api/v1, /api/v1 or /api/v1/ as the same prefix', () => {
    // Given, NestJS accepts all three spellings from setGlobalPrefix
    const node = operation({ id: 'op-1', path: '/api/v1/orders' });

    // When, Then. The normalization is `readGlobalPrefix`'s, and this pins that the pairing needs
    // one spelling rather than coping with three.
    const paired = pairRoutes([node], [route({ path: '/orders' })], { globalPrefix: '/api/v1' });
    expect(paired.targets.map((target) => target.node.id)).toEqual(['op-1']);
  });
});

describe('pairRoutes, rule three: the global prefix', () => {
  it('should pair a prefixed document path with the controller path it ends in', () => {
    // Given, `setGlobalPrefix("api")` with a document generated the default way
    const node = operation({ id: 'op-1', path: '/api/v1/orders' });

    // When
    const result = pairRoutes([node], [route({ path: '/orders' })]);

    // Then
    expect(result.targets.map((target) => target.node.id)).toEqual(['op-1']);
  });

  it('should refuse a suffix that is not a whole segment', () => {
    // Given, `/reorders` ends with `orders` but not with `/orders`, and is a different endpoint
    const node = operation({ id: 'op-1', path: '/reorders' });

    // When
    const result = pairRoutes([node], [route({ path: '/orders' })]);

    // Then
    expect(result.targets).toEqual([]);
    expect(result.routesWithoutNode).toHaveLength(1);
  });

  it('should report an ambiguity rather than pick one of two prefixed candidates', () => {
    // Given
    const nodes = [
      operation({ id: 'public', path: '/public/orders' }),
      operation({ id: 'internal', path: '/internal/orders' }),
    ];

    // When
    const result = pairRoutes(nodes, [route({ path: '/orders' })]);

    // Then
    expect(result.targets).toEqual([]);
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0]?.subject).toBe('GET /orders');
    expect(result.ambiguous[0]?.declaredBy).toBe('OrdersController.findAll');
    expect(result.ambiguous[0]?.reason).toBe(
      'it matches 2 operations, public, internal, so no fact is attributed to any of them',
    );
    // The action is what `openref doctor` prints under the subject, per SPEC 7.1, and a problem
    // reaching a reader with the reason in both slots is the defect the voice sweep exists for.
    expect(result.ambiguous[0]?.action).toContain('operationId');
  });

  it('should say an operation lost its handler, rather than that none was found', () => {
    // Given the maintainer's shape: one route matching two operations, one of which is served by
    // another route. WHAT USED TO HAPPEN: the loser was reported as `no handler was found for GET
    // /public/orders`, which a reader is shown as `orphan-operation` telling them to delete
    // documentation whose handler had in fact been found, matched twice and discarded.
    const nodes = [
      operation({ id: 'public', path: '/public/orders' }),
      operation({ id: 'internal', path: '/internal/orders' }),
    ];
    const routes = [
      route({ path: '/orders' }),
      route({
        controller: CustomersController,
        controllerName: 'CustomersController',
        declaredOn: CustomersController,
        path: '/internal/orders',
      }),
    ];

    // When
    const result = pairRoutes(nodes, routes);

    // Then
    expect(result.targets.map((target) => target.node.id)).toEqual(['internal']);
    expect(result.nodesWithoutRoute.map((problem) => problem.subject)).toEqual(['public']);
    expect(result.nodesWithoutRoute[0]?.reason).toBe(
      'GET /orders matched it and other operations, so it was attributed to none',
    );
    expect(result.nodesWithoutRoute[0]?.detail).toContain('OrdersController.findAll');
  });

  it('should refuse to claim a node twice, and report the second route', () => {
    // Given, two controllers under different prefixes both ending in the same path
    const node = operation({ id: 'op-1', path: '/api/orders' });
    const routes = [
      route({ path: '/orders' }),
      route({
        controller: CustomersController,
        controllerName: 'CustomersController',
        declaredOn: CustomersController,
        path: '/orders',
      }),
    ];

    // When
    const result = pairRoutes([node], routes);

    // Then
    expect(result.targets).toHaveLength(1);
    expect(result.ambiguous.map((problem) => problem.declaredBy)).toEqual([
      'CustomersController.findAll',
    ]);
  });
});

describe('pairRoutes, what is left over on both sides', () => {
  it('should report an operation with no handler, which is orphan-operation', () => {
    // Given
    const node = operation({ id: 'op-1', method: 'delete', path: '/orders/{id}' });

    // When
    const result = pairRoutes([node], []);

    // Then
    expect(result.nodesWithoutRoute).toHaveLength(1);
    expect(result.nodesWithoutRoute[0]?.subject).toBe('op-1');
    expect(result.nodesWithoutRoute[0]?.reason).toBe(
      'no handler was found for DELETE /orders/{id}',
    );
    expect(result.nodesWithoutRoute[0]?.action).toContain('nothing, when the operation is');
  });

  it('should give every problem it writes an action beside the reason, per SPEC 7.1', () => {
    // Given one document and one route that produce all three lists at once
    const nodes = [
      operation({ id: 'unserved', method: 'delete', path: '/orders/{id}' }),
      operation({ id: 'public', path: '/public/orders' }),
      operation({ id: 'internal', path: '/internal/orders' }),
    ];
    const routes = [route({ path: '/orders' }), route({ method: 'post', path: '/refunds' })];

    // When
    const result = pairRoutes(nodes, routes);

    // Then, and the subjects are asserted present first: an empty sweep would satisfy the rule
    const problems = [
      ...result.ambiguous,
      ...result.routesWithoutNode,
      ...result.nodesWithoutRoute,
    ];
    expect(problems).toHaveLength(5);
    expect(problems.filter((problem) => problem.action === undefined)).toEqual([]);
  });

  it('should ignore a channel, because a channel is not served by an HTTP route', () => {
    // Given, M5 puts channels in the same node map
    const channel = {
      kind: 'channel' as const,
      id: 'channel-1',
      tags: [],
      deprecated: false,
      servers: [],
      operations: [],
      messages: [],
    };

    // When
    const result = pairRoutes([channel], [route()]);

    // Then
    expect(result.nodesWithoutRoute).toEqual([]);
    expect(result.routesWithoutNode).toHaveLength(1);
  });
});

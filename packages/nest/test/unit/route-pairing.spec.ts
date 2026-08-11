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
    expect(result.ambiguous).toEqual([
      {
        subject: 'GET /orders',
        declaredBy: 'OrdersController.findAll',
        reason:
          'it matches 2 operations, public, internal, so no fact is attributed to any of them',
      },
    ]);
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
    expect(result.nodesWithoutRoute).toEqual([
      { subject: 'op-1', reason: 'no handler was found for DELETE /orders/{id}' },
    ]);
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

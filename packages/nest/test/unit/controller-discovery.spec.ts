import { describe, expect, it } from 'vitest';
import {
  discoverRoutes,
  joinPath,
} from '../../src/runtime/infrastructure/adapters/controller-discovery.adapter';
import { NEST_ROUTE_METADATA } from '../../src/shared/types/nest-surface';
import type {
  DiscoveryServiceLike,
  InstanceWrapperLike,
  ReflectorLike,
} from '../../src/shared/types/nest-surface';

/**
 * The discovery pass of TX-FORROOT, exercised without NestJS.
 *
 * THE FAKES ARE THE STRUCTURAL TYPES AND NOTHING ELSE, which is the same claim the rest of this
 * package's unit suite makes: if the pass needs something these two interfaces do not offer, it
 * will not compile here. That the real framework satisfies them is proved separately, by
 * `nest-value-surface.spec.ts` against the installed copy and by the compatibility matrix
 * against two majors.
 */

/** Metadata written the way `@Controller` and `@Get` write it, keyed by target. */
function reflectorOver(metadata: Map<unknown, Record<string, unknown>>): ReflectorLike {
  return {
    get: (key: unknown, target: unknown): unknown =>
      metadata.get(target)?.[String(key)] ?? undefined,
    getAllAndOverride: (): unknown => undefined,
  };
}

function discoveryOver(wrappers: readonly InstanceWrapperLike[]): DiscoveryServiceLike {
  return { getControllers: () => wrappers, getProviders: () => [] };
}

describe('joinPath', () => {
  it('should write a NestJS parameter the way a document writes it', () => {
    // Given
    const prefix = 'orders';
    const suffix = ':id/items/:itemId';

    // When
    const path = joinPath(prefix, suffix);

    // Then
    expect(path).toBe('/orders/{id}/items/{itemId}');
  });

  it('should collapse empty fragments rather than emit a double slash', () => {
    // Given, `@Controller()` with `@Get()` is the commonest controller there is
    const path = joinPath('', '');

    // Then
    expect(path).toBe('/');
  });

  it('should drop the optional marker, because the document writes the two paths separately', () => {
    // Given
    const path = joinPath('/orders', ':id?');

    // Then
    expect(path).toBe('/orders/{id}');
  });
});

describe('discoverRoutes', () => {
  it('should report the class, the method and the path of every handler', () => {
    // Given
    class OrdersController {
      findAll(): string {
        return 'findAll';
      }
      findOne(): string {
        return 'findOne';
      }
    }
    const prototype = OrdersController.prototype as unknown as Record<string, unknown>;
    const metadata = new Map<unknown, Record<string, unknown>>([
      [OrdersController, { [NEST_ROUTE_METADATA.path]: 'orders' }],
      [prototype.findAll, { [NEST_ROUTE_METADATA.method]: 0, [NEST_ROUTE_METADATA.path]: '/' }],
      [prototype.findOne, { [NEST_ROUTE_METADATA.method]: 0, [NEST_ROUTE_METADATA.path]: ':id' }],
    ]);

    // When
    const result = discoverRoutes(
      discoveryOver([{ metatype: OrdersController, instance: new OrdersController() }]),
      reflectorOver(metadata),
    );

    // Then
    expect(result.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'get /orders',
      'get /orders/{id}',
    ]);
    expect(result.routes.map((route) => route.controllerName)).toEqual([
      'OrdersController',
      'OrdersController',
    ]);
    expect(result.routes.map((route) => route.handlerName)).toEqual(['findAll', 'findOne']);
    expect(result.problems).toEqual([]);
  });

  it('should hand over the handler itself, because that is where the metadata a collector reads sits', () => {
    // Given
    class OrdersController {
      findAll(): string {
        return 'findAll';
      }
    }
    const prototype = OrdersController.prototype as unknown as Record<string, unknown>;
    const metadata = new Map<unknown, Record<string, unknown>>([
      [prototype.findAll, { [NEST_ROUTE_METADATA.method]: 0 }],
    ]);

    // When
    const result = discoverRoutes(
      discoveryOver([{ metatype: OrdersController, instance: new OrdersController() }]),
      reflectorOver(metadata),
    );

    // Then
    expect(result.routes[0]?.handler).toBe(prototype.findAll);
    expect(result.routes[0]?.controller).toBe(OrdersController);
  });

  it('should ignore a method that carries no request method, because it is not a route', () => {
    // Given, a controller's lifecycle hook and its constructor
    class OrdersController {
      onModuleInit(): string {
        return 'onModuleInit';
      }
      findAll(): string {
        return 'findAll';
      }
    }
    const prototype = OrdersController.prototype as unknown as Record<string, unknown>;
    const metadata = new Map<unknown, Record<string, unknown>>([
      [prototype.findAll, { [NEST_ROUTE_METADATA.method]: 0 }],
    ]);

    // When
    const result = discoverRoutes(
      discoveryOver([{ metatype: OrdersController, instance: new OrdersController() }]),
      reflectorOver(metadata),
    );

    // Then
    expect(result.routes).toHaveLength(1);
    expect(result.problems).toEqual([]);
  });

  it('should report rather than guess a request method it does not know', () => {
    // Given, `@All()` is 5 and the WebDAV verbs NestJS 11 added are above 8
    class GatewayController {
      everything(): string {
        return 'everything';
      }
    }
    const prototype = GatewayController.prototype as unknown as Record<string, unknown>;
    const metadata = new Map<unknown, Record<string, unknown>>([
      [prototype.everything, { [NEST_ROUTE_METADATA.method]: 5 }],
    ]);

    // When
    const result = discoverRoutes(
      discoveryOver([{ metatype: GatewayController, instance: new GatewayController() }]),
      reflectorOver(metadata),
    );

    // Then
    expect(result.routes).toEqual([]);
    expect(result.problems).toEqual([
      {
        subject: 'GatewayController.everything',
        reason:
          'it is registered for request method 5, which is either the ALL wildcard or a WebDAV ' +
          'verb, and neither names one operation',
      },
    ]);
  });

  it('should report a controller with no class rather than skipping it silently', () => {
    // Given, a controller registered with useValue has no metatype to read metadata off
    const result = discoverRoutes(
      discoveryOver([{ name: 'LegacyController', instance: {} }]),
      reflectorOver(new Map()),
    );

    // Then
    expect(result.routes).toEqual([]);
    expect(result.problems).toEqual([
      {
        subject: 'LegacyController',
        reason: 'it has no class behind it, so no route metadata could be read',
      },
    ]);
  });

  it('should produce one route per path when a controller declares several', () => {
    // Given, NestJS accepts an array in either position
    class AliasController {
      read(): string {
        return 'read';
      }
    }
    const prototype = AliasController.prototype as unknown as Record<string, unknown>;
    const metadata = new Map<unknown, Record<string, unknown>>([
      [AliasController, { [NEST_ROUTE_METADATA.path]: ['orders', 'purchases'] }],
      [prototype.read, { [NEST_ROUTE_METADATA.method]: 0, [NEST_ROUTE_METADATA.path]: ':id' }],
    ]);

    // When
    const result = discoverRoutes(
      discoveryOver([{ metatype: AliasController, instance: new AliasController() }]),
      reflectorOver(metadata),
    );

    // Then
    expect(result.routes.map((route) => route.path)).toEqual(['/orders/{id}', '/purchases/{id}']);
  });

  it('should find a handler declared on a base class, and name the class it is written on', () => {
    // Given, the inherited handler case. NestJS registers the route, so a pass that missed it
    // would report a documented endpoint as having no handler, which is a drift finding this
    // package would have invented.
    class BaseController {
      findAll(): string {
        return 'findAll';
      }
    }
    class OrdersController extends BaseController {
      findOne(): string {
        return 'findOne';
      }
    }
    const base = BaseController.prototype as unknown as Record<string, unknown>;
    const derived = OrdersController.prototype as unknown as Record<string, unknown>;
    const metadata = new Map<unknown, Record<string, unknown>>([
      [base.findAll, { [NEST_ROUTE_METADATA.method]: 0, [NEST_ROUTE_METADATA.path]: 'all' }],
      [derived.findOne, { [NEST_ROUTE_METADATA.method]: 0, [NEST_ROUTE_METADATA.path]: 'one' }],
    ]);

    // When
    const result = discoverRoutes(
      discoveryOver([{ metatype: OrdersController, instance: new OrdersController() }]),
      reflectorOver(metadata),
    );

    // Then, both are routes, both are served by OrdersController, and the inherited one says
    // where its body lives, which is what a source link needs
    expect(result.routes.map((route) => route.handlerName).sort()).toEqual(['findAll', 'findOne']);
    expect(result.routes.every((route) => route.controller === OrdersController)).toBe(true);
    expect(
      Object.fromEntries(result.routes.map((route) => [route.handlerName, route.declaredOn.name])),
    ).toEqual({ findOne: 'OrdersController', findAll: 'BaseController' });
  });

  it('should let an override shadow the inherited handler, exactly as the runtime does', () => {
    // Given
    class BaseController {
      findAll(): string {
        return 'findAll';
      }
    }
    class OrdersController extends BaseController {
      override findAll(): string {
        return 'overridden';
      }
    }
    const derived = OrdersController.prototype as unknown as Record<string, unknown>;
    const metadata = new Map<unknown, Record<string, unknown>>([
      [derived.findAll, { [NEST_ROUTE_METADATA.method]: 0 }],
    ]);

    // When
    const result = discoverRoutes(
      discoveryOver([{ metatype: OrdersController, instance: new OrdersController() }]),
      reflectorOver(metadata),
    );

    // Then
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]?.declaredOn.name).toBe('OrdersController');
  });
});

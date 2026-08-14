import { describe, expect, it } from 'vitest';
import 'reflect-metadata';
import type { IRConfidence, IRFact, IRNode } from '@openref/core';
import {
  pipesCollector,
  PIPES_COLLECTOR_NAME,
} from '../../src/runtime/infrastructure/collectors/pipes.collector';
import { readGlobalPipes } from '../../src/runtime/domain/pipes';
import { NEST_PIPES_METADATA, NEST_ROUTE_ARGS_METADATA } from '../../src/shared/types/nest-surface';
import type { CollectorContext } from '../../src/runtime/application/ports/collector.port';
import type {
  ControllerLike,
  DiscoveryServiceLike,
  HandlerLike,
  ReflectorLike,
} from '../../src/shared/types/nest-surface';

/**
 * `pipesCollector`, held to the guard collector's ceiling with the third scope added.
 *
 * WHAT IS BEING PINNED: class names and scopes, never logic; nothing at all on a route with no
 * pipes rather than an empty list; `derived` and never higher; and the scope beside every name,
 * because `TrimPipe` on the route and `TrimPipe` on one parameter are two decisions, per SPEC
 * 6.2.1.
 */

class TrimPipe {
  transform(value: unknown): unknown {
    return value;
  }
}
class ParseIdPipe {
  transform(value: unknown): unknown {
    return value;
  }
}

/** A reflector answering `@UsePipes` metadata from a table keyed by target. */
function reflectorOf(entries: ReadonlyMap<unknown, readonly unknown[]>): ReflectorLike {
  return {
    get(key: unknown, target: unknown): unknown {
      return key === NEST_PIPES_METADATA ? entries.get(target) : undefined;
    },
    getAllAndOverride(): unknown {
      return undefined;
    },
  };
}

/** A context over one controller and handler, with the pipes tables behind it. */
function contextOf(
  controller: ControllerLike,
  handler: HandlerLike,
  entries: ReadonlyMap<unknown, readonly unknown[]>,
  globalPipes: readonly string[] = [],
): CollectorContext {
  return {
    node: { id: 'orders.list' } as unknown as IRNode,
    controller,
    declaredOn: controller,
    handler,
    handlerName: 'list',
    reflector: reflectorOf(entries),
    moduleRef: { get: () => undefined },
    globalGuards: [],
    globalPipes,
    fact: <T>(value: T, confidence: IRConfidence): IRFact<T> => ({
      value,
      confidence,
      collector: PIPES_COLLECTOR_NAME,
    }),
  };
}

class OrdersController {
  list(): undefined {
    return undefined;
  }
}
const list: HandlerLike = function list() {
  return undefined;
};

describe('pipesCollector', () => {
  it('should report route pipes from both levels with the route scope, controller first', () => {
    // Given `@UsePipes` on the class and on the handler, which NestJS applies in that order
    const collector = pipesCollector();
    const context = contextOf(
      OrdersController,
      list,
      new Map<unknown, readonly unknown[]>([
        [OrdersController, [TrimPipe]],
        [list, [new ParseIdPipe()]],
      ]),
    );

    // When
    const found = collector.collect(context);

    // Then both are named, class and instance alike, every fact at `derived` and scoped `route`
    expect(found?.pipes).toEqual([
      { name: 'TrimPipe', scope: 'route', confidence: 'derived', collector: PIPES_COLLECTOR_NAME },
      {
        name: 'ParseIdPipe',
        scope: 'route',
        confidence: 'derived',
        collector: PIPES_COLLECTOR_NAME,
      },
    ]);
  });

  it('should report a parameter pipe with the parameter scope, from the route bindings', () => {
    // Given `@Query('currency', ParseIdPipe)`, whose pipe lives inside the binding metadata on
    // the controller class and the method name together
    class BoundController {
      list(): undefined {
        return undefined;
      }
    }
    Reflect.defineMetadata(
      NEST_ROUTE_ARGS_METADATA,
      { '4:0': { index: 0, data: 'currency', pipes: [ParseIdPipe] } },
      BoundController,
      'list',
    );
    const collector = pipesCollector();
    const context = contextOf(BoundController, list, new Map());

    // When
    const found = collector.collect(context);

    // Then
    expect(found?.pipes).toEqual([
      {
        name: 'ParseIdPipe',
        scope: 'parameter',
        confidence: 'derived',
        collector: PIPES_COLLECTOR_NAME,
      },
    ]);
  });

  it('should report a global pipe on every node, from the context, at the global scope', () => {
    // Given a provider under APP_PIPE, read once by the pass and handed over as context
    const collector = pipesCollector();
    const context = contextOf(OrdersController, list, new Map(), ['ValidationPipe']);

    // When
    const found = collector.collect(context);

    // Then the route inherits the application's decision, and the scope says whose it was
    expect(found?.pipes).toEqual([
      {
        name: 'ValidationPipe',
        scope: 'global',
        confidence: 'derived',
        collector: PIPES_COLLECTOR_NAME,
      },
    ]);
  });

  it('should report nothing at all on a route with no pipes at any scope', () => {
    // Given
    const collector = pipesCollector();

    // When
    const found = collector.collect(contextOf(OrdersController, list, new Map()));

    // Then no field rather than an empty list: the collector can only vouch for what it reads
    expect(found).toBeUndefined();
  });

  it('should count an unnameable pipe rather than dropping it or calling it Object', () => {
    // Given a plain object pipe, which is legal and has no class name to give
    const collector = pipesCollector();
    const context = contextOf(
      OrdersController,
      list,
      new Map<unknown, readonly unknown[]>([[list, [{ transform: (v: unknown) => v }]]]),
    );

    // When
    const found = collector.collect(context);

    // Then nothing is reported for it and the problem names the route
    expect(found).toBeUndefined();
    expect(collector.problems()).toHaveLength(1);
    expect(collector.problems()[0]?.subject).toBe('OrdersController.list');
    expect(collector.problems()[0]?.reason).toContain('1 pipe(s)');
  });
});

describe('readGlobalPipes', () => {
  it('should read APP_PIPE providers by subtype or token prefix, instance name first', () => {
    // Given the two shapes NestJS produces for the registration
    const discovery: DiscoveryServiceLike = {
      getControllers: () => [],
      getProviders: () => [
        { token: 'APP_PIPE (UUID: 123abc)', instance: new TrimPipe(), metatype: TrimPipe },
        { subtype: 'pipe', instance: new ParseIdPipe() },
        { token: 'APP_GUARD (UUID: 456def)', instance: {} },
      ],
    };

    // When
    const reading = readGlobalPipes(discovery);

    // Then the guard provider is not a pipe, and both pipes are named once each
    expect(reading.names).toEqual(['TrimPipe', 'ParseIdPipe']);
    expect(reading.anonymous).toBe(0);
  });

  it('should count an unnameable global pipe, so it is not silently absent', () => {
    // Given `{ provide: APP_PIPE, useValue: { transform } }`
    const discovery: DiscoveryServiceLike = {
      getControllers: () => [],
      getProviders: () => [{ subtype: 'pipe', instance: { transform: (v: unknown) => v } }],
    };

    // When
    const reading = readGlobalPipes(discovery);

    // Then
    expect(reading.names).toEqual([]);
    expect(reading.anonymous).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import type { IRConfidence, IRFact, IRNode } from '@openref/core';
import {
  guardsCollector,
  GUARDS_COLLECTOR_NAME,
} from '../../src/runtime/infrastructure/collectors/guards.collector';
import { NEST_GUARD_METADATA } from '../../src/shared/types/nest-surface';
import type { CollectorContext } from '../../src/runtime/application/ports/collector.port';
import type {
  ControllerLike,
  HandlerLike,
  ReflectorLike,
} from '../../src/shared/types/nest-surface';

/**
 * `guardsCollector`, held to the ceiling SPEC 6.1 puts on it.
 *
 * WHAT IS BEING PINNED IS AS MUCH WHAT IT DOES NOT DO. It reports class names and never a
 * decision, it reports nothing at all on a route with no guards of its own rather than an empty
 * list, and every fact it produces is `derived` and never higher. Each of those is a promise the
 * project made in SPEC 6.1 and each is one line away from being broken by a well meaning change.
 */

class AuthGuard {
  canActivate(): boolean {
    return true;
  }
}
class AdminGuard {
  canActivate(): boolean {
    return true;
  }
}

/** A reflector that answers from a table keyed by target. */
function reflectorOf(entries: ReadonlyMap<unknown, readonly unknown[]>): ReflectorLike {
  return {
    get(key: unknown, target: unknown): unknown {
      return key === NEST_GUARD_METADATA ? entries.get(target) : undefined;
    },
    getAllAndOverride(): unknown {
      return undefined;
    },
  };
}

/** A context over one controller and one handler, with the guards table behind it. */
function contextOf(
  controller: ControllerLike,
  handler: HandlerLike,
  entries: ReadonlyMap<unknown, readonly unknown[]>,
): CollectorContext {
  return {
    node: { id: 'orders.list' } as unknown as IRNode,
    controller,
    declaredOn: controller,
    handler,
    handlerName: 'list',
    reflector: reflectorOf(entries),
    moduleRef: { get: () => undefined },
    fact: <T>(value: T, confidence: IRConfidence): IRFact<T> => ({
      value,
      confidence,
      collector: GUARDS_COLLECTOR_NAME,
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

describe('guardsCollector', () => {
  it('should report a controller guard and a handler guard, controller first', () => {
    // Given a route protected at both levels, which NestJS runs in that order
    const collector = guardsCollector();
    const context = contextOf(
      OrdersController,
      list,
      new Map<unknown, readonly unknown[]>([
        [OrdersController, [AuthGuard]],
        [list, [AdminGuard]],
      ]),
    );

    // When
    const produced = collector.collect(context);

    // Then
    expect(produced?.guards?.map((guard) => guard.name)).toEqual(['AuthGuard', 'AdminGuard']);
  });

  it('should report the same guard once when it is declared at both levels', () => {
    // Given. It is one guard applied to one route, and naming it twice reads as two protections.
    const collector = guardsCollector();
    const context = contextOf(
      OrdersController,
      list,
      new Map<unknown, readonly unknown[]>([
        [OrdersController, [AuthGuard]],
        [list, [AuthGuard]],
      ]),
    );

    // When
    const produced = collector.collect(context);

    // Then
    expect(produced?.guards?.map((guard) => guard.name)).toEqual(['AuthGuard']);
  });

  it('should name a guard registered as an instance, which is ordinary usage', () => {
    // Given `@UseGuards(new AuthGuard())`, which stores the instance rather than the class
    const collector = guardsCollector();
    const context = contextOf(
      OrdersController,
      list,
      new Map<unknown, readonly unknown[]>([[list, [new AuthGuard()]]]),
    );

    // When
    const produced = collector.collect(context);

    // Then
    expect(produced?.guards?.map((guard) => guard.name)).toEqual(['AuthGuard']);
  });

  it('should emit derived and never a higher level', () => {
    // Given. SPEC 6.1 names a guard class name as the example of `derived`. `declared` belongs to
    // a decorator somebody wrote to document the route, and @UseGuards is not one.
    const collector = guardsCollector();
    const context = contextOf(
      OrdersController,
      list,
      new Map<unknown, readonly unknown[]>([[list, [AuthGuard, AdminGuard]]]),
    );

    // When
    const produced = collector.collect(context);

    // Then
    expect(produced?.guards?.map((guard) => guard.confidence)).toEqual(['derived', 'derived']);
    expect(produced?.guards?.every((guard) => guard.collector === GUARDS_COLLECTOR_NAME)).toBe(
      true,
    );
  });

  it('should report nothing at all on a route with no guards of its own', () => {
    // Given. An empty list would claim the route was examined and nothing protects it, and this
    // collector cannot see a global guard, so that claim would be false on a protected app.
    const collector = guardsCollector();
    const context = contextOf(OrdersController, list, new Map<unknown, readonly unknown[]>());

    // When
    const produced = collector.collect(context);

    // Then
    expect(produced).toBeUndefined();
    expect(collector.problems()).toEqual([]);
  });

  it('should count a guard it cannot name rather than dropping it', () => {
    // Given an anonymous class, which is still a guard: dropping it makes a protected route read
    // as unprotected, which is the one direction this must not fail in.
    const collector = guardsCollector();
    const context = contextOf(
      OrdersController,
      list,
      new Map<unknown, readonly unknown[]>([
        [
          list,
          [
            class {
              canActivate(): boolean {
                return true;
              }
            },
            AuthGuard,
          ],
        ],
      ]),
    );

    // When
    const produced = collector.collect(context);

    // Then
    expect(produced?.guards?.map((guard) => guard.name)).toEqual(['AuthGuard']);
    expect(collector.problems()).toHaveLength(1);
    expect(collector.problems()[0]?.reason).toContain('no class name');
    expect(collector.problems()[0]?.subject).toBe('OrdersController.list');
  });

  it('should ignore metadata that is not a list, rather than reading it', () => {
    // Given whatever somebody put under the key, which is what `ReflectorLike` warns about
    const collector = guardsCollector();
    const context = contextOf(
      OrdersController,
      list,
      new Map<unknown, readonly unknown[]>([[list, 'AuthGuard' as unknown as readonly unknown[]]]),
    );

    // When
    const produced = collector.collect(context);

    // Then
    expect(produced).toBeUndefined();
  });
});

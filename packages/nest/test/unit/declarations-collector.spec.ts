import { describe, expect, it } from 'vitest';
import type { IRConfidence, IRFact, IRNode } from '@openref/core';
import { declarationsCollector } from '../../src/runtime/infrastructure/collectors/declarations.collector';
import { scopesCollector } from '../../src/runtime/infrastructure/collectors/metadata.collector';
import { CollectorRegistry } from '../../src/runtime/application/services/collector-registry.service';
import { OPENREF_METADATA } from '../../src/api/decorators/metadata';
import { isRuntimeCollector } from '../../src/runtime/application/ports/collector.port';
import type { CollectorContext } from '../../src/runtime/application/ports/collector.port';
import type { HandlerLike, ReflectorLike } from '../../src/shared/types/nest-surface';

/**
 * The collector that reads `@ApiScopes`, and the precedence that makes it worth having.
 *
 * THE INTERESTING CASE IS THE ONE WHERE BOTH COLLECTORS ANSWER. `scopesCollector` reads a key the
 * application's own decorator writes, at `derived`; this one reads a decorator whose only purpose
 * is to document the route, at `declared`. SPEC 6.2 says better provenance wins and registration
 * order breaks ties, so the declaration has to win in both registration orders. A test that ran
 * them in one order would pass on an implementation that simply took the last one to speak.
 */

const APP_SCOPES_KEY = 'app:scopes';

class OrdersController {
  list(): undefined {
    return undefined;
  }
}

const list: HandlerLike = function list() {
  return undefined;
};

/** What one route carries. */
interface Route {
  /** `@ApiScopes`. */
  readonly declared?: unknown;
  /** The application's own key. */
  readonly appScopes?: unknown;
}

/** A reflector over one route. */
function reflectorOf(route: Route): ReflectorLike {
  return {
    get(): unknown {
      return undefined;
    },
    getAllAndOverride(key: unknown): unknown {
      if (key === OPENREF_METADATA.scopes) return route.declared;
      if (key === APP_SCOPES_KEY) return route.appScopes;

      return undefined;
    },
  };
}

/** A context over one route. */
function contextOf(route: Route, collectorName = 'declarationsCollector'): CollectorContext {
  return {
    node: { id: 'orders.list' } as unknown as IRNode,
    controller: OrdersController,
    declaredOn: OrdersController,
    handler: list,
    handlerName: 'list',
    reflector: reflectorOf(route),
    moduleRef: { get: () => undefined },
    globalGuards: [],
    fact: <T>(value: T, confidence: IRConfidence): IRFact<T> => ({
      value,
      confidence,
      collector: collectorName,
    }),
  };
}

describe('the declarations collector', () => {
  it('should report @ApiScopes at declared, which no observed source may claim', () => {
    // Given
    const collector = declarationsCollector();

    // When
    const runtime = collector.collect(contextOf({ declared: ['orders:read'] }));

    // Then
    expect(runtime?.scopes?.value).toEqual(['orders:read']);
    expect(runtime?.scopes?.confidence).toBe('declared');
    expect(runtime?.scopes?.collector).toBe('declarationsCollector');
  });

  it('should say nothing about a route that carries no declaration', () => {
    // Given, and it warns about nothing either: an absent declaration is not a defect, and the
    // guarded-and-unreadable case belongs to the collector that reads the application's own key
    const collector = declarationsCollector();

    // When
    const runtime = collector.collect(contextOf({}));

    // Then
    expect(runtime).toBeUndefined();
    expect(collector.problems()).toEqual([]);
  });

  it('should refuse a declaration that is not a list of strings, and say so', () => {
    // Given a host without types who passed an object
    const collector = declarationsCollector();

    // When
    const runtime = collector.collect(contextOf({ declared: { read: true } }));

    // Then, nothing reported rather than a coerced value
    expect(runtime).toBeUndefined();
    expect(collector.problems()).toHaveLength(1);
    expect(collector.problems()[0]?.subject).toBe('OrdersController.list');
  });
});

describe('a declaration against an observation', () => {
  /**
   * Runs both collectors over one route through the registry, which is what does the merging.
   *
   * @param order - Registration order
   * @returns The merged runtime facts
   */
  function collectBoth(
    order: 'declared-first' | 'derived-first',
  ): ReturnType<CollectorRegistry['collect']> {
    const declared = declarationsCollector();
    const derived = scopesCollector({ metadataKey: APP_SCOPES_KEY });
    if (!isRuntimeCollector(derived)) throw new Error('the scopes collector declined to load');

    const collectors = order === 'declared-first' ? [declared, derived] : [derived, declared];
    const context = contextOf({ declared: ['orders:write'], appScopes: ['orders:read'] });

    const registry = new CollectorRegistry(collectors, {
      reflector: context.reflector,
      moduleRef: context.moduleRef,
    });

    return registry.collect({
      node: context.node,
      controller: context.controller,
      declaredOn: context.declaredOn,
      handler: context.handler,
      handlerName: context.handlerName,
    });
  }

  it('should let the declaration win when it is registered first', () => {
    // When
    const runtime = collectBoth('declared-first');

    // Then
    expect(runtime?.scopes?.value).toEqual(['orders:write']);
    expect(runtime?.scopes?.confidence).toBe('declared');
  });

  it('should let the declaration win when it is registered last', () => {
    // Given, this is the half that a "last one wins" implementation passes and a "first one wins"
    // implementation fails. SPEC 6.2: better provenance wins, and order only breaks a tie.
    const runtime = collectBoth('derived-first');

    // Then
    expect(runtime?.scopes?.value).toEqual(['orders:write']);
    expect(runtime?.scopes?.confidence).toBe('declared');
  });
});

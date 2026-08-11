import { describe, expect, it } from 'vitest';
import type { IRConfidence, IRFact, IRNode } from '@openref/core';
import {
  rolesCollector,
  scopesCollector,
  type MetadataCollector,
  type MetadataCollectorRegistration,
} from '../../src/runtime/infrastructure/collectors/metadata.collector';
import { isRuntimeCollector } from '../../src/runtime/application/ports/collector.port';
import { NEST_GUARD_METADATA } from '../../src/shared/types/nest-surface';
import type { CollectorContext } from '../../src/runtime/application/ports/collector.port';
import type { HandlerLike, ReflectorLike } from '../../src/shared/types/nest-surface';

/**
 * `scopesCollector` and `rolesCollector`, held to the rule that they never guess.
 *
 * THE CASE THIS FILE IS REALLY ABOUT IS THE GUARDED ROUTE WITH NO METADATA. That is the shape
 * SPEC 6.1's first prohibition describes: a policy exists, it is written in a guard's code, and it
 * will never be readable. A collector that reported nothing there would be indistinguishable from
 * one looking at a route that needs no scopes, and the whole point of the confidence policy is
 * that those two states are not allowed to look the same.
 */

const SCOPES_KEY = 'app:scopes';

class AuthGuard {
  canActivate(): boolean {
    return true;
  }
}

class OrdersController {
  list(): undefined {
    return undefined;
  }
}
const list: HandlerLike = function list() {
  return undefined;
};

/** What one route carries, as the reflector will report it. */
interface Route {
  readonly metadata?: unknown;
  readonly guards?: readonly unknown[];
}

/** A reflector over one route. */
function reflectorOf(route: Route): ReflectorLike {
  return {
    get(key: unknown, target: unknown): unknown {
      return key === NEST_GUARD_METADATA && target === list ? route.guards : undefined;
    },
    getAllAndOverride(key: unknown): unknown {
      return key === SCOPES_KEY ? route.metadata : undefined;
    },
  };
}

/** A context over one route. */
function contextOf(route: Route, collectorName: string): CollectorContext {
  return {
    node: { id: 'orders.list' } as unknown as IRNode,
    controller: OrdersController,
    declaredOn: OrdersController,
    handler: list,
    handlerName: 'list',
    reflector: reflectorOf(route),
    moduleRef: { get: () => undefined },
    fact: <T>(value: T, confidence: IRConfidence): IRFact<T> => ({
      value,
      confidence,
      collector: collectorName,
    }),
  };
}

/**
 * Narrows a registration to the collector, failing loudly when it declined.
 *
 * @param registration - What the factory returned
 * @returns The collector
 */
function running(registration: MetadataCollectorRegistration): MetadataCollector {
  if (!isRuntimeCollector(registration)) throw new Error('the collector declined to run');

  return registration;
}

describe('scopesCollector', () => {
  it('should report the list under the configured key at derived', () => {
    // Given
    const collector = running(scopesCollector({ metadataKey: SCOPES_KEY }));

    // When
    const produced = collector.collect(
      contextOf({ metadata: ['orders:read', 'orders:write'] }, 'scopesCollector'),
    );

    // Then
    expect(produced?.scopes?.value).toEqual(['orders:read', 'orders:write']);
    expect(produced?.scopes?.confidence).toBe('derived');
    expect(produced?.scopes?.collector).toBe('scopesCollector');
  });

  it('should decline to run at all when no usable key was given', () => {
    // Given a key that survived being imported from a module that does not export it. Reading
    // metadata under an empty string finds nothing on every route, so a collector that ran would
    // report no policy anywhere and look exactly like an application that has none.
    const registration = scopesCollector({ metadataKey: '' });

    // When, Then
    expect(isRuntimeCollector(registration)).toBe(false);
    expect(registration.name).toBe('scopesCollector');
    expect('skipped' in registration ? registration.skipped : '').toContain('never guesses');
  });

  it('should warn rather than stay silent when the route is guarded and the key is absent', () => {
    // Given the case SPEC 6.1's first prohibition is about: the guard computes the scopes in code
    const collector = running(scopesCollector({ metadataKey: SCOPES_KEY }));

    // When
    const produced = collector.collect(contextOf({ guards: [AuthGuard] }, 'scopesCollector'));

    // Then
    expect(produced).toBeUndefined();
    expect(collector.problems()).toHaveLength(1);
    expect(collector.problems()[0]?.subject).toBe('OrdersController.list');
    expect(collector.problems()[0]?.reason).toContain('AuthGuard');
    expect(collector.problems()[0]?.reason).toContain('never read');
  });

  it('should stay silent on an unguarded route with no key, because that is no policy', () => {
    // Given. An absent key on an unguarded route means there is nothing to enforce, which is not
    // a finding. Warning here would put every undecorated route in the report.
    const collector = running(scopesCollector({ metadataKey: SCOPES_KEY }));

    // When
    const produced = collector.collect(contextOf({}, 'scopesCollector'));

    // Then
    expect(produced).toBeUndefined();
    expect(collector.problems()).toEqual([]);
  });

  it('should refuse a value that is not a list of strings and say so', () => {
    // Given metadata somebody put there in another shape, per the note on ReflectorLike
    const collector = running(scopesCollector({ metadataKey: SCOPES_KEY }));

    // When
    const produced = collector.collect(
      contextOf({ metadata: { read: true }, guards: [AuthGuard] }, 'scopesCollector'),
    );

    // Then
    expect(produced).toBeUndefined();
    expect(collector.problems()[0]?.reason).toContain('list of strings');
  });

  it('should refuse a list holding something other than strings', () => {
    // Given
    const collector = running(scopesCollector({ metadataKey: SCOPES_KEY }));

    // When
    const produced = collector.collect(
      contextOf({ metadata: ['orders:read', 7] }, 'scopesCollector'),
    );

    // Then
    expect(produced).toBeUndefined();
    expect(collector.problems()[0]?.reason).toContain('list holding something other than strings');
  });

  it('should report an explicitly empty list, because the key was set on purpose', () => {
    // Given `@Scopes()` with no arguments, which is a statement that this route needs none
    const collector = running(scopesCollector({ metadataKey: SCOPES_KEY }));

    // When
    const produced = collector.collect(contextOf({ metadata: [] }, 'scopesCollector'));

    // Then
    expect(produced?.scopes?.value).toEqual([]);
    expect(produced?.scopes?.confidence).toBe('derived');
  });

  it('should accept a symbol key, which is what SetMetadata often carries', () => {
    // Given
    const key = Symbol('scopes');
    const collector = running(scopesCollector({ metadataKey: key }));
    const context: CollectorContext = {
      ...contextOf({}, 'scopesCollector'),
      reflector: {
        get: () => undefined,
        getAllAndOverride: (asked: unknown) => (asked === key ? ['orders:read'] : undefined),
      },
    };

    // When
    const produced = collector.collect(context);

    // Then
    expect(produced?.scopes?.value).toEqual(['orders:read']);
  });
});

describe('rolesCollector', () => {
  it('should fill roles rather than scopes, from the same mechanism', () => {
    // Given
    const collector = running(rolesCollector({ metadataKey: SCOPES_KEY }));

    // When
    const produced = collector.collect(contextOf({ metadata: ['admin'] }, 'rolesCollector'));

    // Then
    expect(produced?.roles?.value).toEqual(['admin']);
    expect(produced?.roles?.confidence).toBe('derived');
    expect(produced?.scopes).toBeUndefined();
  });

  it('should decline to run with no key, under its own name', () => {
    // Given
    const registration = rolesCollector({ metadataKey: '' });

    // When, Then
    expect(isRuntimeCollector(registration)).toBe(false);
    expect(registration.name).toBe('rolesCollector');
  });
});

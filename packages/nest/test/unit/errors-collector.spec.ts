import { describe, expect, it } from 'vitest';
import type { IRConfidence, IRFact, IRNode, IRNodeRuntime } from '@openref/core';
import { withRuntimeErrorContracts } from '@openref/core';
import { errorsCollector } from '../../src/runtime/infrastructure/collectors/errors.collector';
import type { ErrorCatalogEntry } from '../../src/runtime/infrastructure/collectors/errors.collector';
import { guardsCollector } from '../../src/runtime/infrastructure/collectors/guards.collector';
import { CollectorRegistry } from '../../src/runtime/application/services/collector-registry.service';
import { OPENREF_METADATA } from '../../src/api/decorators/metadata';
import type { CollectorContext } from '../../src/runtime/application/ports/collector.port';
import type { HandlerLike, ReflectorLike } from '../../src/shared/types/nest-surface';

/**
 * `errorsCollector`, which builds the two groups of SPEC 6.4 that somebody wrote.
 *
 * THE ASSERTIONS THAT MATTER ARE THE ONES ABOUT WHAT DOES NOT HAPPEN. Turning a class into a
 * contract is a lookup; the failure mode this collector exists to avoid is producing a status for
 * a class nothing said a status for, by constructing it or by reading its name. Both are covered
 * below with a class called `NotFoundError`, which is the name a guesser would get right, so the
 * case only passes on an implementation that refuses to guess.
 *
 * THE THREE GROUPS ARE CHECKED FOR SEPARATION AND NOT ONLY FOR CONTENT. SPEC 6.4 makes the groups
 * three fields precisely so nothing can concatenate them by accident, and a test that only read
 * `errors.declared` would pass on an implementation that also copied everything into one list.
 */

class NotFoundError extends Error {}
class ConflictError extends Error {}

/** An error class that says its own status, which is the second level of SPEC 6.4. */
class GoneError extends Error {
  static readonly status = 410;
}

class OrdersController {
  read(): undefined {
    return undefined;
  }
}

/** The guard the derivation reads through `guardsCollector`. Only its name is ever used. */
class ScopesGuard {
  canActivate(): boolean {
    return true;
  }
}

const read: HandlerLike = function read() {
  return undefined;
};

/** What one route carries. */
interface Route {
  /** `@ApiErrors`, as the decorator stored it. */
  readonly declared?: unknown;
  /** Guard classes on the controller, for the derivation. */
  readonly guards?: readonly unknown[];
}

/** A reflector over one route. */
function reflectorOf(route: Route): ReflectorLike {
  return {
    get(key: unknown): unknown {
      return key === '__guards__' ? route.guards : undefined;
    },
    getAllAndOverride(key: unknown): unknown {
      return key === OPENREF_METADATA.errors ? route.declared : undefined;
    },
  };
}

/** A context over one route. */
function contextOf(route: Route, collectorName = 'errorsCollector'): CollectorContext {
  return {
    node: { id: 'orders.read' } as unknown as IRNode,
    controller: OrdersController,
    declaredOn: OrdersController,
    handler: read,
    handlerName: 'read',
    reflector: reflectorOf(route),
    moduleRef: { get: () => undefined },
    globalGuards: [],
    globalPipes: [],
    fact: <T>(value: T, confidence: IRConfidence): IRFact<T> => ({
      value,
      confidence,
      collector: collectorName,
    }),
  };
}

/** The one node the registry cases run over, since the registry builds its own context. */
const TARGET = {
  node: { id: 'orders.read' } as unknown as IRNode,
  controller: OrdersController,
  declaredOn: OrdersController,
  handler: read,
  handlerName: 'read',
};

/** The catalog the example of SPEC 6.2 passes. */
const CATALOG: Readonly<Record<string, ErrorCatalogEntry>> = {
  NotFoundError: { status: 404, title: 'Order not found', type: 'https://errors/not-found' },
  ConflictError: { status: 409 },
};

describe('the errors collector, declared group', () => {
  it('should turn a declared class into a contract through the catalog', () => {
    // Given `@ApiErrors(NotFoundError)` and a catalog that says what it answers with
    const collector = errorsCollector({ catalogs: [CATALOG] });

    // When
    const runtime = collector.collect(contextOf({ declared: [NotFoundError] }));

    // Then
    expect(runtime?.errors?.declared).toEqual([
      {
        status: 404,
        title: 'Order not found',
        type: 'https://errors/not-found',
        origin: 'declared',
        confidence: 'declared',
        collector: 'errorsCollector',
        schema: expect.objectContaining({ kind: 'inline' }) as unknown,
      },
    ]);
    expect(collector.problems()).toEqual([]);
  });

  it('should use the class name as the title when the catalog gives none', () => {
    // Given a catalog entry carrying only a status
    const collector = errorsCollector({ catalogs: [CATALOG] });

    // When
    const runtime = collector.collect(contextOf({ declared: [ConflictError] }));

    // Then the name the declaration itself used, which is a restatement rather than an invention
    expect(runtime?.errors?.declared[0]?.title).toBe('ConflictError');
    expect(runtime?.errors?.declared[0]?.status).toBe(409);
  });

  it('should read a static status off the class when no catalog answers', () => {
    // Given a class that declares its own status, and a catalog that has never heard of it
    const collector = errorsCollector({ catalogs: [CATALOG] });

    // When
    const runtime = collector.collect(contextOf({ declared: [GoneError] }));

    // Then. A STATIC FIELD IS A DECLARATIVE VALUE UNDER A KNOWN NAME, which is a read and not a
    // construction: the class object is already there and nothing of it is executed.
    expect(runtime?.errors?.declared[0]).toMatchObject({
      status: 410,
      title: 'GoneError',
      confidence: 'declared',
    });
  });

  it('should refuse to invent a status for a class nothing described, and say so', () => {
    // Given `@ApiErrors(NotFoundError)` with no catalog at all. THE CLASS IS DELIBERATELY THE ONE
    // A NAME GUESSER WOULD GET RIGHT: an implementation that mapped `NotFoundError` to 404 would
    // pass every other case in this file and fail here, which is the whole point of the name.
    const collector = errorsCollector();

    // When
    const runtime = collector.collect(contextOf({ declared: [NotFoundError] }));

    // Then no contract, and a reason a person can act on
    expect(runtime?.errors?.declared).toEqual([]);
    expect(collector.problems()).toHaveLength(1);
    expect(collector.problems()[0]?.subject).toBe('OrdersController.read');
    expect(collector.problems()[0]?.reason).toContain('NotFoundError');
    expect(collector.problems()[0]?.reason).toContain('so no contract was built for it');
    expect(collector.problems()[0]?.action).toContain('errorsCollector({ catalogs })');
    expect(collector.problems()[0]?.detail).toContain('never taken from a class name');
  });

  it('should refuse anything that is not a named class, and name what it got', () => {
    // Given a declaration made with a string, which is what a host without types writes
    const collector = errorsCollector({ catalogs: [CATALOG] });

    // When
    const runtime = collector.collect(contextOf({ declared: ['NotFoundError'] }));

    // Then
    expect(runtime?.errors?.declared).toEqual([]);
    expect(collector.problems()[0]?.reason).toContain('a string');
  });

  it('should prefer a catalog keyed by the class over one keyed by name', () => {
    // Given two catalogs disagreeing about a name, the first keyed by the class itself. TWO
    // MODULES MAY EACH EXPORT A `ConflictError`, and identity is the only key that tells them
    // apart, so it is consulted first.
    const byClass = new Map<unknown, ErrorCatalogEntry>([[ConflictError, { status: 423 }]]);
    const collector = errorsCollector({ catalogs: [byClass, CATALOG] });

    // When
    const runtime = collector.collect(contextOf({ declared: [ConflictError] }));

    // Then
    expect(runtime?.errors?.declared[0]?.status).toBe(423);
  });

  it('should give an examined route with no declarations an empty group rather than nothing', () => {
    // Given a route with no `@ApiErrors` at all, which is the SPEC 6.4 pair: an absent `errors`
    // field means nobody was asked, and a present empty group means asked and nothing declared.
    const collector = errorsCollector({ catalogs: [CATALOG] });

    // When
    const runtime = collector.collect(contextOf({}));

    // Then
    expect(runtime?.errors).toEqual({ declared: [], runtimeDerived: [], global: [] });
    expect(collector.problems()).toEqual([]);
  });
});

describe('the errors collector, global group', () => {
  it('should put the application wide list on every node, in its own group', () => {
    // Given a host that says every endpoint can answer 500
    const collector = errorsCollector({
      catalogs: [CATALOG],
      global: [{ status: 500, title: 'Server Error' }],
    });

    // When
    const runtime = collector.collect(contextOf({ declared: [NotFoundError] }));

    // Then the two never mix, which is what three fields buys
    expect(runtime?.errors?.declared.map((one) => one.status)).toEqual([404]);
    expect(runtime?.errors?.global.map((one) => one.status)).toEqual([500]);
    expect(runtime?.errors?.global[0]?.origin).toBe('global');
    expect(runtime?.errors?.global[0]?.confidence).toBe('declared');
  });

  it('should report a global list on a route that declares nothing of its own', () => {
    // Given. This is the third of T021's cases: an application with something global over it and
    // an endpoint that promises nothing gets an empty declared group, not an invented one.
    const collector = errorsCollector({ global: [{ status: 500, title: 'Server Error' }] });

    // When
    const runtime = collector.collect(contextOf({}));

    // Then
    expect(runtime?.errors?.declared).toEqual([]);
    expect(runtime?.errors?.global).toHaveLength(1);
  });
});

describe('the three groups, through the whole pipeline', () => {
  it('should keep a throttled and guarded route with a declaration in three separate groups', () => {
    // Given the arrangement the example application has: a declaration, a guard, and a limit,
    // collected by three different collectors and then derived over
    const route: Route = { declared: [NotFoundError], guards: [ScopesGuard] };
    const registry = new CollectorRegistry(
      [
        errorsCollector({
          catalogs: [CATALOG],
          global: [{ status: 500, title: 'Server Error' }],
        }),
        guardsCollector(),
      ],
      { reflector: reflectorOf(route), moduleRef: { get: () => undefined } },
    );

    const collected = registry.collect(TARGET);

    // When the derivation runs over the merged record, as the pass does
    const runtime = withRuntimeErrorContracts({
      ...(collected ?? {}),
      rateLimit: {
        value: { limit: 30, ttlMs: 60_000 },
        confidence: 'derived',
        collector: 'throttlerCollector',
      },
    });

    // Then. 429 IS IN THE DERIVED GROUP AND NOT IN THE DECLARED ONE, which is T021's second test:
    // the throttler is an observation about the route, and nobody promised 429 by writing it down.
    expect(runtime.errors?.declared.map((one) => one.status)).toEqual([404]);
    expect(runtime.errors?.runtimeDerived.map((one) => one.status)).toEqual([429, 401, 403]);
    expect(runtime.errors?.global.map((one) => one.status)).toEqual([500]);

    // And nothing anywhere in the record is a list holding two groups at once
    for (const one of runtime.errors?.declared ?? []) expect(one.origin).toBe('declared');
    for (const one of runtime.errors?.runtimeDerived ?? [])
      expect(one.origin).toBe('runtime-derived');
    for (const one of runtime.errors?.global ?? []) expect(one.origin).toBe('global');
  });

  it('should produce the same three groups whichever order the collectors were registered in', () => {
    // Given the same two collectors both ways round, which is SPEC 6.2's independence property
    const route: Route = { declared: [NotFoundError], guards: [ScopesGuard] };
    const build = (reversed: boolean): IRNodeRuntime => {
      const collectors = [errorsCollector({ catalogs: [CATALOG] }), guardsCollector()];
      const registry = new CollectorRegistry(reversed ? [...collectors].reverse() : collectors, {
        reflector: reflectorOf(route),
        moduleRef: { get: () => undefined },
      });

      return withRuntimeErrorContracts(registry.collect(TARGET) ?? {});
    };

    // When
    const forwards = build(false);

    // Then, and the groups are checked to be non empty first, because two empty records are also
    // equal and would report independence for a pair that collected nothing
    expect(forwards.errors?.declared).toHaveLength(1);
    expect(forwards.errors?.runtimeDerived).toHaveLength(2);
    expect(forwards.errors).toEqual(build(true).errors);
  });
});

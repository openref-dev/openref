import type { IRNode, IRNodeRuntime } from '@openref/core';
import { describe, expect, it, vi } from 'vitest';
import { CollectorRegistry, COLLECTOR_HEALTH_CHECK_ID } from '../../src/index';
import type {
  CollectorContext,
  CollectorRegistration,
  CollectorTarget,
  IRuntimeCollector,
} from '../../src/index';

/**
 * The registry of SPEC 6.2, and the three properties T017 exists to guarantee.
 *
 * A collector that throws does not break document generation, and the failure is reported.
 * Registration order does not change the output for independent collectors. Collectors that
 * disagree resolve by declared precedence.
 */

const node = {
  kind: 'operation',
  id: 'get-orders',
  method: 'get',
  path: '/orders',
} as unknown as IRNode;

/** Stands in for a real controller. It has a member because an empty class is a lint error. */
class OrdersController {
  readonly declared = true;
}

function targetOf(id = 'get-orders'): CollectorTarget {
  return {
    node: { ...node, id },
    controller: OrdersController,
    handler: function list(): void {
      /* the route handler, present so a collector has an identity to read metadata off */
    },
  };
}

function registryOf(registrations: readonly CollectorRegistration[]): CollectorRegistry {
  return new CollectorRegistry(registrations, {
    reflector: { get: () => undefined, getAllAndOverride: () => undefined },
    moduleRef: { get: () => undefined },
  });
}

/**
 * A collector that returns whatever it is told to.
 *
 * @param name - Its name
 * @param produce - What it returns for a node
 * @returns The collector
 */
function collectorOf(
  name: string,
  produce: (context: CollectorContext) => IRNodeRuntime | undefined,
): IRuntimeCollector {
  return { name, collect: produce };
}

describe('CollectorRegistry', () => {
  it('should merge what independent collectors return into one runtime record', () => {
    // Given two collectors that touch different fields
    const scopes = collectorOf('scopesCollector', (context) => ({
      scopes: context.fact(['orders:read'], 'declared'),
    }));
    const source = collectorOf('sourceCollector', () => ({
      source: { controller: 'OrdersController', handler: 'list' },
    }));

    // When
    const result = registryOf([scopes, source]).collect(targetOf());

    // Then
    expect(result?.scopes).toEqual({
      value: ['orders:read'],
      confidence: 'declared',
      collector: 'scopesCollector',
    });
    expect(result?.source).toEqual({ controller: 'OrdersController', handler: 'list' });
  });

  it('should produce the same output whichever order independent collectors are registered in', () => {
    // Given
    const scopes = collectorOf('scopesCollector', (context) => ({
      scopes: context.fact(['orders:read'], 'declared'),
    }));
    const limits = collectorOf('throttlerCollector', (context) => ({
      rateLimit: context.fact({ limit: 100, ttlMs: 60_000 }, 'derived'),
    }));

    // When
    const forwards = registryOf([scopes, limits]).collect(targetOf());
    const backwards = registryOf([limits, scopes]).collect(targetOf());

    // Then
    expect(forwards).toEqual(backwards);
  });

  it('should let the better provenance win however the two were ordered', () => {
    // Given two collectors that disagree about the same field
    const declared = collectorOf('scopesCollector', (context) => ({
      scopes: context.fact(['orders:read'], 'declared'),
    }));
    const inferred = collectorOf('astCollector', (context) => ({
      scopes: context.fact(['guessed'], 'inferred'),
    }));

    // When
    const declaredFirst = registryOf([declared, inferred]).collect(targetOf());
    const inferredFirst = registryOf([inferred, declared]).collect(targetOf());

    // Then, an inferred guess never displaces a fact somebody wrote on purpose
    expect(declaredFirst?.scopes?.value).toEqual(['orders:read']);
    expect(inferredFirst?.scopes?.value).toEqual(['orders:read']);
    expect(inferredFirst?.scopes?.collector).toBe('scopesCollector');
  });

  it('should break a tie of equal confidence by registration order, first wins', () => {
    // Given, the list reads top to bottom as a statement of precedence
    const first = collectorOf('rolesCollector', (context) => ({
      roles: context.fact(['admin'], 'derived'),
    }));
    const second = collectorOf('caslCollector', (context) => ({
      roles: context.fact(['anyone'], 'derived'),
    }));

    // When
    const result = registryOf([first, second]).collect(targetOf());

    // Then
    expect(result?.roles).toEqual({
      value: ['admin'],
      confidence: 'derived',
      collector: 'rolesCollector',
    });
  });

  it('should attribute a fact to the collector that produced it, whatever name it wrote', () => {
    // Given a collector that hand builds a fact and names somebody else. The types cannot stop
    // it, so the registry restamps, because a fact that lies about its source is worse than one
    // that is missing: the UI shows provenance and drift is attributed by it.
    const liar = collectorOf('caslCollector', () => ({
      roles: { value: ['admin'], confidence: 'declared', collector: 'sourceCollector' },
    }));

    // When
    const result = registryOf([liar]).collect(targetOf());

    // Then
    expect(result?.roles?.collector).toBe('caslCollector');
  });

  it('should accumulate the list valued fields rather than let them compete', () => {
    // Given, three guards on a route are three facts and not one disagreement
    const guards = collectorOf('guardsCollector', () => ({
      guards: [
        { name: 'JwtAuthGuard', confidence: 'derived' as const, collector: 'guardsCollector' },
      ],
    }));
    const more = collectorOf('caslCollector', () => ({
      guards: [
        { name: 'PoliciesGuard', confidence: 'derived' as const, collector: 'caslCollector' },
      ],
    }));

    // When
    const result = registryOf([guards, more]).collect(targetOf());

    // Then
    expect(result?.guards?.map((guard) => guard.name)).toEqual(['JwtAuthGuard', 'PoliciesGuard']);
  });

  it('should drop a duplicate rather than double a list when a collector is registered twice', () => {
    // Given
    const guards = collectorOf('guardsCollector', () => ({
      guards: [
        { name: 'JwtAuthGuard', confidence: 'derived' as const, collector: 'guardsCollector' },
      ],
    }));

    // When
    const result = registryOf([guards, guards]).collect(targetOf());

    // Then
    expect(result?.guards).toHaveLength(1);
  });

  it('should return undefined when no collector had anything to say', () => {
    // Given, which is the ordinary case for a node no collector recognises
    const quiet = collectorOf('scopesCollector', () => undefined);

    // When
    const result = registryOf([quiet]).collect(targetOf());

    // Then
    expect(result).toBeUndefined();
  });
});

describe('CollectorRegistry, fail open', () => {
  it('should survive a collector that throws and keep the facts of the others', () => {
    // Given, a collector is an augmentation of a document that already renders, so it is fail
    // open where the normalizer is fail closed, per STANDARDS 8
    const broken = collectorOf('brokenCollector', () => {
      throw new Error('the optional package changed its shape');
    });
    const working = collectorOf('scopesCollector', (context) => ({
      scopes: context.fact(['orders:read'], 'declared'),
    }));

    // When
    const registry = registryOf([broken, working]);
    const result = registry.collect(targetOf());

    // Then the document is still produced, with everything the others found
    expect(result?.scopes?.value).toEqual(['orders:read']);
    expect(registry.meta().skipped?.[0]?.collector).toBe('brokenCollector');
    expect(registry.meta().skipped?.[0]?.reason).toContain(
      'the optional package changed its shape',
    );
  });

  it('should survive a collector that throws something that is not an Error', () => {
    // Given, because a thrown string is what a hand written collector does under pressure
    const broken = collectorOf('brokenCollector', () => {
      // A thrown string is what a hand written collector does under pressure, and the registry
      // has to survive one, so the case throws one on purpose.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'no reflector';
    });

    // When
    const registry = registryOf([broken]);
    registry.collect(targetOf());

    // Then
    expect(registry.meta().skipped?.[0]?.reason).toContain('no reflector');
  });

  it('should report a failing collector once and say how many nodes it did not see', () => {
    // Given a collector that throws on every node, and a pass over three of them. A report
    // carrying the same failure a thousand times is a report nobody reads.
    const broken = collectorOf('brokenCollector', () => {
      throw new Error('boom');
    });
    const collect = vi.spyOn(broken, 'collect');

    // When
    const registry = registryOf([broken]);
    for (const id of ['a', 'b', 'c']) registry.collect(targetOf(id));

    // Then it ran once, and the record says what was lost rather than only that something was
    expect(collect).toHaveBeenCalledTimes(1);
    expect(registry.meta().skipped).toEqual([
      {
        collector: 'brokenCollector',
        reason:
          'it threw while collecting: boom. It was retired, so 2 further node(s) were not seen by it',
      },
    ]);
  });

  it('should record a collector that declined to load, with the reason a reader needs', () => {
    // Given, the missing optional package of SPEC 6.2
    const declined = { name: 'throttlerCollector', skipped: '@nestjs/throttler is not installed' };

    // When
    const registry = registryOf([declined]);
    const result = registry.collect(targetOf());

    // Then the boot is unharmed and doctor can say why the panel is empty
    expect(result).toBeUndefined();
    expect(registry.meta().skipped).toEqual([
      { collector: 'throttlerCollector', reason: '@nestjs/throttler is not installed' },
    ]);
  });

  it('should drop an undefined registration without recording anything', () => {
    // Given, a conditional registration that chose not to say why
    const registry = registryOf([undefined]);

    // Then
    expect(registry.meta().collectors).toEqual([]);
    expect(registry.meta().skipped).toBeUndefined();
  });
});

describe('CollectorRegistry, what it reports', () => {
  it('should name every registration in order, including the ones that did not run', () => {
    // Given, `collectors` answers what was asked for and `skipped` answers what did not happen
    const registry = registryOf([
      collectorOf('sourceCollector', () => undefined),
      { name: 'throttlerCollector', skipped: 'not installed' },
      collectorOf('scopesCollector', () => undefined),
    ]);

    // Then
    expect(registry.meta().collectors).toEqual([
      'sourceCollector',
      'throttlerCollector',
      'scopesCollector',
    ]);
  });

  it('should carry the host supplied meta through to the document', () => {
    // Given
    const registry = new CollectorRegistry([], {
      reflector: { get: () => undefined, getAllAndOverride: () => undefined },
      moduleRef: { get: () => undefined },
      sourceLinkTemplate: 'https://host/org/repo/blob/{ref}/{file}#L{line}',
      nestVersion: '11.1.28',
      collectedAt: '2026-08-11T00:00:00.000Z',
    });

    // Then
    expect(registry.meta()).toEqual({
      collectors: [],
      collectedAt: '2026-08-11T00:00:00.000Z',
      nestVersion: '11.1.28',
      sourceLinkTemplate: 'https://host/org/repo/blob/{ref}/{file}#L{line}',
    });
  });

  it('should report a failure as a health check rather than as drift', () => {
    // Given, drift is a disagreement between the specification and the application, per SPEC
    // 7.1. A collector that threw is the instrument failing, not the two sides differing.
    const broken = collectorOf('brokenCollector', () => {
      throw new Error('boom');
    });
    const registry = registryOf([broken, collectorOf('scopesCollector', () => undefined)]);

    // When
    registry.collect(targetOf());

    // Then
    expect(registry.healthCheck()).toEqual({
      id: COLLECTOR_HEALTH_CHECK_ID,
      label: 'Runtime collectors that ran',
      passed: 1,
      total: 2,
      severity: 'warning',
    });
    expect(registry.collect(targetOf())?.drift).toBeUndefined();
  });

  it('should count every collector as passing when nothing went wrong', () => {
    // Given, and the number has to be the registered count rather than a constant
    const registry = registryOf([
      collectorOf('sourceCollector', () => undefined),
      collectorOf('scopesCollector', () => undefined),
    ]);

    // When
    registry.collect(targetOf());

    // Then
    expect(registry.healthCheck().passed).toBe(2);
    expect(registry.healthCheck().total).toBe(2);
  });
});

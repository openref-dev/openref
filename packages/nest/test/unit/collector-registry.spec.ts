import { RUNTIME_FACT_COLLECTORS, type IRNode, type IRNodeRuntime } from '@openref/core';
import { describe, expect, it, vi } from 'vitest';
import {
  CollectorRegistry,
  COLLECTOR_HEALTH_CHECK_ID,
  DECLARATIONS_COLLECTOR_NAME,
  ERRORS_COLLECTOR_NAME,
  GUARDS_COLLECTOR_NAME,
  HANDLER_SCAN_COLLECTOR_NAME,
  HEADERS_COLLECTOR_NAME,
  HTTP_CODE_COLLECTOR_NAME,
  PIPES_COLLECTOR_NAME,
  ROLES_COLLECTOR_NAME,
  SCOPES_COLLECTOR_NAME,
  SOURCE_COLLECTOR_NAME,
  STREAM_COLLECTOR_NAME,
  TIMEOUT_COLLECTOR_NAME,
} from '../../src/index';
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
    declaredOn: OrdersController,
    handler: function list(): void {
      /* the route handler, present so a collector has an identity to read metadata off */
    },
    handlerName: 'list',
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

  it('should say out loud that it broke a tie, naming both collectors and the field', () => {
    // Given the case a second shipped rate limit collector makes reachable for the first time:
    // two collectors, equal confidence, one field, and two different numbers
    const throttler = collectorOf('throttlerCollector', (context) => ({
      rateLimit: context.fact({ limit: 100, ttlMs: 60_000 }, 'derived'),
    }));
    const redisx = collectorOf('redisxRateLimitCollector', (context) => ({
      rateLimit: context.fact({ limit: 720, ttlMs: 60_000 }, 'derived'),
    }));
    const registry = registryOf([throttler, redisx]);

    // When
    const result = registry.collect(targetOf());
    const reported = registry.problems();

    // Then the rule is unchanged, the first registration still wins
    expect(result?.rateLimit?.value).toEqual({ limit: 100, ttlMs: 60_000 });
    expect(result?.rateLimit?.collector).toBe('throttlerCollector');

    // And the loser is no longer invisible, which is the half that was missing
    // And the loser is no longer invisible, which is the half that was missing. The three parts
    // are in three members since SPEC 7.1's voice: the cause is what a reader is shown first, the
    // action names both collectors so they can choose one, and the reasoning is what they open.
    const contest = reported.find((problem) => problem.reason.includes('rateLimit'));
    expect(contest?.subject).toBe('OrdersController.list');
    expect(contest?.reason).toContain('redisxRateLimitCollector was dropped');
    expect(contest?.action).toContain('throttlerCollector');
    expect(contest?.action).toContain('redisxRateLimitCollector');
    expect(contest?.action).toContain('the first registration wins');
    expect(contest?.detail).toContain('throttlerCollector is in the reference');
    expect(contest?.detail).toContain('"derived"');
  });

  it('should record one tie for a pair of collectors however many routes it happened on', () => {
    // Given the doctrine a retired collector already follows: a report carrying one finding a
    // thousand times is a report nobody reads
    const first = collectorOf('throttlerCollector', (context) => ({
      rateLimit: context.fact({ limit: 100, ttlMs: 60_000 }, 'derived'),
    }));
    const second = collectorOf('redisxRateLimitCollector', (context) => ({
      rateLimit: context.fact({ limit: 720, ttlMs: 60_000 }, 'derived'),
    }));
    const registry = registryOf([first, second]);

    // When three routes all tie
    registry.collect(targetOf('get-orders'));
    registry.collect(targetOf('get-order'));
    registry.collect(targetOf('post-order'));

    // Then
    expect(registry.problems()).toHaveLength(1);
    expect(registry.problems()[0]?.detail).toContain('2 further route(s)');
  });

  it('should record no tie when the two collectors disagree at different confidence', () => {
    // Given. That loss is explained by SPEC 6.1 and the winning fact carries the evidence, so
    // there is nothing a reader cannot already see.
    const declared = collectorOf('scopesCollector', (context) => ({
      scopes: context.fact(['orders:read'], 'declared'),
    }));
    const inferred = collectorOf('astCollector', (context) => ({
      scopes: context.fact(['guessed'], 'inferred'),
    }));
    const registry = registryOf([declared, inferred]);

    // When
    registry.collect(targetOf());

    // Then
    expect(registry.problems()).toEqual([]);
  });

  it('should record no tie when independent collectors touch different fields', () => {
    // Given
    const scopes = collectorOf('scopesCollector', (context) => ({
      scopes: context.fact(['orders:read'], 'derived'),
    }));
    const limits = collectorOf('throttlerCollector', (context) => ({
      rateLimit: context.fact({ limit: 100, ttlMs: 60_000 }, 'derived'),
    }));
    const registry = registryOf([scopes, limits]);

    // When
    registry.collect(targetOf());

    // Then
    expect(registry.problems()).toEqual([]);
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
        {
          name: 'JwtAuthGuard',
          scope: 'route',
          confidence: 'derived' as const,
          collector: 'guardsCollector',
        },
      ],
    }));
    const more = collectorOf('caslCollector', () => ({
      guards: [
        {
          name: 'PoliciesGuard',
          scope: 'route',
          confidence: 'derived' as const,
          collector: 'caslCollector',
        },
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
        {
          name: 'JwtAuthGuard',
          scope: 'route',
          confidence: 'derived' as const,
          collector: 'guardsCollector',
        },
      ],
    }));

    // When
    const result = registryOf([guards, guards]).collect(targetOf());

    // Then
    expect(result?.guards).toHaveLength(1);
  });

  it('should keep one class at two scopes as two facts, per SPEC 6.2.1', () => {
    // Given a class registered under `APP_GUARD` and also named in `@UseGuards` on this route.
    // These are two registrations and two decisions, and the deduplication key has to say so:
    // without the scope in it one of them is dropped, and the one that survives is whichever
    // arrived first, which answers "is it protected" while losing "did anyone decide it here".
    const guards = collectorOf('guardsCollector', () => ({
      guards: [
        {
          name: 'AuthGuard',
          scope: 'route' as const,
          confidence: 'derived' as const,
          collector: 'guardsCollector',
        },
        {
          name: 'AuthGuard',
          scope: 'global' as const,
          confidence: 'derived' as const,
          collector: 'guardsCollector',
        },
      ],
    }));

    // When
    const result = registryOf([guards]).collect(targetOf());

    // Then
    expect(result?.guards?.map((guard) => guard.scope)).toEqual(['route', 'global']);
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

/**
 * The channel a collector's own record of what it could not read finally travels down.
 *
 * WHAT WAS MEASURED BEFORE THIS EXISTED. Every collector in this repository and every one of the
 * four ecosystem packages keeps a `problems()` list, because CLAUDE.md requires an unobtainable fact
 * to produce a `doctor` warning rather than a guess. `grep -rn '\.problems()'` outside `test/`
 * returned zero hits: fifteen collectors were writing into an accumulator whose only reader was
 * their own unit tests, and a third party collector had no route into `doctor` at all.
 */
describe('CollectorRegistry, the problems a collector recorded', () => {
  it('should drain the problem list of a collector that keeps one', () => {
    // Given the shape every shipped collector uses, which is not on the frozen contract
    const collector = {
      name: 'timeoutCollector',
      collect: () => undefined,
      problems: () => [
        { subject: 'OrdersController.list', reason: 'it holds a timeout that is not a number' },
      ],
    };

    // When
    const registry = registryOf([collector]);
    registry.collect(targetOf());

    // Then, and the collector's name is in front, as it is for a skipped one
    expect(registry.problems()).toEqual([
      {
        subject: 'OrdersController.list',
        reason: 'timeoutCollector: it holds a timeout that is not a number',
      },
    ]);
  });

  it('should ask nothing of a collector that keeps no list', () => {
    // Given the contract as it is frozen: two members and no more
    const collector = collectorOf('scopesCollector', () => undefined);

    // When
    const registry = registryOf([collector]);
    registry.collect(targetOf());

    // Then
    expect(registry.problems()).toEqual([]);
  });

  it('should survive a problems() that throws, and say which collector it was', () => {
    // Given somebody else's code, running after the pass. Fail open, like everything else here.
    const collector = {
      name: 'thirdPartyCollector',
      collect: () => undefined,
      problems: () => {
        throw new Error('the accumulator was never initialised');
      },
    };

    // When
    const registry = registryOf([collector]);
    registry.collect(targetOf());

    // Then
    expect(registry.problems()[0]?.subject).toBe('thirdPartyCollector');
    expect(registry.problems()[0]?.reason).toContain('it threw when asked for the problems');
    expect(registry.problems()[0]?.action).toContain('a defect in the instrument');
    expect(registry.problems()[0]?.detail).toContain('the accumulator was never initialised');
  });

  it('should skip an entry that is not a pair of strings rather than printing an object', () => {
    // Given. `problems()` is not type checked by anything between that collector and this line,
    // and `[object Object]` in a doctor report would be this package's defect and not theirs.
    const collector = {
      name: 'thirdPartyCollector',
      collect: () => undefined,
      problems: () => [
        { subject: 'OrdersController.list', reason: { why: 'an object' } },
        { subject: '', reason: 'an empty subject names nothing' },
        null,
        { subject: 'OrdersController.list', reason: 'this one is well formed' },
      ],
    };

    // When
    const registry = registryOf([collector]);
    registry.collect(targetOf());

    // Then
    expect(registry.problems()).toEqual([
      {
        subject: 'OrdersController.list',
        reason: 'thirdPartyCollector: this one is well formed',
      },
    ]);
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
    const registry = registryOf([
      broken,
      collectorOf('scopesCollector', () => ({
        scopes: { value: ['orders:read'], confidence: 'declared', collector: 'scopesCollector' },
      })),
    ]);

    // When
    registry.collect(targetOf());

    // Then
    expect(registry.healthCheck()).toEqual({
      id: COLLECTOR_HEALTH_CHECK_ID,
      label: 'Runtime collectors that reported a fact',
      passed: 1,
      total: 2,
      severity: 'warning',
    });
    expect(registry.collect(targetOf())?.drift).toBeUndefined();
  });

  it('should count a collector that reported a fact about any node as passing', () => {
    // Given one collector with something to say and one that is reached and never has any
    const registry = registryOf([
      collectorOf('sourceCollector', () => ({
        source: { controller: 'OrdersController', handler: 'findAll' },
      })),
      collectorOf('scopesCollector', () => undefined),
    ]);

    // When
    registry.collect(targetOf());

    // Then
    expect(registry.healthCheck().passed).toBe(1);
    expect(registry.healthCheck().total).toBe(2);
  });

  it('should not count a collector that was reached on every node and reported nothing', () => {
    // Given two collectors, neither of which ever has anything to say, which is what a metadata
    // key that does not match looks like from here
    const registry = registryOf([
      collectorOf('sourceCollector', () => undefined),
      collectorOf('scopesCollector', () => undefined),
    ]);

    // When
    registry.collect(targetOf());
    registry.collect(targetOf());

    // Then, and this is the case the check answered `2 / 2` to until `TX-INSTRUMENT`: nothing
    // threw, nothing declined, and nothing was learned, and the only line about collectors a
    // reader of the health page sees said everything was fine.
    expect(registry.healthCheck().passed).toBe(0);
    expect(registry.healthCheck().total).toBe(2);
  });
});

/**
 * The names in `RUNTIME_FACT_COLLECTORS` are the names these collectors actually stamp.
 *
 * IT IS THE `publish-list` PROBLEM IN MINIATURE. `@openref/render` cannot import this package, so
 * the sentence "no registered collector reports a rate limit" is written against a table in
 * `@openref/core`. A table naming a collector nothing ships would offer a reader an instrument
 * that does not exist; a collector missing from it would make its row unable to suggest anything.
 * Two hand written lists that have to agree get something that makes them agree, and here that is
 * this case rather than a derivation, because the names are owned by four packages.
 */
describe('the collector names @openref/core names for each fact', () => {
  it('should name every collector this package ships, under the fact it reports', () => {
    // Given the constants each collector stamps on its own facts
    const shipped: Readonly<Record<string, string>> = {
      source: SOURCE_COLLECTOR_NAME,
      guards: GUARDS_COLLECTOR_NAME,
      pipes: PIPES_COLLECTOR_NAME,
      scopes: SCOPES_COLLECTOR_NAME,
      roles: ROLES_COLLECTOR_NAME,
      timeout: TIMEOUT_COLLECTOR_NAME,
      requiredHeaders: HEADERS_COLLECTOR_NAME,
      parameterReads: HANDLER_SCAN_COLLECTOR_NAME,
      statusCode: HTTP_CODE_COLLECTOR_NAME,
      errors: ERRORS_COLLECTOR_NAME,
      streaming: STREAM_COLLECTOR_NAME,
    };

    // When, Then
    for (const [field, name] of Object.entries(shipped)) {
      expect(
        RUNTIME_FACT_COLLECTORS[field as keyof typeof RUNTIME_FACT_COLLECTORS],
        `${name} is not named under ${field}`,
      ).toContain(name);
    }
  });

  it('should name declarationsCollector under the fact it reports', () => {
    // Given, it fills `scopes` from `@ApiScopes` and is the second instrument for that row
    // When, Then
    expect(RUNTIME_FACT_COLLECTORS.scopes).toContain(DECLARATIONS_COLLECTOR_NAME);
  });
});

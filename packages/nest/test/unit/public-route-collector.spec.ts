import { describe, expect, it } from 'vitest';
import type { IRConfidence, IRFact, IRNode } from '@openref/core';
import {
  publicRouteCollector,
  type PublicRouteCollector,
  type PublicRouteCollectorRegistration,
} from '../../src/runtime/infrastructure/collectors/public-route.collector';
import { isRuntimeCollector } from '../../src/runtime/application/ports/collector.port';
import type { CollectorContext } from '../../src/runtime/application/ports/collector.port';
import type { HandlerLike, ReflectorLike } from '../../src/shared/types/nest-surface';

/**
 * `publicRouteCollector`, held to the way the host's own guard reads the same key.
 *
 * THE CASE THIS FILE IS REALLY ABOUT IS THE MARK ON THE CONTROLLER CLASS. A guard written as
 * `reflector.getAllAndOverride(KEY, [context.getHandler(), context.getClass()])` treats a
 * `@Public()` on the controller as exempting every route in it, and that is the shape a host
 * reaches for when a whole controller is public. A collector that read the handler alone would
 * answer differently from the application it is describing, on exactly that shape, and every case
 * about the handler would still be green while it did.
 *
 * THE KEY IS THE HOST'S IN BOTH ITS FORMS. `IS_PUBLIC_KEY = 'isPublic'` is what the measured
 * application writes; a symbol is what `Reflector.createDecorator()` produces. Both are held here,
 * because a reading that only works for a string would fail on half the applications that have one.
 */

/** The key the measured application writes, verbatim. */
const IS_PUBLIC_KEY = 'isPublic';

/** The other shape a host's key comes in. */
const SYMBOL_KEY = Symbol('IS_PUBLIC');

class HealthController {
  getHealth(): undefined {
    return undefined;
  }
}

const getHealth: HandlerLike = function getHealth() {
  return undefined;
};

/** What one route carries under the key, on each of the two targets. */
interface Marks {
  /** What the handler itself carries, or nothing. */
  readonly handler?: unknown;
  /** What the controller class carries, or nothing. */
  readonly controller?: unknown;
}

/**
 * A reflector that reads the two targets the way Nest's own does.
 *
 * `getAllAndOverride` TAKES THE FIRST TARGET THAT HAS THE KEY SET, which is what makes a handler
 * level `false` beat a class level `true`. Modelling that rather than "the first truthy one" is
 * what lets the negative override case below be written at all.
 *
 * @param key - The key this reflector answers for
 * @param marks - What each target carries
 * @returns The reflector
 */
function reflectorOf(key: string | symbol, marks: Marks): ReflectorLike {
  const on = (target: unknown): unknown => {
    if (target === getHealth) return marks.handler;
    if (target === HealthController) return marks.controller;

    return undefined;
  };

  return {
    get(asked: unknown, target: unknown): unknown {
      return asked === key ? on(target) : undefined;
    },
    getAllAndOverride(asked: unknown, targets: readonly unknown[]): unknown {
      if (asked !== key) return undefined;

      for (const target of targets) {
        const held = on(target);
        if (held !== undefined) return held;
      }

      return undefined;
    },
  };
}

/**
 * A context over one route.
 *
 * @param key - The key the host named
 * @param marks - What each target carries under it
 * @returns The context the registry would build
 */
function contextOf(key: string | symbol, marks: Marks): CollectorContext {
  return {
    node: { id: 'health.getHealth' } as unknown as IRNode,
    controller: HealthController,
    declaredOn: HealthController,
    handler: getHealth,
    handlerName: 'getHealth',
    reflector: reflectorOf(key, marks),
    moduleRef: { get: () => undefined },
    globalGuards: ['JwtAuthGuard'],
    globalPipes: [],
    fact: <T>(value: T, confidence: IRConfidence): IRFact<T> => ({
      value,
      confidence,
      collector: 'publicRouteCollector',
    }),
  };
}

/**
 * Narrows a registration to the collector, failing loudly when it declined.
 *
 * @param registration - What the factory returned
 * @returns The collector
 */
function running(registration: PublicRouteCollectorRegistration): PublicRouteCollector {
  if (!isRuntimeCollector(registration)) throw new Error('the collector declined to run');

  return registration;
}

describe('publicRouteCollector, the mark on the handler', () => {
  it('should report the exemption at derived, naming the handler it was written on', () => {
    // Given `@Public()` on the handler, which is what all four of the measured routes carry
    const collector = running(publicRouteCollector({ metadataKey: IS_PUBLIC_KEY }));

    // When
    const produced = collector.collect(contextOf(IS_PUBLIC_KEY, { handler: true }));

    // Then the fact carries provenance like every other, per SPEC 6.1
    expect(produced?.guardExemption?.value).toEqual({ declaredOn: 'handler' });
    expect(produced?.guardExemption?.confidence).toBe('derived');
    expect(produced?.guardExemption?.collector).toBe('publicRouteCollector');
  });

  it('should report nothing for a route that carries no mark at all', () => {
    // Given the ordinary route of the same application, which is 54 of the measured 58
    const collector = running(publicRouteCollector({ metadataKey: IS_PUBLIC_KEY }));

    // When
    const produced = collector.collect(contextOf(IS_PUBLIC_KEY, {}));

    // Then, and nothing is recorded against the route either: an unmarked route is the ordinary
    // case and a warning on every one of them is the noise that empties a report
    expect(produced).toBeUndefined();
    expect(collector.problems().filter((problem) => problem.subject !== 'the application')).toEqual(
      [],
    );
  });
});

describe('publicRouteCollector, the mark on the controller class', () => {
  it('should exempt a route whose mark is on the class and say so', () => {
    // Given `@Public()` written on the controller, which the host's guard reads as exempting every
    // route in it because it asks `getAllAndOverride(KEY, [handler, class])`
    const collector = running(publicRouteCollector({ metadataKey: IS_PUBLIC_KEY }));

    // When
    const produced = collector.collect(contextOf(IS_PUBLIC_KEY, { controller: true }));

    // Then the route is exempt, and the fact says where a reader will find the decorator. A
    // collector reading the handler alone answers `undefined` here, which is the divergence from
    // the application's own behaviour this case exists to pin.
    expect(produced?.guardExemption?.value).toEqual({ declaredOn: 'controller' });
  });

  it('should let a handler mark override the class one, the way the guard does', () => {
    // Given a public controller with one route explicitly taken back out of it. The guard reads
    // the nearer declaration and gets `false`, so the route is guarded.
    const collector = running(publicRouteCollector({ metadataKey: IS_PUBLIC_KEY }));

    // When
    const produced = collector.collect(
      contextOf(IS_PUBLIC_KEY, { handler: false, controller: true }),
    );

    // Then nothing is exempted, because `if (isPublic)` is false for this route
    expect(produced).toBeUndefined();
  });
});

describe('publicRouteCollector, the key is the host and never this package', () => {
  it('should read a symbol key exactly as it reads a string one', () => {
    // Given the key `Reflector.createDecorator()` produces
    const collector = running(publicRouteCollector({ metadataKey: SYMBOL_KEY }));

    // When
    const produced = collector.collect(contextOf(SYMBOL_KEY, { handler: true }));

    // Then
    expect(produced?.guardExemption?.value).toEqual({ declaredOn: 'handler' });
  });

  it('should read nothing under a key the host did not name', () => {
    // Given a host whose key is a symbol and a route marked under the string one, which is what a
    // candidate list would have found and reported as this route's policy
    const collector = running(publicRouteCollector({ metadataKey: SYMBOL_KEY }));

    // When
    const produced = collector.collect(contextOf(IS_PUBLIC_KEY, { handler: true }));

    // Then
    expect(produced).toBeUndefined();
  });

  it('should decline to run at all when no usable key was given', () => {
    // Given the shape a missing constant takes after being imported from a module that does not
    // export it. Metadata under `''` is absent on every route, so a collector that ran would
    // exempt nobody and report a dead declaration for a key the host is certain they set.
    const registration = publicRouteCollector({ metadataKey: '' });

    // Then
    expect(isRuntimeCollector(registration)).toBe(false);
    expect(isRuntimeCollector(registration) ? '' : registration.skipped).toContain(
      'never guesses one',
    );
  });
});

describe('publicRouteCollector, what is not material for a fact', () => {
  it('should refuse a function under the key and record why, rather than exempting', () => {
    // Given a host whose decorator writes a predicate. What it answers is decided by calling it,
    // with a request this pass does not have, so a mark read off it would be a statement about
    // the route that nothing observed.
    const collector = running(publicRouteCollector({ metadataKey: IS_PUBLIC_KEY }));

    // When
    const produced = collector.collect(contextOf(IS_PUBLIC_KEY, { handler: () => true }));

    // Then no fact, and the reason reaches `doctor` rather than being dropped
    expect(produced).toBeUndefined();
    const problem = collector.problems()[0];
    expect(problem?.subject).toBe('HealthController.getHealth');
    expect(problem?.reason).toContain('is a function');
    expect(problem?.action).toContain('not a function that computes it');
  });

  it('should treat a falsy value as not exempt, because that is the test the guard applies', () => {
    // Given `SetMetadata(IS_PUBLIC_KEY, false)`, which the guard reads as `if (isPublic)` failing
    const collector = running(publicRouteCollector({ metadataKey: IS_PUBLIC_KEY }));

    // When
    const produced = collector.collect(contextOf(IS_PUBLIC_KEY, { handler: false }));

    // Then
    expect(produced).toBeUndefined();
  });
});

describe('publicRouteCollector, a declaration that matches nothing', () => {
  it('should assert a marked route is reported first, before any absence is claimed', () => {
    // Given, so the silence below is a silence and not an empty fixture
    const collector = running(publicRouteCollector({ metadataKey: IS_PUBLIC_KEY }));

    // When
    collector.collect(contextOf(IS_PUBLIC_KEY, { handler: true }));

    // Then the live declaration says nothing, because there is nothing to say
    expect(collector.problems()).toEqual([]);
  });

  it('should report a key that matched no route of the whole document', () => {
    // Given a host who mistyped their key, or moved it, and three routes none of which carries it
    const collector = running(publicRouteCollector({ metadataKey: IS_PUBLIC_KEY }));
    collector.collect(contextOf(IS_PUBLIC_KEY, {}));
    collector.collect(contextOf(IS_PUBLIC_KEY, {}));
    collector.collect(contextOf(IS_PUBLIC_KEY, {}));

    // When
    const problems = collector.problems();

    // Then it is reported rather than silently doing nothing, exactly as a suppression that
    // matched nothing is reported with `matched: 0` rather than refusing boot
    expect(problems).toHaveLength(1);
    expect(problems[0]?.subject).toBe('the application');
    expect(problems[0]?.reason).toContain('no route of 3');
    expect(problems[0]?.reason).toContain('"isPublic"');
    expect(problems[0]?.action).toContain('remove runtime.publicRouteKey');
  });

  it('should say nothing at all when it was asked about no route', () => {
    // Given a pass that reached this collector on nothing, where every sentence above is vacuously
    // true. A proof of absence over an empty list is not a measurement.
    const collector = running(publicRouteCollector({ metadataKey: IS_PUBLIC_KEY }));

    // When
    const problems = collector.problems();

    // Then
    expect(problems).toEqual([]);
  });
});

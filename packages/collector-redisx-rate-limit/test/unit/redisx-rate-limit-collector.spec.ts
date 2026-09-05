import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Controller, Post } from '@nestjs/common';
import { RateLimit, RATE_LIMIT_OPTIONS } from '@nestjs-redisx/rate-limit';
import { RUNTIME_FACT_COLLECTORS } from '@openref/core';
import type { IRConfidence, IRFact, IRNode } from '@openref/core';
import type { CollectorContext } from '@openref/nest';
import { isRuntimeCollector } from '@openref/nest';
import {
  MILLISECONDS_PER_SECOND,
  RATE_LIMIT_OPTIONS_KEY,
  RATE_LIMIT_PLUGIN_OPTIONS_KEY,
  REDISX_RATE_LIMIT_COLLECTOR_NAME,
  redisxRateLimitCollector,
  type MetadataValueReader,
  type RedisxRateLimitCollector,
  type RedisxRateLimitCollectorRegistration,
} from '../../src/index';

/**
 * `redisxRateLimitCollector`, checked against the real `@nestjs-redisx/rate-limit`.
 *
 * THE KEY AND THE STORED SHAPE ARE PINNED AGAINST THE INSTALLED PACKAGE RATHER THAN ASSERTED FROM
 * MEMORY. What this collector reads is that library's on-disk behaviour and not its documentation:
 * one `SetMetadata` under a global symbol, holding the decorator's options object verbatim with no
 * default merged into it. The first block below applies the real decorator and reads back what it
 * wrote, so a release that changed either would fail here rather than at a reader's screen.
 *
 * THE FIXTURE REPRODUCES THE DECORATOR SHAPE THE MOTIVATING APPLICATION USES, which is the one
 * static analysis cannot read: `points` is produced by a function call evaluated at decoration time,
 * and `key` is a function. So the case proves the two things together, that the resolved integer is
 * what lands in the reference, and that the bucket the integer is counted per is not read at all.
 */

/** Stands in for the deployment arithmetic the motivating application does at decoration time. */
function perNodePoints(total: number, nodes: number): number {
  return Math.floor(total / nodes);
}

/** Stands in for the node count the environment supplies. */
function resolveNodeCount(): number {
  return 1;
}

class WidgetsController {
  ingest(): undefined {
    return undefined;
  }
}
const ingest = function ingest(): undefined {
  return undefined;
};

/** A reader over a plain table, standing in for `Reflect` with `reflect-metadata` loaded. */
function readerOf(table: ReadonlyMap<unknown, unknown>): MetadataValueReader {
  return { get: (_key, target) => table.get(target) };
}

/** What the container answers with when nothing registered the plugin, measured on NestJS 11. */
class UnknownElementException extends Error {}

/**
 * A context over one route.
 *
 * @param over - The globally registered guards and what the plugin options provider holds
 * @returns The context
 */
function contextOf(
  over: { globalGuards?: readonly string[]; pluginOptions?: unknown } = {},
): CollectorContext {
  return {
    node: { id: 'widgets.ingest' } as unknown as IRNode,
    controller: WidgetsController,
    declaredOn: WidgetsController,
    handler: ingest,
    handlerName: 'ingest',
    reflector: { get: () => undefined, getAllAndOverride: () => undefined },
    moduleRef: {
      get: (token: unknown) => {
        if (token !== RATE_LIMIT_PLUGIN_OPTIONS_KEY || !('pluginOptions' in over)) {
          throw new UnknownElementException('nothing is registered under that token');
        }

        return over.pluginOptions;
      },
    },
    globalGuards: over.globalGuards ?? [],
    globalPipes: [],
    fact: <T>(value: T, confidence: IRConfidence): IRFact<T> => ({
      value,
      confidence,
      collector: REDISX_RATE_LIMIT_COLLECTOR_NAME,
    }),
  };
}

/**
 * Narrows a registration to the collector, failing loudly when it declined.
 *
 * @param registration - What the factory returned
 * @returns The collector
 */
function running(registration: RedisxRateLimitCollectorRegistration): RedisxRateLimitCollector {
  if (!isRuntimeCollector(registration)) throw new Error('the collector declined to run');

  return registration;
}

/** A collector over a metadata table, with the package reported as installed. */
function collectorOver(table: ReadonlyMap<unknown, unknown>): RedisxRateLimitCollector {
  return running(
    redisxRateLimitCollector({ resolvePackage: () => true, metadata: readerOf(table) }),
  );
}

/** A table holding one options object on the handler alone. */
function onHandler(options: unknown): ReadonlyMap<unknown, unknown> {
  return new Map<unknown, unknown>([[ingest, options]]);
}

describe('the metadata @nestjs-redisx/rate-limit writes', () => {
  it('should store the options object verbatim under the global symbol, with no defaults merged', () => {
    // Given the real decorator on a real controller, shaped like the motivating application's
    @Controller('widgets')
    class Widgets {
      @Post(':widgetId/data')
      @RateLimit({
        points: perNodePoints(720, resolveNodeCount()),
        duration: 60,
        key: (context) => `widget:${String(context.switchToHttp().getRequest())}`,
      })
      ingestData(): string {
        return 'ok';
      }
    }

    // When
    const handler = Object.getOwnPropertyDescriptor(Widgets.prototype, 'ingestData')?.value as
      object | undefined;
    expect(handler).toBeDefined();
    const stored = Reflect.getMetadata(RATE_LIMIT_OPTIONS, handler!) as Record<string, unknown>;

    // Then the key this collector asks for is the one the library wrote
    expect(RATE_LIMIT_OPTIONS_KEY).toBe(RATE_LIMIT_OPTIONS);
    expect(RATE_LIMIT_OPTIONS_KEY).toBe(Symbol.for('RATE_LIMIT_OPTIONS'));

    // And the value is the decorator's own object: the call was evaluated at decoration time, the
    // key is still a function, and nothing filled in a store or an algorithm
    expect(stored.points).toBe(720);
    expect(stored.duration).toBe(60);
    expect(typeof stored.key).toBe('function');
    expect(stored.store).toBeUndefined();
    expect(stored.algorithm).toBeUndefined();
  });
});

describe('redisxRateLimitCollector', () => {
  it('should report the resolved limit and window as a derived fact', () => {
    // Given the shape the motivating application uses: points from a call, key a function
    const collector = collectorOver(
      onHandler({
        points: perNodePoints(720, resolveNodeCount()),
        duration: 60,
        key: () => 'widget:1',
      }),
    );

    // When
    const produced = collector.collect(contextOf());

    // Then the reference carries the integer the call returned, in milliseconds
    expect(produced?.rateLimit?.value).toEqual({ limit: 720, ttlMs: 60_000 });
    expect(produced?.rateLimit?.confidence).toBe('derived');
    expect(produced?.rateLimit?.collector).toBe(REDISX_RATE_LIMIT_COLLECTOR_NAME);
  });

  it('should read duration as seconds and report milliseconds', () => {
    // Given the library's own unit, which is seconds, against IRRateLimit.ttlMs in milliseconds
    const collector = collectorOver(onHandler({ points: 10, duration: 300, store: 'redis' }));

    // When
    const produced = collector.collect(contextOf());

    // Then
    expect(produced?.rateLimit?.value.ttlMs).toBe(300 * MILLISECONDS_PER_SECOND);
    expect(produced?.rateLimit?.value.limit).toBe(10);
  });

  it('should let the handler override the class field by field, as the guard merges them', () => {
    // Given a class budget and a handler that names only the count. The library's guard spreads
    // `{ ...classOptions, ...handlerOptions }`, so the window is the class's and the count is the
    // handler's, and that is what the application enforces.
    const collector = collectorOver(
      new Map<unknown, unknown>([
        [WidgetsController, { points: 100, duration: 60 }],
        [ingest, { points: 9 }],
      ]),
    );

    // When
    const produced = collector.collect(contextOf());

    // Then
    expect(produced?.rateLimit?.value).toEqual({ limit: 9, ttlMs: 60_000 });
  });

  it('should carry a string key as the bucket name and read nothing else from it', () => {
    // Given a declared bucket name, which is metadata rather than logic
    const collector = collectorOver(onHandler({ points: 5, duration: 60, key: 'global' }));

    // When
    const produced = collector.collect(contextOf());

    // Then
    expect(produced?.rateLimit?.value).toEqual({ limit: 5, ttlMs: 60_000, name: 'global' });
    expect(collector.problems()).toEqual([]);
  });

  it('should say nothing about an undecorated route with no global guard over it', () => {
    // Given an application that limits only what it decorated. There the absence of metadata is
    // the absence of policy rather than unreadable policy, and a warning on every route of every
    // such application is the noise that makes a report unreadable.
    const collector = collectorOver(new Map());

    // When
    const produced = collector.collect(contextOf());

    // Then
    expect(produced).toBeUndefined();
    expect(collector.problems()).toEqual([]);
  });
});

/**
 * The fifty four routes that carry no decorator, which is where a confident wrong answer lived.
 *
 * THE SHAPE IS AN APPLICATION WHOSE LIMITER IS REGISTERED FOR THE WHOLE APPLICATION. Four routes of
 * fifty eight carry `@RateLimit`; the other fifty four are covered by a guard under `APP_GUARD` at a
 * budget configured on the module. A collector that read only route metadata reported four limits
 * and left fifty four operations reading as unlimited, which is worse than reporting nothing,
 * because the page's whole premise is that the application knows what the specification does not.
 */
describe('a route governed from outside itself', () => {
  it('should not report a rate limit it did not read from the route', () => {
    // Given an undecorated route behind a globally registered limiter, with a module budget
    const collector = collectorOver(new Map());

    // When
    const produced = collector.collect(
      contextOf({
        globalGuards: ['GlobalRateLimitGuard'],
        pluginOptions: { defaultPoints: 900, defaultDuration: 60 },
      }),
    );

    // Then the numbers exist and are on no node. Which routes the guard limits, and at what, is
    // written in its own code, and guard logic is never read.
    expect(produced).toBeUndefined();
  });

  it('should say the route is governed by something it cannot read, rather than nothing', () => {
    // Given
    const collector = collectorOver(new Map());

    // When
    collector.collect(
      contextOf({
        globalGuards: ['GlobalRateLimitGuard'],
        pluginOptions: { defaultPoints: 900, defaultDuration: 60 },
      }),
    );

    // Then the route's own record names the guard and refuses to attribute the budget to it
    const route = collector
      .problems()
      .find((problem) => problem.subject === 'WidgetsController.ingest');
    expect(route?.reason).toContain('GlobalRateLimitGuard');
    expect(route?.reason).toContain('never read');
    expect(route?.reason).toContain('900 request(s) per 60000 ms');
    expect(route?.reason).toContain('nothing observed says that guard applies it to this route');
  });

  it('should state the module budget once, as a fact about the application', () => {
    // Given three routes of the same application
    const collector = collectorOver(new Map());
    const over = {
      globalGuards: ['GlobalRateLimitGuard'],
      pluginOptions: { defaultPoints: 900, defaultDuration: 60 },
    };

    // When
    collector.collect(contextOf(over));
    collector.collect(contextOf(over));
    collector.collect(contextOf(over));

    // Then the module wide record is one record, by the precedent an unnameable APP_GUARD sets
    const application = collector
      .problems()
      .filter((problem) => problem.subject === 'the application');
    expect(application).toHaveLength(1);
    expect(application[0]?.reason).toContain('900 request(s) per 60000 ms');
    expect(application[0]?.reason).toContain('RATE_LIMIT_PLUGIN_OPTIONS');
    expect(application[0]?.reason).toContain('written onto no route');
  });

  it('should read the module budget from the provider, which was measured to be reachable', () => {
    // Given the registration the library makes: a `useValue` provider under the global symbol,
    // which it also names in `getExports()`. Measured on NestJS 11 against that exact shape:
    // `ModuleRef.get(token)` and `get(token, { strict: false })` both return the merged object,
    // whether the hosting module is @Global() or plainly imported.
    const collector = collectorOver(new Map());

    // When
    collector.collect(
      contextOf({
        globalGuards: ['GlobalRateLimitGuard'],
        pluginOptions: { defaultPoints: 100, defaultDuration: 60, store: 'redis' },
      }),
    );

    // Then
    expect(collector.problems()[0]?.reason).toContain('100 request(s) per 60000 ms');
  });

  it('should say plainly that no module budget was registered when there is none', () => {
    // Given a container that throws UnknownElementException, which is what NestJS answers when
    // nothing registered the token. It is the ordinary case and not a failure.
    const collector = collectorOver(new Map());

    // When
    collector.collect(contextOf({ globalGuards: ['GlobalRateLimitGuard'] }));

    // Then, and there is no application level record because there is no budget to state
    expect(collector.problems()).toHaveLength(1);
    expect(collector.problems()[0]?.subject).toBe('WidgetsController.ingest');
    expect(collector.problems()[0]?.reason).toContain('No module budget was registered');
  });

  it('should keep a decorated route a fact and not warn about the global guard on it', () => {
    // Given the four of fifty eight that declare their own budget. There is nothing unreadable
    // about them: the number came off the route.
    const collector = collectorOver(onHandler({ points: 720, duration: 60 }));

    // When
    const produced = collector.collect(
      contextOf({
        globalGuards: ['GlobalRateLimitGuard'],
        pluginOptions: { defaultPoints: 900, defaultDuration: 60 },
      }),
    );

    // Then
    expect(produced?.rateLimit?.value).toEqual({ limit: 720, ttlMs: 60_000 });
    expect(collector.problems().every((problem) => problem.subject === 'the application')).toBe(
      true,
    );
  });

  it('should ask the container once for the whole pass, not once per route', () => {
    // Given, because the answer is one provider value for the application and cannot change
    // between two nodes of one pass
    const collector = collectorOver(new Map());
    let asked = 0;
    const context: CollectorContext = {
      ...contextOf({ globalGuards: ['GlobalRateLimitGuard'] }),
      moduleRef: {
        get: () => {
          asked += 1;

          return { defaultPoints: 900, defaultDuration: 60 };
        },
      },
    };

    // When
    collector.collect(context);
    collector.collect(context);
    collector.collect(context);

    // Then
    expect(asked).toBe(1);
  });
});

describe('what the collector refuses to read, per SPEC 6.2.2', () => {
  it('should report the bucket scope as unread when the key is a function', () => {
    // Given the shape all four decorated sites of the motivating application use
    const collector = collectorOver(
      onHandler({ points: 720, duration: 60, key: () => 'widget:1' }),
    );

    // When
    collector.collect(contextOf());

    // Then the fact stands and the thing that cannot be read is named, not guessed
    const problem = collector.problems()[0];
    expect(problem?.subject).toBe('WidgetsController.ingest');
    expect(problem?.reason).toContain('key function');
    expect(problem?.reason).toContain('never');
  });

  it('should report a skip function rather than treating the limit as unconditional', () => {
    // Given
    const collector = collectorOver(onHandler({ points: 90, duration: 60, skip: () => false }));

    // When
    collector.collect(contextOf());

    // Then
    expect(collector.problems().some((problem) => problem.reason.includes('skip function'))).toBe(
      true,
    );
  });

  it('should report nothing and name the module provider when only one half is declared', () => {
    // Given a decorator that names points and no duration. The rest is resolved per request from
    // the module's own provider, which is configuration and not a fact about this route.
    const collector = collectorOver(onHandler({ points: 100 }));

    // When
    const produced = collector.collect(contextOf());

    // Then
    expect(produced).toBeUndefined();
    expect(collector.problems()[0]?.reason).toContain('points and no duration');
    expect(collector.problems()[0]?.reason).toContain('RATE_LIMIT_PLUGIN_OPTIONS');
  });

  it('should report nothing when the decorator names neither half', () => {
    // Given `@RateLimit({ store: 'redis' })`, whose whole budget is module configuration
    const collector = collectorOver(onHandler({ store: 'redis' }));

    // When
    const produced = collector.collect(contextOf());

    // Then
    expect(produced).toBeUndefined();
    expect(collector.problems()[0]?.reason).toContain('neither points nor duration');
  });

  it('should report nothing for a token bucket, whose points is a capacity and not a count', () => {
    // Given. Under this algorithm the sustained rate is a refill per second and there is no window,
    // so `{ limit, ttlMs }` would describe something the route does not enforce.
    const collector = collectorOver(
      onHandler({ points: 20, duration: 60, algorithm: 'token-bucket' }),
    );

    // When
    const produced = collector.collect(contextOf());

    // Then
    expect(produced).toBeUndefined();
    expect(collector.problems()[0]?.reason).toContain('bucket capacity');
  });

  it('should qualify a memory store limit as per instance and still report it', () => {
    // Given a store that counts in one process. The number is true of one node, and what it is not
    // true of is the deployment, whose instance count is runtime state.
    const collector = collectorOver(onHandler({ points: 720, duration: 60, store: 'memory' }));

    // When
    const produced = collector.collect(contextOf());

    // Then
    expect(produced?.rateLimit?.value).toEqual({ limit: 720, ttlMs: 60_000 });
    expect(collector.problems()[0]?.reason).toContain('one instance');
    expect(collector.problems()[0]?.reason).toContain('instance count is runtime state');
  });

  it('should refuse a points value that is not a positive finite number', () => {
    // Given
    const collector = collectorOver(onHandler({ points: Number.NaN, duration: 60 }));

    // When
    const produced = collector.collect(contextOf());

    // Then
    expect(produced).toBeUndefined();
    expect(collector.problems()[0]?.reason).toContain('duration and no points');
  });
});

describe('the four decorated sites of the motivating application', () => {
  it.each([
    ['widget data', { points: 720, duration: 60, key: () => 'w' }, 720, 60_000],
    ['auth verify', { points: 90, duration: 60, key: () => 'a' }, 90, 60_000],
    ['dev login', { points: 10, duration: 300, store: 'redis', key: () => 'l' }, 10, 300_000],
    ['admin reset-all', { points: 9, duration: 60, store: 'redis', key: () => 'r' }, 9, 60_000],
  ])(
    'should report %s at the limit and window the decorator resolved',
    (_name, options, limit, ttlMs) => {
      // Given
      const collector = collectorOver(onHandler(options));

      // When
      const produced = collector.collect(contextOf());

      // Then
      expect(produced?.rateLimit?.value).toEqual({ limit, ttlMs });
      expect(produced?.rateLimit?.confidence).toBe('derived');
      expect(produced?.rateLimit?.collector).toBe(REDISX_RATE_LIMIT_COLLECTOR_NAME);
    },
  );
});

describe('the package resolution guard', () => {
  it('should skip rather than fail the build when the library is not installed', () => {
    // Given the case SPEC 6.2 names: the optional package is absent in the consumer's project
    const registration = redisxRateLimitCollector({ resolvePackage: () => false });

    // When, Then
    expect(isRuntimeCollector(registration)).toBe(false);
    expect(registration.name).toBe(REDISX_RATE_LIMIT_COLLECTOR_NAME);
    expect('skipped' in registration ? registration.skipped : '').toContain('not installed');
  });

  it('should not read the global symbol when the library that writes it is absent', () => {
    // Given. `Symbol.for("RATE_LIMIT_OPTIONS")` reaches the global registry, so the key resolves in
    // any process; the name is generic enough that a second library could store its own object
    // under it, and reading that as this library's would put somebody else's configuration into the
    // reference at `derived` confidence with this collector's name on it.
    const foreign = new Map<unknown, unknown>([[ingest, { points: 1, duration: 1 }]]);

    // When the package is absent, the metadata is never asked for at all
    const registration = redisxRateLimitCollector({
      resolvePackage: () => false,
      metadata: readerOf(foreign),
    });

    // Then
    expect(isRuntimeCollector(registration)).toBe(false);
  });

  it('should resolve the installed copy when no seam is given', () => {
    // Given this repository, which has @nestjs-redisx/rate-limit as a devDependency of this
    // package. The resolution is of the entry point and not of the manifest: this library's
    // `exports` map declares only ".", so `@nestjs-redisx/rate-limit/package.json` throws
    // ERR_PACKAGE_PATH_NOT_EXPORTED on a working installation. `resolve` evaluates nothing.
    const registration = redisxRateLimitCollector();

    // When, Then
    expect(isRuntimeCollector(registration)).toBe(true);
  });

  it('should read the real decorator through the real Reflect, with no seam at all', () => {
    // Given the whole path a host actually runs: the library's own decorator writes the metadata,
    // the collector resolves the installed package, and the default reader goes to `Reflect`.
    // Every case above injects both, so without this one the shipped reader is never executed.
    @Controller('widgets')
    class Widgets {
      @Post(':widgetId/data')
      @RateLimit({ points: perNodePoints(720, resolveNodeCount()), duration: 60, key: () => 'w' })
      ingestData(): string {
        return 'ok';
      }
    }
    const handler = Object.getOwnPropertyDescriptor(Widgets.prototype, 'ingestData')?.value as
      (() => string) | undefined;
    expect(handler).toBeDefined();

    // When
    const collector = running(redisxRateLimitCollector());
    const produced = collector.collect({
      ...contextOf(),
      controller: Widgets,
      declaredOn: Widgets,
      handler: handler as () => string,
      handlerName: 'ingestData',
    });

    // Then
    expect(produced?.rateLimit?.value).toEqual({ limit: 720, ttlMs: 60_000 });
    expect(produced?.rateLimit?.confidence).toBe('derived');
    expect(collector.problems()[0]?.reason).toContain('key function');
  });

  it('should skip when the runtime offers no metadata reflection', () => {
    // Given a runtime without `reflect-metadata`, which means this is not a NestJS application
    const reflect = Reflect as unknown as { getMetadata?: unknown };
    const held = reflect.getMetadata;
    delete reflect.getMetadata;

    try {
      // When
      const registration = redisxRateLimitCollector({ resolvePackage: () => true });

      // Then
      expect(isRuntimeCollector(registration)).toBe(false);
      expect('skipped' in registration ? registration.skipped : '').toContain('reflect-metadata');
    } finally {
      reflect.getMetadata = held;
    }
  });
});

/**
 * The name this collector stamps is the name `@openref/core` names for its fact.
 *
 * IT IS ASSERTED HERE BECAUSE THE TWO LISTS LIVE IN TWO PACKAGES. `@openref/render` writes the
 * sentence "no registered collector reports X" against a table in `core`, and cannot import this
 * package to check it. A name that drifted would offer a reader an instrument that does not exist.
 */
describe('the name `@openref/core` names for this fact', () => {
  it('should be the name this collector stamps', () => {
    // Given, the subject is present: core names something for the fact
    expect(RUNTIME_FACT_COLLECTORS.rateLimit.length).toBeGreaterThan(0);

    // When, Then
    expect(RUNTIME_FACT_COLLECTORS.rateLimit).toContain(REDISX_RATE_LIMIT_COLLECTOR_NAME);
  });

  it('should be the second name under one fact, which is what makes a tie reachable', () => {
    // Given, this is the first fact field two shipped collectors can both produce
    expect(RUNTIME_FACT_COLLECTORS.rateLimit).toEqual([
      'throttlerCollector',
      REDISX_RATE_LIMIT_COLLECTOR_NAME,
    ]);
  });
});

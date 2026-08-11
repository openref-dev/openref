import { describe, expect, it } from 'vitest';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { IRConfidence, IRFact, IRNode } from '@openref/core';
import type { CollectorContext } from '@openref/nest';
import { isRuntimeCollector } from '@openref/nest';
import {
  MILLISECOND_TTL_FROM_MAJOR,
  THROTTLER_COLLECTOR_NAME,
  THROTTLER_KEY_PREFIXES,
  throttlerCollector,
  type MetadataReader,
  type ThrottlerCollector,
  type ThrottlerCollectorRegistration,
} from '../../src/index';

/**
 * `throttlerCollector`, checked against the real `@nestjs/throttler` where it can be.
 *
 * THE KEY FORMAT IS PINNED AGAINST THE INSTALLED PACKAGE AND NOT ASSERTED FROM MEMORY. The three
 * prefixes are that package's on-disk format rather than its documentation, which is the same
 * class of coupling `nest-value-surface.spec.ts` handles the same way: the real decorator is
 * applied and the keys it produced are read back.
 *
 * THE UNIT IS TESTED THROUGH A SEAM BECAUSE ONE INSTALL CANNOT BE TWO VERSIONS. Whether `ttl` is
 * seconds or milliseconds is the one thing that would make every rate limit in a reference wrong
 * by a factor of a thousand, and it cannot be reached by installing a copy: this repository has
 * one, and it is 6.x.
 */

class OrdersController {
  list(): undefined {
    return undefined;
  }
}
const list = function list(): undefined {
  return undefined;
};

/** A reader over a plain table, standing in for `Reflect` with `reflect-metadata` loaded. */
function readerOf(table: ReadonlyMap<unknown, ReadonlyMap<string, unknown>>): MetadataReader {
  return {
    keys: (target) => [...(table.get(target)?.keys() ?? [])],
    get: (key, target) => table.get(target)?.get(String(key)),
  };
}

/** A context over one route. */
function contextOf(): CollectorContext {
  return {
    node: { id: 'orders.list' } as unknown as IRNode,
    controller: OrdersController,
    declaredOn: OrdersController,
    handler: list,
    handlerName: 'list',
    reflector: { get: () => undefined, getAllAndOverride: () => undefined },
    moduleRef: { get: () => undefined },
    fact: <T>(value: T, confidence: IRConfidence): IRFact<T> => ({
      value,
      confidence,
      collector: THROTTLER_COLLECTOR_NAME,
    }),
  };
}

/**
 * Narrows a registration to the collector, failing loudly when it declined.
 *
 * @param registration - What the factory returned
 * @returns The collector
 */
function running(registration: ThrottlerCollectorRegistration): ThrottlerCollector {
  if (!isRuntimeCollector(registration)) throw new Error('the collector declined to run');

  return registration;
}

/** A collector over a metadata table, on a version whose ttl is already milliseconds. */
function collectorOver(
  table: ReadonlyMap<unknown, ReadonlyMap<string, unknown>>,
  version = '6.4.0',
): ThrottlerCollector {
  return running(throttlerCollector({ resolveVersion: () => version, metadata: readerOf(table) }));
}

describe('the metadata keys @nestjs/throttler writes', () => {
  it('should carry the throttler name in the key, which is why they are enumerated', () => {
    // Given the real decorator on a real controller
    @Controller('orders')
    @UseGuards(
      class ThrottlerGuard {
        canActivate(): boolean {
          return true;
        }
      },
    )
    class Orders {
      @Get()
      @Throttle({ short: { limit: 3, ttl: 60_000 } })
      list(): string {
        return 'all';
      }
    }

    // When
    const handler = Object.getOwnPropertyDescriptor(Orders.prototype, 'list')?.value as object;
    const keys = Reflect.getMetadataKeys(handler) as string[];

    // Then, there is no fixed key to ask a reflector for, which is the whole finding
    expect(keys).toContain(`${THROTTLER_KEY_PREFIXES.limit}short`);
    expect(keys).toContain(`${THROTTLER_KEY_PREFIXES.ttl}short`);
    expect(Reflect.getMetadata(`${THROTTLER_KEY_PREFIXES.limit}short`, handler)).toBe(3);
    expect(Reflect.getMetadata(`${THROTTLER_KEY_PREFIXES.ttl}short`, handler)).toBe(60_000);
  });

  it('should write the skip key the collector honours', () => {
    // Given
    class Orders {
      list(): string {
        return 'all';
      }
    }
    const descriptor = Object.getOwnPropertyDescriptor(Orders.prototype, 'list');
    SkipThrottle()(Orders.prototype, 'list', descriptor!);

    // When
    const keys = Reflect.getMetadataKeys(descriptor?.value as object) as string[];

    // Then
    expect(keys.some((key) => key.startsWith(THROTTLER_KEY_PREFIXES.skip))).toBe(true);
  });
});

describe('throttlerCollector', () => {
  it('should report limit and ttl as a derived fact', () => {
    // Given a route carrying both halves of one named throttler
    const collector = collectorOver(
      new Map([
        [
          list,
          new Map<string, unknown>([
            [`${THROTTLER_KEY_PREFIXES.limit}default`, 3],
            [`${THROTTLER_KEY_PREFIXES.ttl}default`, 60_000],
          ]),
        ],
      ]),
    );

    // When
    const produced = collector.collect(contextOf());

    // Then
    expect(produced?.rateLimit?.value).toEqual({ limit: 3, ttlMs: 60_000, name: 'default' });
    expect(produced?.rateLimit?.confidence).toBe('derived');
    expect(produced?.rateLimit?.collector).toBe(THROTTLER_COLLECTOR_NAME);
  });

  it('should multiply a ttl taken from a version that counts in seconds', () => {
    // Given the release before the unit changed, which is the one thing a seam is needed for
    const collector = collectorOver(
      new Map([
        [
          list,
          new Map<string, unknown>([
            [`${THROTTLER_KEY_PREFIXES.limit}default`, 3],
            [`${THROTTLER_KEY_PREFIXES.ttl}default`, 60],
          ]),
        ],
      ]),
      `${String(MILLISECOND_TTL_FROM_MAJOR - 1)}.2.1`,
    );

    // When
    const produced = collector.collect(contextOf());

    // Then
    expect(produced?.rateLimit?.value.ttlMs).toBe(60_000);
  });

  it('should let a handler override the controller for the same throttler name', () => {
    // Given both levels declaring "default", which is what NestJS enforces as an override
    const collector = collectorOver(
      new Map<unknown, ReadonlyMap<string, unknown>>([
        [
          OrdersController,
          new Map<string, unknown>([
            [`${THROTTLER_KEY_PREFIXES.limit}default`, 100],
            [`${THROTTLER_KEY_PREFIXES.ttl}default`, 60_000],
          ]),
        ],
        [list, new Map<string, unknown>([[`${THROTTLER_KEY_PREFIXES.limit}default`, 3]])],
      ]),
    );

    // When
    const produced = collector.collect(contextOf());

    // Then
    expect(produced?.rateLimit?.value).toEqual({ limit: 3, ttlMs: 60_000, name: 'default' });
  });

  it('should report nothing for a throttler the route skips', () => {
    // Given `@SkipThrottle()`, which means this route has no rate limit to report
    const collector = collectorOver(
      new Map([
        [
          list,
          new Map<string, unknown>([
            [`${THROTTLER_KEY_PREFIXES.limit}default`, 3],
            [`${THROTTLER_KEY_PREFIXES.ttl}default`, 60_000],
            [`${THROTTLER_KEY_PREFIXES.skip}default`, true],
          ]),
        ],
      ]),
    );

    // When
    const produced = collector.collect(contextOf());

    // Then
    expect(produced).toBeUndefined();
  });

  it('should report nothing and say so when only one half is declared', () => {
    // Given a limit with no ttl, which is not a rate limit anything can be said about
    const collector = collectorOver(
      new Map([[list, new Map<string, unknown>([[`${THROTTLER_KEY_PREFIXES.limit}default`, 3]])]]),
    );

    // When
    const produced = collector.collect(contextOf());

    // Then
    expect(produced).toBeUndefined();
    expect(collector.problems()[0]?.reason).toContain('no ttl');
  });

  it('should record the throttlers it could not carry when several apply', () => {
    // Given two named throttlers on one route, against one IRRateLimit field
    const collector = collectorOver(
      new Map([
        [
          list,
          new Map<string, unknown>([
            [`${THROTTLER_KEY_PREFIXES.limit}short`, 3],
            [`${THROTTLER_KEY_PREFIXES.ttl}short`, 1_000],
            [`${THROTTLER_KEY_PREFIXES.limit}long`, 100],
            [`${THROTTLER_KEY_PREFIXES.ttl}long`, 60_000],
          ]),
        ],
      ]),
    );

    // When
    const produced = collector.collect(contextOf());

    // Then
    expect(produced?.rateLimit?.value.name).toBe('short');
    expect(collector.problems()[0]?.reason).toContain('"long"');
  });

  it('should skip rather than fail the build when the package is not installed', () => {
    // Given the case SPEC 6.2 names: the optional package is absent in the consumer's project
    const registration = throttlerCollector({ resolveVersion: () => undefined });

    // When, Then
    expect(isRuntimeCollector(registration)).toBe(false);
    expect(registration.name).toBe(THROTTLER_COLLECTOR_NAME);
    expect('skipped' in registration ? registration.skipped : '').toContain('not installed');
  });

  it('should refuse a version it cannot read a unit from, rather than assuming one', () => {
    // Given. A number whose unit is unknown is not a fact, and the two candidate units differ by
    // a factor of a thousand.
    const registration = throttlerCollector({ resolveVersion: () => 'next' });

    // When, Then
    expect(isRuntimeCollector(registration)).toBe(false);
    expect('skipped' in registration ? registration.skipped : '').toContain('unit');
  });

  it('should resolve the installed copy when no seam is given', () => {
    // Given this repository, which has @nestjs/throttler as a devDependency of this package
    const registration = throttlerCollector();

    // When, Then
    expect(isRuntimeCollector(registration)).toBe(true);
  });
});

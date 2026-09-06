import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Injectable } from '@nestjs/common';
import { LockAcquisitionError, WithLock } from '@nestjs-redisx/locks';
import type { IRConfidence, IRFact, IRHandlerPolicy, IRNode } from '@openref/core';
import type { CollectorContext } from '@openref/nest';
import { isRuntimeCollector } from '@openref/nest';
import {
  PACKAGE_NAME,
  REDISX_LOCK_COLLECTOR_NAME,
  redisxLockCollector,
  WITH_LOCK_OPTIONS_KEY,
  type MetadataValueReader,
  type RedisxLockCollector,
  type RedisxLockCollectorRegistration,
} from '../../src/index';

/**
 * `redisxLockCollector`, checked against the real `@nestjs-redisx/locks`.
 *
 * THE ABSENT STATUS IS THE CLAIM THIS SUITE HAS TO HOLD. This collector reports a lock and reports
 * that no HTTP status follows from it, and that second half rests entirely on the library carrying
 * no exception filter and no `HttpException`. A release that added one would make the doctor record
 * wrong in the direction that matters, telling a reader to declare a status the library now
 * produces itself, so it is read off the shipped source rather than remembered.
 */

class OrdersController {
  place(): undefined {
    return undefined;
  }
}
const place = function place(): undefined {
  return undefined;
};

/** A reader over a plain table, standing in for `Reflect` with `reflect-metadata` loaded. */
function readerOf(table: ReadonlyMap<unknown, unknown>): MetadataValueReader {
  return { get: (_key, target) => table.get(target) };
}

/**
 * A context over one route.
 *
 * @returns The context
 */
function contextOf(): CollectorContext {
  return {
    node: { id: 'orders.place' } as unknown as IRNode,
    controller: OrdersController,
    declaredOn: OrdersController,
    handler: place,
    handlerName: 'place',
    reflector: { get: () => undefined, getAllAndOverride: () => undefined },
    moduleRef: {
      get: () => {
        throw new Error('nothing is registered under that token');
      },
    },
    globalGuards: [],
    globalPipes: [],
    fact: <T>(value: T, confidence: IRConfidence): IRFact<T> => ({
      value,
      confidence,
      collector: REDISX_LOCK_COLLECTOR_NAME,
    }),
  };
}

/**
 * Narrows a registration to the collector, failing loudly when it declined.
 *
 * @param registration - What the factory returned
 * @returns The collector
 */
function running(registration: RedisxLockCollectorRegistration): RedisxLockCollector {
  if (!isRuntimeCollector(registration)) throw new Error('the collector declined to run');

  return registration;
}

/** A collector over a metadata table, with the package reported as installed. */
function collectorOver(table: ReadonlyMap<unknown, unknown>): RedisxLockCollector {
  return running(redisxLockCollector({ resolvePackage: () => true, metadata: readerOf(table) }));
}

/** A table holding one options object on the handler alone. */
function onHandler(options: unknown): ReadonlyMap<unknown, unknown> {
  return new Map<unknown, unknown>([[place, options]]);
}

/**
 * The policies of one node.
 *
 * @param collector - The collector under test
 * @returns The policies, or an empty list when the collector said nothing
 */
function policiesOf(collector: RedisxLockCollector): readonly IRHandlerPolicy[] {
  return collector.collect(contextOf())?.handlerPolicies ?? [];
}

/**
 * One method off a class, as an unbound value.
 *
 * `Object.getOwnPropertyDescriptor` AND NOT `Class.prototype.method`, which is how the redisx
 * collectors beside this one reach the same thing, and it matters here because `@WithLock` REPLACES
 * the descriptor's value and writes its metadata onto the replacement.
 *
 * @param target - The class
 * @param name - The method name
 * @returns The function the prototype holds
 */
function methodOf(target: new (...args: never[]) => unknown, name: string): object {
  const handler = Object.getOwnPropertyDescriptor(target.prototype, name)?.value as
    object | undefined;
  if (handler === undefined) throw new Error(`${target.name} has no ${name}`);

  return handler;
}

/** Every module the installed copy ships, as one string. */
function shippedSource(): string {
  const entry = createRequire(import.meta.url).resolve('@nestjs-redisx/locks');
  const walk = (path: string): string[] => {
    if (!statSync(path).isDirectory()) return /\.(?:js|cjs|mjs)$/.test(path) ? [path] : [];

    return readdirSync(path).flatMap((name) => walk(join(path, name)));
  };

  return walk(dirname(entry))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}

describe('the metadata @nestjs-redisx/locks writes', () => {
  it('should store the decorator options on the wrapper under the symbol this collector asks for', () => {
    // Given the real decorator on a real method
    class RealController {
      @WithLock({ key: 'order:{0}', ttl: 60_000, waitTimeout: 5000, autoRenew: true })
      place(): Promise<undefined> {
        return Promise.resolve(undefined);
      }
    }

    // When the key is read off the handler the way NestJS routes it
    const stored: unknown = Reflect.getMetadata(
      WITH_LOCK_OPTIONS_KEY,
      methodOf(RealController, 'place'),
    );

    // Then the global symbol names the library's own key with no import of it, and the value is
    // the options object verbatim with no default merged into it
    expect(stored).toEqual({
      key: 'order:{0}',
      ttl: 60_000,
      waitTimeout: 5000,
      autoRenew: true,
    });
  });

  it('should map its acquisition failure to no HTTP status anywhere it ships', () => {
    // Given the error asserted present first: this is a proof of absence and an empty search would
    // otherwise pass as one. It is the whole basis for reporting no error contract.
    expect(typeof LockAcquisitionError).toBe('function');
    expect(new LockAcquisitionError('k', 'timeout')).toBeInstanceOf(Error);

    // When every shipped module of the installed copy is read
    const shipped = shippedSource();

    // Then no filter, no HttpException and no HttpStatus, so the code a losing caller sees is the
    // host's and this collector reports none
    expect(shipped).toContain('LockAcquisitionError');
    expect(shipped).not.toMatch(/\bExceptionFilter\b/);
    expect(shipped).not.toMatch(/\bHttpException\b/);
    expect(shipped).not.toMatch(/\bHttpStatus\b/);
  });
});

describe('redisxLockCollector', () => {
  it('should say nothing at all about a route that carries no lock', () => {
    // Given a route the library does not touch
    const collector = collectorOver(new Map<unknown, unknown>());

    // When
    const found = collector.collect(contextOf());

    // Then, because a present and empty list would claim this route was examined and is not locked,
    // which this collector cannot tell from an application that never installed the plugin
    expect(found).toBeUndefined();
    expect(collector.problems()).toEqual([]);
  });

  it('should report the key, both windows and the failure behaviour of a locked route', () => {
    // Given a fully declared lock. EVERY DURATION IS ALREADY MILLISECONDS HERE and is seconds in
    // @Cached next door, which is why the settings carry the unit in their names.
    const collector = collectorOver(
      onHandler({ key: 'order:{0}', ttl: 60_000, waitTimeout: 5000, autoRenew: true }),
    );

    // When
    const policies = policiesOf(collector);

    // Then
    expect(policies).toEqual([
      {
        kind: 'lock',
        key: 'order:{0}',
        settings: [
          { name: 'ttlMs', value: 60_000 },
          { name: 'waitTimeoutMs', value: 5000 },
          { name: 'autoRenew', value: true },
          { name: 'onFailure', value: 'throw' },
        ],
        reach: 'handler',
        confidence: 'derived',
        collector: REDISX_LOCK_COLLECTOR_NAME,
      },
    ]);
  });

  it('should default the failure behaviour to throw, which is the library resolution order', () => {
    // Given a lock that names nothing but its key
    const collector = collectorOver(onHandler({ key: 'sync' }));

    // When
    const settings = policiesOf(collector)[0]?.settings ?? [];

    // Then `handleLockFailed` resolves `options.onLockFailed ?? 'throw'`, read off the source
    expect(settings).toEqual([{ name: 'onFailure', value: 'throw' }]);
  });

  it('should tell a custom error factory apart from the default throw', () => {
    // Given a lock whose failure produces a host error this cannot name
    const collector = collectorOver(onHandler({ key: 'sync', onLockFailed: () => new Error('x') }));

    // When
    const settings = policiesOf(collector)[0]?.settings ?? [];

    // Then it is not folded into `throw`, because what a caller receives under it is different
    expect(settings).toContainEqual({ name: 'onFailure', value: 'custom-error' });
  });
});

describe('what cannot be tied to a served response', () => {
  it('should say the losing caller has no known status, and name the action', () => {
    // Given the ordinary lock, whose loser gets a plain Error subclass
    const collector = collectorOver(onHandler({ key: 'order:{0}', waitTimeout: 5000 }));

    // When
    const policies = policiesOf(collector);

    // Then the lock is reported, and the missing status is a record rather than a withheld fact
    expect(policies).toHaveLength(1);
    expect(collector.problems()).toEqual([
      {
        subject: 'OrdersController.place',
        reason: 'a caller that loses the race gets LockAcquisitionError, whose status is not known',
        action: 'declare the status your exception filter maps it to with @ApiErrors on this route',
        detail: expect.stringContaining('no exception filter'),
      },
    ]);
  });

  it('should report no error contract at all, which is what an invented status would be', () => {
    // Given the same lock
    const collector = collectorOver(onHandler({ key: 'order:{0}' }));

    // When
    const found = collector.collect(contextOf());

    // Then the subject is asserted present first, so an empty reading cannot pass as a clean one
    expect(found?.handlerPolicies).toHaveLength(1);
    expect(found?.errors).toBeUndefined();
  });

  it('should say a skipped caller can be answered with nothing at all', () => {
    // Given a lock that skips rather than refusing
    const collector = collectorOver(onHandler({ key: 'sync', onLockFailed: 'skip' }));

    // When
    const settings = policiesOf(collector)[0]?.settings ?? [];

    // Then the behaviour is on the row and the empty body is in the record, and the throw record
    // is NOT also written, because only one of the two can happen on one route
    expect(settings).toContainEqual({ name: 'onFailure', value: 'skip' });
    expect(collector.problems()).toEqual([
      {
        subject: 'OrdersController.place',
        reason:
          'a caller that loses the race is skipped, so this route can answer with no body at all',
        action:
          'document the empty response, or use the default onLockFailed if a caller should be refused',
        detail: expect.stringContaining('returns undefined'),
      },
    ]);
  });

  it('should record a key function rather than naming a scope nobody wrote', () => {
    // Given a lock whose scope comes from code
    const collector = collectorOver(onHandler({ key: () => 'order:1' }));

    // When
    const policies = policiesOf(collector);

    // Then the lock still stands and carries no key, and the record says what is unknown
    expect(policies[0]?.key).toBeUndefined();
    expect(collector.problems().map((problem) => problem.reason)).toContain(
      'its lock key comes from a function, so what concurrent calls are serialized per is not known',
    );
  });
});

describe('a lock on a service, which is not a route fact', () => {
  it('should never read a provider, only the handler the pass hands it', () => {
    // Given a service method carrying the very same decorator, which is where most of them sit
    @Injectable()
    class OrderService {
      @WithLock({ key: 'order:{0}', ttl: 1000 })
      process(): Promise<undefined> {
        return Promise.resolve(undefined);
      }
    }

    // The decorator really did write its metadata, asserted first so the absence below is a
    // statement about this collector and not about an empty search
    expect(
      Reflect.getMetadata(WITH_LOCK_OPTIONS_KEY, methodOf(OrderService, 'process')),
    ).toMatchObject({ key: 'order:{0}' });

    // When the collector runs over a route whose handler is not that method, in an application
    // where the service exists and is reachable through the container
    const collector = running(
      redisxLockCollector({
        resolvePackage: () => true,
        metadata: {
          get: (key, target): unknown => Reflect.getMetadata(key, target as object) as unknown,
        },
      }),
    );
    const found = collector.collect({
      ...contextOf(),
      moduleRef: { get: () => new OrderService() },
    });

    // Then nothing at all: the service's lock is real and is not this endpoint's
    expect(found).toBeUndefined();
    expect(collector.problems()).toEqual([]);
  });
});

describe('the package resolution guard', () => {
  it('should decline with a reason when the library is not installed', () => {
    // Given
    const registration = redisxLockCollector({ resolvePackage: () => false });

    // When, Then
    expect(isRuntimeCollector(registration)).toBe(false);
    expect(registration.name).toBe(REDISX_LOCK_COLLECTOR_NAME);
    expect('skipped' in registration ? registration.skipped : '').toContain(
      '@nestjs-redisx/locks is not installed',
    );
  });

  it('should read no metadata at all when the library is not installed', () => {
    // Given a reader that fails the case if it is ever consulted
    let asked = 0;
    const metadata: MetadataValueReader = {
      get: () => {
        asked += 1;

        return {};
      },
    };

    // When
    redisxLockCollector({ resolvePackage: () => false, metadata });

    // Then a global symbol is readable in any process, so the absent library is what stops the read
    expect(asked).toBe(0);
  });

  it('should resolve the installed copy when no seam is given', () => {
    // Given the real resolution, over the real dependency tree of this package
    const registration = redisxLockCollector();

    // When, Then it runs, which is the entry point resolving where the manifest subpath would not
    expect(isRuntimeCollector(registration)).toBe(true);
  });

  it('should refuse the manifest subpath the entry point stands in for', () => {
    // Given the reading the note in `isPackageInstalled` rests on
    const resolve = createRequire(import.meta.url).resolve;

    // When, Then the entry point resolves and the manifest subpath does not, on an installation
    // where the package is present and working
    expect(() => resolve('@nestjs-redisx/locks')).not.toThrow();
    expect(() => resolve('@nestjs-redisx/locks/package.json')).toThrow();
  });

  it('should decline when the runtime offers no metadata reflection', () => {
    // Given a runtime with no `reflect-metadata`
    const held = Reflect.getMetadata;
    try {
      delete (Reflect as { getMetadata?: unknown }).getMetadata;

      // When
      const registration = redisxLockCollector({ resolvePackage: () => true });

      // Then
      expect(isRuntimeCollector(registration)).toBe(false);
      expect('skipped' in registration ? registration.skipped : '').toContain(
        'no metadata reflection',
      );
    } finally {
      (Reflect as { getMetadata?: unknown }).getMetadata = held;
    }
  });

  it('should read the real decorator through the real Reflect, with no seam at all', () => {
    // Given a class decorated with the real library and a collector with no seams
    class LiveController {
      @WithLock({ key: 'live:{0}', waitTimeout: 2000, onLockFailed: 'skip' })
      place(): Promise<undefined> {
        return Promise.resolve(undefined);
      }
    }
    const collector = running(redisxLockCollector());

    // When
    const found = collector.collect({
      ...contextOf(),
      controller: LiveController,
      declaredOn: LiveController,
      handler: methodOf(LiveController, 'place') as (...args: never[]) => unknown,
      handlerName: 'place',
    });

    // Then the whole path holds end to end: real decorator, real Reflect, real resolution
    expect(found?.handlerPolicies?.[0]).toMatchObject({
      kind: 'lock',
      key: 'live:{0}',
      reach: 'handler',
      settings: [
        { name: 'waitTimeoutMs', value: 2000 },
        { name: 'onFailure', value: 'skip' },
      ],
    });
  });
});

describe('the package name', () => {
  it('should be the one the manifest declares', () => {
    // Given, When, Then
    expect(PACKAGE_NAME).toBe('@openref/collector-redisx-locks');
  });
});

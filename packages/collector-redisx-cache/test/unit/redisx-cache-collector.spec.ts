import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CACHE_OPTIONS_KEY,
  Cached,
  Cacheable,
  CacheEvict,
  CachePut,
  INVALIDATE_TAGS_KEY as LIBRARY_INVALIDATE_TAGS_KEY,
  InvalidateOn,
  InvalidateTags,
} from '@nestjs-redisx/cache';
import type { IRConfidence, IRFact, IRHandlerPolicy, IRNode } from '@openref/core';
import type { CollectorContext } from '@openref/nest';
import { isRuntimeCollector } from '@openref/nest';
import {
  CACHED_OPTIONS_KEY,
  CACHEABLE_KEY,
  CACHE_EVICT_KEY,
  CACHE_PUT_KEY,
  INVALIDATE_ON_KEY,
  INVALIDATE_TAGS_KEY,
  MILLISECONDS_PER_SECOND,
  PACKAGE_NAME,
  REDISX_CACHE_COLLECTOR_NAME,
  redisxCacheCollector,
  type MetadataValueReader,
  type RedisxCacheCollector,
  type RedisxCacheCollectorRegistration,
} from '../../src/index';

/**
 * `redisxCacheCollector`, checked against the real `@nestjs-redisx/cache`.
 *
 * THE SIX KEYS AND THE UNREGISTERED INTERCEPTOR ARE PINNED AGAINST THE INSTALLED PACKAGE RATHER
 * THAN ASSERTED FROM MEMORY. This collector reports one family of decorator as bound and another as
 * unbound, and the whole of that distinction rests on `CacheInterceptor` being registered nowhere in
 * the library. A release that started registering it would make three of these rows wrong, so the
 * first block reads the shipped source and fails here rather than on somebody's page.
 */

class OrdersController {
  list(): undefined {
    return undefined;
  }
}
const list = function list(): undefined {
  return undefined;
};

/** A reader over a plain table of key to value, standing in for `Reflect`. */
function readerOf(table: ReadonlyMap<string | symbol, unknown>): MetadataValueReader {
  return { get: (key, target) => (target === list ? table.get(key) : undefined) };
}

/**
 * A context over one route.
 *
 * @returns The context
 */
function contextOf(): CollectorContext {
  return {
    node: { id: 'orders.list' } as unknown as IRNode,
    controller: OrdersController,
    declaredOn: OrdersController,
    handler: list,
    handlerName: 'list',
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
      collector: REDISX_CACHE_COLLECTOR_NAME,
    }),
  };
}

/**
 * Narrows a registration to the collector, failing loudly when it declined.
 *
 * @param registration - What the factory returned
 * @returns The collector
 */
function running(registration: RedisxCacheCollectorRegistration): RedisxCacheCollector {
  if (!isRuntimeCollector(registration)) throw new Error('the collector declined to run');

  return registration;
}

/** A collector over a metadata table, with the package reported as installed. */
function collectorOver(table: ReadonlyMap<string | symbol, unknown>): RedisxCacheCollector {
  return running(redisxCacheCollector({ resolvePackage: () => true, metadata: readerOf(table) }));
}

/** A table holding one options object under one key. */
function under(key: string | symbol, options: unknown): ReadonlyMap<string | symbol, unknown> {
  return new Map<string | symbol, unknown>([[key, options]]);
}

/**
 * The policies of one node.
 *
 * @param collector - The collector under test
 * @returns The policies, or an empty list when the collector said nothing
 */
function policiesOf(collector: RedisxCacheCollector): readonly IRHandlerPolicy[] {
  return collector.collect(contextOf())?.handlerPolicies ?? [];
}

/**
 * One method off a class, as an unbound value.
 *
 * `Object.getOwnPropertyDescriptor` AND NOT `Class.prototype.method`, which is how the redisx
 * collectors beside this one reach the same thing: the property access form is a method separated
 * from its receiver, and the ordinary way to write that in a test is also the way to write a `this`
 * bug. It matters more here than anywhere, because these decorators REPLACE the descriptor's value
 * and write their metadata onto the replacement.
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

describe('the metadata @nestjs-redisx/cache writes', () => {
  it('should store @Cached options on the wrapper under the string key this collector asks for', () => {
    // Given the real decorator on a real method
    class RealController {
      @Cached({ key: 'orders:{0}', ttl: 60, tags: ['orders'] })
      read(): Promise<undefined> {
        return Promise.resolve(undefined);
      }
    }

    // When the key is read off the handler the way NestJS routes it
    const stored: unknown = Reflect.getMetadata(
      CACHED_OPTIONS_KEY,
      methodOf(RealController, 'read'),
    );

    // Then the string this package names is the string the library exports, and the value is the
    // options object verbatim with no default merged into it
    expect(CACHED_OPTIONS_KEY).toBe(CACHE_OPTIONS_KEY);
    expect(INVALIDATE_TAGS_KEY).toBe(LIBRARY_INVALIDATE_TAGS_KEY);
    expect(stored).toEqual({ key: 'orders:{0}', ttl: 60, tags: ['orders'] });
  });

  it('should store the three legacy keys this package spells out, since it exports none of them', () => {
    // Given the three Spring style decorators. THE LIBRARY EXPORTS THE DECORATORS AND NOT THEIR
    // KEYS, measured: `CACHEABLE_METADATA_KEY`, `CACHE_PUT_METADATA_KEY` and
    // `CACHE_EVICT_METADATA_KEY` are declared in its decorator files and left out of its `index`,
    // so this package spells the three strings itself and this case is what holds them true.
    class LegacyController {
      @Cacheable({ key: 'a:{id}' })
      read(): undefined {
        return undefined;
      }

      @CachePut({ key: 'a:{id}' })
      write(): undefined {
        return undefined;
      }

      @CacheEvict({ keys: ['a:{id}'] })
      drop(): undefined {
        return undefined;
      }
    }

    // When each key is read off the method the decorator was applied to
    const read: unknown = Reflect.getMetadata(CACHEABLE_KEY, methodOf(LegacyController, 'read'));
    const write: unknown = Reflect.getMetadata(CACHE_PUT_KEY, methodOf(LegacyController, 'write'));
    const drop: unknown = Reflect.getMetadata(CACHE_EVICT_KEY, methodOf(LegacyController, 'drop'));

    // Then all three answer, so the strings are the library's and not this package's invention
    expect(read).toMatchObject({ key: 'a:{id}' });
    expect(write).toMatchObject({ key: 'a:{id}' });
    expect(drop).toMatchObject({ keys: ['a:{id}'] });
  });

  it('should store @InvalidateTags and @InvalidateOn on the wrapper too', () => {
    // Given both proxy based invalidation decorators
    class WriteController {
      @InvalidateTags({ tags: ['orders'], when: 'after' })
      place(): Promise<undefined> {
        return Promise.resolve(undefined);
      }

      @InvalidateOn({ events: ['order.placed'], tags: ['orders'], publish: true })
      cancel(): Promise<undefined> {
        return Promise.resolve(undefined);
      }
    }

    // When
    const tags: unknown = Reflect.getMetadata(
      INVALIDATE_TAGS_KEY,
      methodOf(WriteController, 'place'),
    );
    const on: unknown = Reflect.getMetadata(INVALIDATE_ON_KEY, methodOf(WriteController, 'cancel'));

    // Then, and the symbol is the global one so no import of the library is needed to name it
    expect(tags).toEqual({ tags: ['orders'], when: 'after' });
    expect(on).toEqual({ events: ['order.placed'], tags: ['orders'], publish: true });
  });

  it('should register CacheInterceptor in no module anywhere it ships', () => {
    // Given the interceptor asserted present first: this is a proof of absence and an empty search
    // would otherwise pass as one. It is the whole basis for reporting @Cacheable at unbound reach.
    const entry = createRequire(import.meta.url).resolve('@nestjs-redisx/cache');
    const walk = (path: string): string[] => {
      if (!statSync(path).isDirectory()) return /\.(?:js|cjs|mjs)$/.test(path) ? [path] : [];

      return readdirSync(path).flatMap((name) => walk(join(path, name)));
    };
    const shipped = walk(dirname(entry))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    // When, Then the class ships and nothing wires it: no provider entry, no UseInterceptors call
    expect(shipped).toContain('CacheInterceptor');
    expect(shipped).not.toMatch(/UseInterceptors\s*\(\s*CacheInterceptor/);
    expect(shipped).not.toMatch(/provide:\s*APP_INTERCEPTOR/);
  });

  it('should contain no exception filter, HttpException or HttpStatus anywhere it ships', () => {
    // Given the same shipped source, which is why no error contract is reported at all. Asserted
    // against a marker that IS there, so an unreadable tree cannot pass as a clean one.
    const entry = createRequire(import.meta.url).resolve('@nestjs-redisx/cache');
    const walk = (path: string): string[] => {
      if (!statSync(path).isDirectory()) return /\.(?:js|cjs|mjs)$/.test(path) ? [path] : [];

      return readdirSync(path).flatMap((name) => walk(join(path, name)));
    };
    const shipped = walk(dirname(entry))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    // When, Then
    expect(shipped).toContain('CacheError');
    expect(shipped).not.toMatch(/\bExceptionFilter\b/);
    expect(shipped).not.toMatch(/\bHttpException\b/);
    expect(shipped).not.toMatch(/\bHttpStatus\b/);
  });
});

describe('redisxCacheCollector', () => {
  it('should say nothing at all about a route that carries no cache decorator', () => {
    // Given a route the library does not touch
    const collector = collectorOver(new Map<string | symbol, unknown>());

    // When
    const found = collector.collect(contextOf());

    // Then, because a present and empty list would claim this route was examined and declares no
    // cache, which this collector cannot tell from an application that never installed the plugin
    expect(found).toBeUndefined();
    expect(collector.problems()).toEqual([]);
  });

  it('should report the ttl in milliseconds, the key, the tags and the layers of @Cached', () => {
    // Given a fully declared route. THE TTL IS SECONDS HERE AND MILLISECONDS IN @WithLock next
    // door, which is why the setting is not called `ttl`.
    const collector = collectorOver(
      under(CACHED_OPTIONS_KEY, {
        key: 'orders:{0}',
        ttl: 60,
        tags: ['orders', 'lists'],
        strategy: 'l1-l2',
      }),
    );

    // When
    const policies = policiesOf(collector);

    // Then
    expect(policies).toEqual([
      {
        kind: 'cache',
        key: 'orders:{0}',
        settings: [
          { name: 'ttlMs', value: 60 * MILLISECONDS_PER_SECOND },
          { name: 'tags', value: ['orders', 'lists'] },
          { name: 'layers', value: 'l1-l2' },
        ],
        reach: 'handler',
        confidence: 'derived',
        collector: REDISX_CACHE_COLLECTOR_NAME,
      },
    ]);
    expect(collector.problems()).toEqual([]);
  });

  it('should report both stale windows only where their own enabled flag is set', () => {
    // Given one window turned on and one written but turned off, which the library never applies
    const collector = collectorOver(
      under(CACHED_OPTIONS_KEY, {
        key: 'orders',
        ttl: 60,
        swr: { enabled: true, staleTime: 30 },
        staleIfError: { enabled: false, window: 3600 },
      }),
    );

    // When
    const settings = policiesOf(collector)[0]?.settings ?? [];

    // Then the disabled one is a number the application does not honour and is not reported
    expect(settings).toContainEqual({ name: 'staleWhileRevalidateMs', value: 30_000 });
    expect(settings.map((setting) => setting.name)).not.toContain('staleIfErrorMs');
  });

  it('should leave the ttl off and say why when the decorator names none', () => {
    // Given a route whose window comes from the plugin's defaultTtl
    const collector = collectorOver(under(CACHED_OPTIONS_KEY, { key: 'orders' }));

    // When
    const policies = policiesOf(collector);

    // Then the policy stands with no ttl, and the record names the subject and what is unknown
    expect(policies[0]?.settings).toEqual([]);
    expect(collector.problems()).toEqual([
      {
        subject: 'OrdersController.list',
        reason:
          'it declares @Cached with no ttl, so how long its response is served from cache is not known',
        action: 'name ttl on the decorator to make the window a fact about this route',
        detail: expect.stringContaining('defaultTtl'),
      },
    ]);
  });

  it('should report @InvalidateTags as a cache fact about a route that caches nothing', () => {
    // Given a write endpoint that drops a tag on success
    const collector = collectorOver(under(INVALIDATE_TAGS_KEY, { tags: ['orders'] }));

    // When
    const policies = policiesOf(collector);

    // Then, and `after` is the library's own default, read off its source rather than assumed
    expect(policies).toEqual([
      {
        kind: 'cache',
        settings: [
          { name: 'invalidatesTags', value: ['orders'] },
          { name: 'invalidatesWhen', value: 'after' },
        ],
        reach: 'handler',
        confidence: 'derived',
        collector: REDISX_CACHE_COLLECTOR_NAME,
      },
    ]);
  });

  it('should report the events, tags and keys of @InvalidateOn', () => {
    // Given
    const collector = collectorOver(
      under(INVALIDATE_ON_KEY, {
        events: ['order.placed'],
        tags: ['orders'],
        keys: ['orders:latest'],
        publish: true,
      }),
    );

    // When
    const settings = policiesOf(collector)[0]?.settings ?? [];

    // Then
    expect(settings).toEqual([
      { name: 'invalidatesOnEvents', value: ['order.placed'] },
      { name: 'invalidatesTags', value: ['orders'] },
      { name: 'invalidatesKeys', value: ['orders:latest'] },
      { name: 'publishesInvalidation', value: true },
    ]);
  });

  it('should report three policies where a handler carries three decorators', () => {
    // Given a handler that reads from cache, invalidates tags and reacts to an event
    const collector = collectorOver(
      new Map<string | symbol, unknown>([
        [CACHED_OPTIONS_KEY, { key: 'orders', ttl: 60 }],
        [INVALIDATE_TAGS_KEY, { tags: ['orders'], when: 'before' }],
        [INVALIDATE_ON_KEY, { events: ['order.placed'] }],
      ]),
    );

    // When
    const policies = policiesOf(collector);

    // Then three facts and not one, which is why the IR member is a list
    expect(policies).toHaveLength(3);
    expect(policies.every((policy) => policy.kind === 'cache')).toBe(true);
    expect(policies[1]?.settings).toContainEqual({ name: 'invalidatesWhen', value: 'before' });
  });
});

describe('the two families of decorator, which are not the same fact', () => {
  it.each([
    [CACHEABLE_KEY, '@Cacheable'],
    [CACHE_PUT_KEY, '@CachePut'],
    [CACHE_EVICT_KEY, '@CacheEvict'],
  ])('should report %s at unbound reach with no settings read', (key, decorator) => {
    // Given a declaration whose reader the library registers nowhere
    const collector = collectorOver(under(key, { key: 'orders:{id}', ttl: 3600 }));

    // When
    const policies = policiesOf(collector);

    // Then the ttl is deliberately NOT read: a window beside a declaration that binds nothing is
    // the exact thing a reader would take for a window their responses are served in
    expect(policies).toEqual([
      {
        kind: 'cache',
        settings: [{ name: 'declaredBy', value: decorator }],
        reach: 'unbound',
        confidence: 'derived',
        collector: REDISX_CACHE_COLLECTOR_NAME,
      },
    ]);
    expect(collector.problems()[0]?.reason).toContain('registers nowhere');
    expect(collector.problems()[0]?.action).toContain('@Cached');
  });

  it('should report @Cached at handler reach, which is the half that binds itself', () => {
    // Given the proxy based decorator, whose presence is proof the behaviour is on the route
    const collector = collectorOver(under(CACHED_OPTIONS_KEY, { key: 'orders', ttl: 60 }));

    // When
    const policies = policiesOf(collector);

    // Then
    expect(policies[0]?.reach).toBe('handler');
  });
});

describe('what the collector refuses to read, per SPEC 6.1', () => {
  it('should record a tag function rather than naming tags nobody wrote', () => {
    // Given
    const collector = collectorOver(
      under(CACHED_OPTIONS_KEY, { key: 'orders', ttl: 60, tags: () => ['orders'] }),
    );

    // When
    const settings = policiesOf(collector)[0]?.settings ?? [];

    // Then the ttl still stands, because it does not depend on where the tags came from
    expect(settings).toEqual([{ name: 'ttlMs', value: 60_000 }]);
    expect(collector.problems().map((problem) => problem.reason)).toEqual([
      'its @Cached tags come from a function, so which invalidations reach this response is not known',
    ]);
  });

  it('should record a condition or unless function rather than claiming every call is cached', () => {
    // Given
    const collector = collectorOver(
      under(CACHED_OPTIONS_KEY, { key: 'orders', ttl: 60, unless: () => true }),
    );

    // When
    collector.collect(contextOf());

    // Then
    expect(collector.problems().map((problem) => problem.reason)).toEqual([
      'it carries a condition or unless function, so which responses are cached at all is not known',
    ]);
  });

  it('should record an absent key as the generated one rather than as no key', () => {
    // Given a route with no template, where the library builds ClassName:methodName:args
    const collector = collectorOver(under(CACHED_OPTIONS_KEY, { ttl: 60 }));

    // When
    const policies = policiesOf(collector);

    // Then the policy carries no key and the record says what fills it instead
    expect(policies[0]?.key).toBeUndefined();
    expect(collector.problems().map((problem) => problem.reason)).toEqual([
      'it names no @Cached key, so the cache is split by arguments this cannot enumerate',
    ]);
  });

  it('should record context keys that split one response into one per caller', () => {
    // Given a route whose key is varied by values a provider supplies at call time
    const collector = collectorOver(
      under(CACHED_OPTIONS_KEY, {
        key: 'orders',
        ttl: 60,
        varyBy: ['tenant'],
        contextKeys: ['locale'],
      }),
    );

    // When
    collector.collect(contextOf());

    // Then
    expect(collector.problems()).toEqual([
      {
        subject: 'OrdersController.list',
        reason:
          'its cache key is split by context values a provider supplies, so one response per caller is possible',
        action:
          'nothing to do here: this says the window shown is per context value and not per route',
        detail: expect.stringContaining('locale, tenant'),
      },
    ]);
  });

  it('should record a tag function on @InvalidateTags and still name when it fires', () => {
    // Given
    const collector = collectorOver(under(INVALIDATE_TAGS_KEY, { tags: () => ['orders'] }));

    // When
    const settings = policiesOf(collector)[0]?.settings ?? [];

    // Then the timing is a fact whatever the tags are
    expect(settings).toEqual([{ name: 'invalidatesWhen', value: 'after' }]);
    expect(collector.problems()).toHaveLength(1);
  });
});

describe('the package resolution guard', () => {
  it('should decline with a reason when the library is not installed', () => {
    // Given
    const registration = redisxCacheCollector({ resolvePackage: () => false });

    // When, Then
    expect(isRuntimeCollector(registration)).toBe(false);
    expect(registration.name).toBe(REDISX_CACHE_COLLECTOR_NAME);
    expect('skipped' in registration ? registration.skipped : '').toContain(
      '@nestjs-redisx/cache is not installed',
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
    redisxCacheCollector({ resolvePackage: () => false, metadata });

    // Then a global symbol and a plain string are both readable in any process, so the absent
    // library is what stops the read
    expect(asked).toBe(0);
  });

  it('should resolve the installed copy when no seam is given', () => {
    // Given the real resolution, over the real dependency tree of this package
    const registration = redisxCacheCollector();

    // When, Then it runs, which is the entry point resolving where the manifest subpath would not
    expect(isRuntimeCollector(registration)).toBe(true);
  });

  it('should decline when the runtime offers no metadata reflection', () => {
    // Given a runtime with no `reflect-metadata`
    const held = Reflect.getMetadata;
    try {
      delete (Reflect as { getMetadata?: unknown }).getMetadata;

      // When
      const registration = redisxCacheCollector({ resolvePackage: () => true });

      // Then
      expect(isRuntimeCollector(registration)).toBe(false);
      expect('skipped' in registration ? registration.skipped : '').toContain(
        'no metadata reflection',
      );
    } finally {
      (Reflect as { getMetadata?: unknown }).getMetadata = held;
    }
  });

  it('should read the real decorators through the real Reflect, with no seam at all', () => {
    // Given a class decorated with the real library, one from each family, and no seams
    class LiveController {
      @Cached({ key: 'live', ttl: 30 })
      read(): Promise<undefined> {
        return Promise.resolve(undefined);
      }

      @Cacheable({ key: 'stale:{id}', ttl: 3600 })
      legacy(): undefined {
        return undefined;
      }
    }
    const collector = running(redisxCacheCollector());

    // When
    const bound = collector.collect({
      ...contextOf(),
      controller: LiveController,
      declaredOn: LiveController,
      handler: methodOf(LiveController, 'read') as (...args: never[]) => unknown,
      handlerName: 'read',
    });
    const unbound = collector.collect({
      ...contextOf(),
      controller: LiveController,
      declaredOn: LiveController,
      handler: methodOf(LiveController, 'legacy') as (...args: never[]) => unknown,
      handlerName: 'legacy',
    });

    // Then the whole path holds end to end, and the two families read differently
    expect(bound?.handlerPolicies?.[0]).toMatchObject({
      key: 'live',
      reach: 'handler',
      settings: [{ name: 'ttlMs', value: 30_000 }],
    });
    expect(unbound?.handlerPolicies?.[0]).toMatchObject({
      reach: 'unbound',
      settings: [{ name: 'declaredBy', value: '@Cacheable' }],
    });
  });
});

describe('the package name', () => {
  it('should be the one the manifest declares', () => {
    // Given, When, Then
    expect(PACKAGE_NAME).toBe('@openref/collector-redisx-cache');
  });
});

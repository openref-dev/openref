import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Controller, Post } from '@nestjs/common';
import {
  Idempotent,
  IDEMPOTENT_OPTIONS,
  IDEMPOTENCY_PLUGIN_OPTIONS,
  IdempotencyKeyRequiredError,
  IdempotencyRecordNotFoundError,
} from '@nestjs-redisx/idempotency';
import type { IRConfidence, IRErrorContract, IRFact, IRNode } from '@openref/core';
import type { CollectorContext } from '@openref/nest';
import { isRuntimeCollector } from '@openref/nest';
import {
  CONFLICT_STATUS,
  DEFAULT_HEADER_NAME,
  FINGERPRINT_STATUS,
  IDEMPOTENCY_PLUGIN_OPTIONS_KEY,
  IDEMPOTENT_OPTIONS_KEY,
  PACKAGE_NAME,
  REDISX_IDEMPOTENCY_COLLECTOR_NAME,
  redisxIdempotencyCollector,
  type MetadataValueReader,
  type RedisxIdempotencyCollector,
  type RedisxIdempotencyCollectorRegistration,
} from '../../src/index';

/**
 * `redisxIdempotencyCollector`, checked against the real `@nestjs-redisx/idempotency`.
 *
 * THE KEY, THE STORED SHAPE AND THE DEAD STATUSES ARE PINNED AGAINST THE INSTALLED PACKAGE RATHER
 * THAN ASSERTED FROM MEMORY. What this collector reports is the set of statuses that library's own
 * filter can actually reach, and an earlier survey of its minified `dist` read the filter's mapping
 * table and concluded five. Two of the five are constructed by nothing: the first block below holds
 * both the key and that absence against the source on disk, so a release that started throwing
 * either would fail here rather than leaving a reference silently short of a status.
 */

class OrdersController {
  create(): undefined {
    return undefined;
  }
}
const create = function create(): undefined {
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
 * @param over - What the plugin options provider holds, when anything does
 * @returns The context
 */
function contextOf(over: { pluginOptions?: unknown } = {}): CollectorContext {
  return {
    node: { id: 'orders.create' } as unknown as IRNode,
    controller: OrdersController,
    declaredOn: OrdersController,
    handler: create,
    handlerName: 'create',
    reflector: { get: () => undefined, getAllAndOverride: () => undefined },
    moduleRef: {
      get: (token: unknown) => {
        if (token !== IDEMPOTENCY_PLUGIN_OPTIONS_KEY || !('pluginOptions' in over)) {
          throw new UnknownElementException('nothing is registered under that token');
        }

        return over.pluginOptions;
      },
    },
    globalGuards: [],
    globalPipes: [],
    fact: <T>(value: T, confidence: IRConfidence): IRFact<T> => ({
      value,
      confidence,
      collector: REDISX_IDEMPOTENCY_COLLECTOR_NAME,
    }),
  };
}

/**
 * Narrows a registration to the collector, failing loudly when it declined.
 *
 * @param registration - What the factory returned
 * @returns The collector
 */
function running(registration: RedisxIdempotencyCollectorRegistration): RedisxIdempotencyCollector {
  if (!isRuntimeCollector(registration)) throw new Error('the collector declined to run');

  return registration;
}

/** A collector over a metadata table, with the package reported as installed. */
function collectorOver(table: ReadonlyMap<unknown, unknown>): RedisxIdempotencyCollector {
  return running(
    redisxIdempotencyCollector({ resolvePackage: () => true, metadata: readerOf(table) }),
  );
}

/** A table holding one options object on the handler alone. */
function onHandler(options: unknown): ReadonlyMap<unknown, unknown> {
  return new Map<unknown, unknown>([[create, options]]);
}

/**
 * One method off a class, as an unbound value.
 *
 * `Object.getOwnPropertyDescriptor` AND NOT `Class.prototype.method`, which is how
 * `@openref/collector-redisx-rate-limit`'s own suite reaches the same thing: the property access
 * form is a method separated from its receiver, and the ordinary way to write that in a test is
 * also the way to write a `this` bug.
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

/** The plugin configuration the library's own `mergeDefaults` produces for an empty registration. */
const MERGED_DEFAULTS = {
  defaultTtl: 86400,
  keyPrefix: 'idempotency:',
  headerName: DEFAULT_HEADER_NAME,
  lockTimeout: 30000,
  waitTimeout: 60000,
  validateFingerprint: true,
  fingerprintFields: ['method', 'path', 'body'],
  errorPolicy: 'fail-closed',
};

/**
 * The runtime derived contracts of one node.
 *
 * @param collector - The collector under test
 * @param over - What the plugin options provider holds
 * @returns The contracts, or an empty list when the collector said nothing
 */
function contractsOf(
  collector: RedisxIdempotencyCollector,
  over: { pluginOptions?: unknown } = {},
): readonly IRErrorContract[] {
  return collector.collect(contextOf(over))?.errors?.runtimeDerived ?? [];
}

describe('the metadata @nestjs-redisx/idempotency writes', () => {
  it('should store the decorator options under the symbol this collector asks for', () => {
    // Given the real decorator on a real controller method
    class RealController {
      @Post()
      @Idempotent({ ttl: 60 })
      place(): undefined {
        return undefined;
      }
    }
    Controller('orders')(RealController);

    // When the key is read off the handler the way NestJS routes it
    const stored: unknown = Reflect.getMetadata(
      IDEMPOTENT_OPTIONS_KEY,
      methodOf(RealController, 'place'),
    );

    // Then the symbol this package names is the symbol the library exports, and the value is the
    // options object verbatim with no default merged into it
    expect(IDEMPOTENT_OPTIONS_KEY).toBe(IDEMPOTENT_OPTIONS);
    expect(IDEMPOTENCY_PLUGIN_OPTIONS_KEY).toBe(IDEMPOTENCY_PLUGIN_OPTIONS);
    expect(stored).toEqual({ ttl: 60 });
  });

  it('should store an empty object for a bare @Idempotent rather than undefined', () => {
    // Given the decorator with no argument, which is the shape `@RateLimit()` beside it does NOT
    // have: this library defaults the parameter before it calls SetMetadata
    class BareController {
      @Idempotent()
      place(): undefined {
        return undefined;
      }
    }

    // When
    const stored: unknown = Reflect.getMetadata(
      IDEMPOTENT_OPTIONS_KEY,
      methodOf(BareController, 'place'),
    );

    // Then presence and not content is what says the route is decorated
    expect(stored).toEqual({});
  });

  it('should construct no key-required and no record-not-found error anywhere it ships', () => {
    // Given the two errors the library's own filter maps to 400 and to the third 409, asserted
    // present first: this is a proof of absence and an empty search would otherwise pass as one.
    // WHAT THE EARLIER SURVEY GOT WRONG: it read the minified filter's mapping table and reported
    // five statuses. The table is real; two of its rows have no throw site in the library at all.
    expect(typeof IdempotencyKeyRequiredError).toBe('function');
    expect(typeof IdempotencyRecordNotFoundError).toBe('function');

    // When every shipped module of the installed copy is read
    const entry = createRequire(import.meta.url).resolve('@nestjs-redisx/idempotency');
    const walk = (path: string): string[] => {
      if (!statSync(path).isDirectory()) return /\.(?:js|cjs|mjs)$/.test(path) ? [path] : [];

      return readdirSync(path).flatMap((name) => walk(join(path, name)));
    };
    const shipped = walk(dirname(entry))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    // Then neither is ever constructed, so neither status is reachable and neither is reported
    expect(shipped).toContain('IdempotencyKeyRequiredError');
    expect(shipped).not.toMatch(/new\s+IdempotencyKeyRequiredError/);
    expect(shipped).not.toMatch(/new\s+IdempotencyRecordNotFoundError/);
  });
});

describe('redisxIdempotencyCollector', () => {
  it('should say nothing at all about a route that carries no decorator', () => {
    // Given a route the library does not touch
    const collector = collectorOver(new Map<unknown, unknown>());

    // When
    const found = collector.collect(contextOf());

    // Then, because an errors record present and empty would claim this route was examined and
    // found silent, which is a different sentence from "this collector has no business here"
    expect(found).toBeUndefined();
    expect(collector.problems()).toEqual([]);
  });

  it('should report the conflict and the fingerprint status of a decorated route', () => {
    // Given a decorated route in an application whose plugin is registered with its own defaults
    const collector = collectorOver(onHandler({}));

    // When
    const contracts = contractsOf(collector, { pluginOptions: MERGED_DEFAULTS });

    // Then both statuses the library can actually answer with, each carrying its provenance
    expect(contracts.map((contract) => contract.status)).toEqual([
      CONFLICT_STATUS,
      FINGERPRINT_STATUS,
    ]);
    expect(contracts.every((contract) => contract.origin === 'runtime-derived')).toBe(true);
    expect(contracts.every((contract) => contract.confidence === 'derived')).toBe(true);
    expect(
      contracts.every((contract) => contract.collector === REDISX_IDEMPOTENCY_COLLECTOR_NAME),
    ).toBe(true);
  });

  it('should report neither the 400 nor the 500 the filter has a row for', () => {
    // Given the same decorated route
    const collector = collectorOver(onHandler({}));

    // When
    const contracts = contractsOf(collector, { pluginOptions: MERGED_DEFAULTS });

    // Then, and the subject is asserted present first: contracts really were produced, so an empty
    // list cannot pass as a clean one
    expect(contracts.length).toBeGreaterThan(0);
    expect(contracts.map((contract) => contract.status)).not.toContain(400);
    expect(contracts.map((contract) => contract.status)).not.toContain(500);
  });

  it('should drop the fingerprint status where the decorator turns the comparison off', () => {
    // Given a route that opts out of fingerprint validation, which is what makes the 422 unreachable
    const collector = collectorOver(onHandler({ validateFingerprint: false }));

    // When
    const contracts = contractsOf(collector, { pluginOptions: MERGED_DEFAULTS });

    // Then only the conflict remains, and nothing is recorded because nothing was unreadable
    expect(contracts.map((contract) => contract.status)).toEqual([CONFLICT_STATUS]);
    expect(collector.problems()).toEqual([]);
  });

  it('should drop the fingerprint status where the plugin turns the comparison off', () => {
    // Given an application that registered the plugin with the comparison disabled
    const collector = collectorOver(onHandler({}));

    // When
    const contracts = contractsOf(collector, {
      pluginOptions: { ...MERGED_DEFAULTS, validateFingerprint: false },
    });

    // Then the plugin decides it, because the library resolves the decorator first and the plugin
    // second
    expect(contracts.map((contract) => contract.status)).toEqual([CONFLICT_STATUS]);
  });

  it('should let the decorator overrule the plugin, which is the order the library resolves in', () => {
    // Given a plugin that disabled the comparison and a route that turned it back on
    const collector = collectorOver(onHandler({ validateFingerprint: true }));

    // When
    const contracts = contractsOf(collector, {
      pluginOptions: { ...MERGED_DEFAULTS, validateFingerprint: false },
    });

    // Then
    expect(contracts.map((contract) => contract.status)).toEqual([
      CONFLICT_STATUS,
      FINGERPRINT_STATUS,
    ]);
  });

  it('should leave the fingerprint status off and say why when no plugin answers the token', () => {
    // Given a decorated route in an application where nothing is registered under the plugin token
    const collector = collectorOver(onHandler({}));

    // When
    const contracts = contractsOf(collector);

    // Then the conflict stands, the other is left off rather than assumed, and the reason names
    // the subject and what is therefore unknown
    expect(contracts.map((contract) => contract.status)).toEqual([CONFLICT_STATUS]);
    expect(collector.problems()).toEqual([
      {
        subject: 'OrdersController.create',
        reason:
          'the plugin configuration was not resolvable, so whether a reused key can answer 422 is not known',
        action:
          'declare validateFingerprint on @Idempotent to make the answer a fact about this route',
        detail: expect.stringContaining('IDEMPOTENCY_PLUGIN_OPTIONS'),
      },
    ]);
  });
});

describe('what the collector refuses to read, per SPEC 6.1', () => {
  it('should record a keyExtractor function rather than naming a header nobody sends', () => {
    // Given a route whose key comes from code
    const collector = collectorOver(onHandler({ keyExtractor: () => 'k' }));

    // When
    const contracts = contractsOf(collector, { pluginOptions: MERGED_DEFAULTS });

    // Then the statuses still hold, because they do not depend on where the key came from, and the
    // record says the key is not the header
    expect(contracts).toHaveLength(2);
    expect(collector.problems().map((problem) => problem.reason)).toEqual([
      'its key comes from a keyExtractor function, so what a caller must send to repeat a request is not known',
    ]);
  });

  it('should record a skip function rather than claiming every request is handled', () => {
    // Given a route that opts individual requests out
    const collector = collectorOver(onHandler({ skip: () => true }));

    // When
    collector.collect(contextOf({ pluginOptions: MERGED_DEFAULTS }));

    // Then
    expect(collector.problems().map((problem) => problem.reason)).toEqual([
      'it carries a skip function, so which requests are handled idempotently at all is not known',
    ]);
  });

  it('should record controller options the library will never read', () => {
    // Given the asymmetry that is this library's and not this collector's: the decorator on a
    // controller binds the interceptor to every route on it, and the interceptor then reads its
    // options with reflector.get(key, context.getHandler()), which is the handler and never the
    // class. A ttl written on the controller is discarded in silence.
    const collector = collectorOver(
      new Map<unknown, unknown>([[OrdersController, { ttl: 60, cacheHeaders: ['ETag'] }]]),
    );

    // When
    const contracts = contractsOf(collector, { pluginOptions: MERGED_DEFAULTS });

    // Then the route is idempotent, so the statuses stand, and the discarded options are named
    expect(contracts).toHaveLength(2);
    expect(collector.problems()).toEqual([
      {
        subject: 'OrdersController.create',
        reason:
          '@Idempotent is on the controller and the library reads its options off the handler, so ttl, cacheHeaders is not applied',
        action: 'move the options onto the method, where the interceptor reads them',
        detail: expect.stringContaining('context.getHandler()'),
      },
    ]);
  });

  it('should record nothing for a bare controller decorator, which discards nothing', () => {
    // Given `@Idempotent()` on the class, whose empty object has nothing to discard
    const collector = collectorOver(new Map<unknown, unknown>([[OrdersController, {}]]));

    // When
    const contracts = contractsOf(collector, { pluginOptions: MERGED_DEFAULTS });

    // Then the route is still idempotent and there is no finding, because nothing was lost
    expect(contracts).toHaveLength(2);
    expect(collector.problems()).toEqual([]);
  });

  it('should read the handler options alone when both targets carry the decorator', () => {
    // Given options on both, which the library resolves by reading only the handler
    const collector = collectorOver(
      new Map<unknown, unknown>([
        [OrdersController, { validateFingerprint: true }],
        [create, { validateFingerprint: false }],
      ]),
    );

    // When
    const contracts = contractsOf(collector, { pluginOptions: MERGED_DEFAULTS });

    // Then the handler wins outright rather than the two being merged, and no controller record is
    // made because the handler's own decorator is what the interceptor reads
    expect(contracts.map((contract) => contract.status)).toEqual([CONFLICT_STATUS]);
    expect(collector.problems()).toEqual([]);
  });
});

describe('the package resolution guard', () => {
  it('should decline with a reason when the library is not installed', () => {
    // Given
    const registration = redisxIdempotencyCollector({ resolvePackage: () => false });

    // When, Then
    expect(isRuntimeCollector(registration)).toBe(false);
    expect(registration.name).toBe(REDISX_IDEMPOTENCY_COLLECTOR_NAME);
    expect('skipped' in registration ? registration.skipped : '').toContain(
      '@nestjs-redisx/idempotency is not installed',
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
    redisxIdempotencyCollector({ resolvePackage: () => false, metadata });

    // Then a global symbol is readable in any process, so the absent library is what stops the read
    expect(asked).toBe(0);
  });

  it('should resolve the installed copy when no seam is given', () => {
    // Given the real resolution, over the real dependency tree of this package
    const registration = redisxIdempotencyCollector();

    // When, Then it runs, which is the entry point resolving where the manifest subpath would not
    expect(isRuntimeCollector(registration)).toBe(true);
  });

  it('should decline when the runtime offers no metadata reflection', () => {
    // Given a runtime with no `reflect-metadata`
    const held = Reflect.getMetadata;
    try {
      delete (Reflect as { getMetadata?: unknown }).getMetadata;

      // When
      const registration = redisxIdempotencyCollector({ resolvePackage: () => true });

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
      @Idempotent({ validateFingerprint: false })
      place(): undefined {
        return undefined;
      }
    }
    const collector = running(redisxIdempotencyCollector());

    // When
    const found = collector.collect({
      ...contextOf({ pluginOptions: MERGED_DEFAULTS }),
      controller: LiveController,
      declaredOn: LiveController,
      handler: methodOf(LiveController, 'place') as (...args: never[]) => unknown,
      handlerName: 'place',
    });

    // Then the whole path holds end to end: real decorator, real Reflect, real resolution
    expect(found?.errors?.runtimeDerived.map((contract) => contract.status)).toEqual([
      CONFLICT_STATUS,
    ]);
  });
});

describe('the package name', () => {
  it('should be the one the manifest publishes', () => {
    // Given, When, Then
    expect(PACKAGE_NAME).toBe('@openref/collector-redisx-idempotency');
  });
});

import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Injectable } from '@nestjs/common';
import { CircuitBreakerOpenError, WithCircuitBreaker } from '@nestjs-redisx/circuit-breaker';
import type { IRConfidence, IRFact, IRHandlerPolicy, IRNode } from '@openref/core';
import type { CollectorContext } from '@openref/nest';
import { isRuntimeCollector } from '@openref/nest';
import {
  PACKAGE_NAME,
  REDISX_CIRCUIT_BREAKER_COLLECTOR_NAME,
  redisxCircuitBreakerCollector,
  WITH_CIRCUIT_BREAKER_OPTIONS_KEY,
  type MetadataValueReader,
  type RedisxCircuitBreakerCollector,
  type RedisxCircuitBreakerCollectorRegistration,
} from '../../src/index';

/**
 * `redisxCircuitBreakerCollector`, checked against the real `@nestjs-redisx/circuit-breaker`.
 *
 * THE ABSENT STATUS IS THE CLAIM THIS SUITE HAS TO HOLD, exactly as it is for the lock collector.
 * A 503 is the obvious guess for an open breaker and this package refuses it, on the grounds that
 * the library carries no exception filter, no `HttpException`, and a plugin level `errorFactory`
 * that lets a host replace even the error class. All three are read off the shipped source here.
 */

class PaymentsController {
  charge(): undefined {
    return undefined;
  }
}
const charge = function charge(): undefined {
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
    node: { id: 'payments.charge' } as unknown as IRNode,
    controller: PaymentsController,
    declaredOn: PaymentsController,
    handler: charge,
    handlerName: 'charge',
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
      collector: REDISX_CIRCUIT_BREAKER_COLLECTOR_NAME,
    }),
  };
}

/**
 * Narrows a registration to the collector, failing loudly when it declined.
 *
 * @param registration - What the factory returned
 * @returns The collector
 */
function running(
  registration: RedisxCircuitBreakerCollectorRegistration,
): RedisxCircuitBreakerCollector {
  if (!isRuntimeCollector(registration)) throw new Error('the collector declined to run');

  return registration;
}

/** A collector over a metadata table, with the package reported as installed. */
function collectorOver(table: ReadonlyMap<unknown, unknown>): RedisxCircuitBreakerCollector {
  return running(
    redisxCircuitBreakerCollector({ resolvePackage: () => true, metadata: readerOf(table) }),
  );
}

/** A table holding one options object on the handler alone. */
function onHandler(options: unknown): ReadonlyMap<unknown, unknown> {
  return new Map<unknown, unknown>([[charge, options]]);
}

/**
 * The policies of one node.
 *
 * @param collector - The collector under test
 * @returns The policies, or an empty list when the collector said nothing
 */
function policiesOf(collector: RedisxCircuitBreakerCollector): readonly IRHandlerPolicy[] {
  return collector.collect(contextOf())?.handlerPolicies ?? [];
}

/**
 * One method off a class, as an unbound value.
 *
 * `Object.getOwnPropertyDescriptor` AND NOT `Class.prototype.method`, which matters here because
 * `@WithCircuitBreaker` REPLACES the descriptor's value and writes its metadata onto the
 * replacement.
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
  const entry = createRequire(import.meta.url).resolve('@nestjs-redisx/circuit-breaker');
  const walk = (path: string): string[] => {
    if (!statSync(path).isDirectory()) return /\.(?:js|cjs|mjs)$/.test(path) ? [path] : [];

    return readdirSync(path).flatMap((name) => walk(join(path, name)));
  };

  return walk(dirname(entry))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}

describe('the metadata @nestjs-redisx/circuit-breaker writes', () => {
  it('should store the decorator options on the wrapper under the symbol this collector asks for', () => {
    // Given the real decorator on a real method
    class RealController {
      @WithCircuitBreaker({ key: 'stripe', failureThreshold: 5, openDurationMs: 30_000 })
      charge(): Promise<undefined> {
        return Promise.resolve(undefined);
      }
    }

    // When the key is read off the handler the way NestJS routes it
    const stored: unknown = Reflect.getMetadata(
      WITH_CIRCUIT_BREAKER_OPTIONS_KEY,
      methodOf(RealController, 'charge'),
    );

    // Then the global symbol names the library's own key with no import of it, and the value is
    // the options object verbatim with no default merged into it
    expect(stored).toEqual({ key: 'stripe', failureThreshold: 5, openDurationMs: 30_000 });
  });

  it('should map its open error to no HTTP status anywhere it ships', () => {
    // Given the error asserted present first: this is a proof of absence and an empty search would
    // otherwise pass as one. It is the whole basis for reporting no error contract.
    expect(typeof CircuitBreakerOpenError).toBe('function');

    // When every shipped module of the installed copy is read
    const shipped = shippedSource();

    // Then no filter, no HttpException, no HttpStatus, and an errorFactory a host can replace the
    // error class with entirely, so the code a refused caller sees is not this library's to state
    expect(shipped).toContain('CircuitBreakerOpenError');
    expect(shipped).toContain('errorFactory');
    expect(shipped).not.toMatch(/\bExceptionFilter\b/);
    expect(shipped).not.toMatch(/\bHttpException\b/);
    expect(shipped).not.toMatch(/\bHttpStatus\b/);
  });
});

describe('redisxCircuitBreakerCollector', () => {
  it('should say nothing at all about a route that carries no breaker', () => {
    // Given a route the library does not touch
    const collector = collectorOver(new Map<unknown, unknown>());

    // When
    const found = collector.collect(contextOf());

    // Then, because a present and empty list would claim this route was examined and stands behind
    // nothing, which this collector cannot tell from an application without the plugin
    expect(found).toBeUndefined();
    expect(collector.problems()).toEqual([]);
  });

  it('should report every threshold the route declared, in the reader order', () => {
    // Given a fully declared breaker
    const collector = collectorOver(
      onHandler({
        key: 'stripe',
        failureThreshold: 5,
        windowMs: 10_000,
        openDurationMs: 30_000,
        halfOpenMaxCalls: 1,
        successThreshold: 2,
        probeTimeoutMs: 4000,
      }),
    );

    // When
    const policies = policiesOf(collector);

    // Then
    expect(policies).toEqual([
      {
        kind: 'circuit-breaker',
        key: 'stripe',
        settings: [
          { name: 'failureThreshold', value: 5 },
          { name: 'windowMs', value: 10_000 },
          { name: 'openDurationMs', value: 30_000 },
          { name: 'halfOpenMaxCalls', value: 1 },
          { name: 'successThreshold', value: 2 },
          { name: 'probeTimeoutMs', value: 4000 },
          { name: 'whenOpen', value: 'throw' },
        ],
        reach: 'handler',
        confidence: 'derived',
        collector: REDISX_CIRCUIT_BREAKER_COLLECTOR_NAME,
      },
    ]);
  });

  it('should read no module default for a route that declares only a key', () => {
    // Given a breaker whose every threshold comes from the plugin provider
    const collector = collectorOver(onHandler({ key: 'stripe' }));

    // When
    const policies = policiesOf(collector);

    // Then the row says the route is guarded and states no figure, because a module wide default
    // attributed to one endpoint is the ruling the rate limit collector already took
    expect(policies[0]?.settings).toEqual([{ name: 'whenOpen', value: 'throw' }]);
    expect(collector.problems().map((problem) => problem.reason)).toContain(
      'it declares a breaker and no threshold of its own, so what trips this route is not known',
    );
  });

  it('should let a fallback outrank onOpen, which is the library resolution order', () => {
    // Given a decorator carrying both, where `resolveFallback` takes the function first
    const collector = collectorOver(
      onHandler({ key: 'stripe', failureThreshold: 3, fallback: () => ({}), onOpen: 'skip' }),
    );

    // When
    const settings = policiesOf(collector)[0]?.settings ?? [];

    // Then what the application does is what is reported
    expect(settings).toContainEqual({ name: 'whenOpen', value: 'fallback' });
  });
});

describe('what cannot be tied to a served response', () => {
  it('should say the refused caller has no known status, and name the action', () => {
    // Given the ordinary breaker, whose refusal is a plain Error subclass
    const collector = collectorOver(onHandler({ key: 'stripe', failureThreshold: 5 }));

    // When
    const policies = policiesOf(collector);

    // Then the breaker is reported, and the missing status is a record rather than a withheld fact
    expect(policies).toHaveLength(1);
    expect(collector.problems()).toEqual([
      {
        subject: 'PaymentsController.charge',
        reason: 'a refused call gets CircuitBreakerOpenError, whose status is not known',
        action: 'declare the status your exception filter maps it to with @ApiErrors on this route',
        detail: expect.stringContaining('errorFactory'),
      },
    ]);
  });

  it('should report no error contract at all, which is what an invented 503 would be', () => {
    // Given the same breaker
    const collector = collectorOver(onHandler({ key: 'stripe', failureThreshold: 5 }));

    // When
    const found = collector.collect(contextOf());

    // Then the subject is asserted present first, so an empty reading cannot pass as a clean one
    expect(found?.handlerPolicies).toHaveLength(1);
    expect(found?.errors).toBeUndefined();
  });

  it('should say a fallback can answer with a shape the handler never produces', () => {
    // Given a breaker with a fallback
    const collector = collectorOver(
      onHandler({ key: 'stripe', failureThreshold: 5, fallback: () => ({ queued: true }) }),
    );

    // When
    collector.collect(contextOf());

    // Then, and the throw record is NOT also written, because only one of them can happen
    expect(collector.problems()).toEqual([
      {
        subject: 'PaymentsController.charge',
        reason:
          'a refused call is answered by a fallback function, so what body it returns is not known',
        action: 'document the fallback body with @ApiResponse if a client can receive it',
        detail: expect.stringContaining('never read'),
      },
    ]);
  });

  it('should say a skipped call can be answered with nothing at all', () => {
    // Given a breaker that resolves to undefined rather than refusing
    const collector = collectorOver(
      onHandler({ key: 'stripe', failureThreshold: 5, onOpen: 'skip' }),
    );

    // When
    const settings = policiesOf(collector)[0]?.settings ?? [];

    // Then
    expect(settings).toContainEqual({ name: 'whenOpen', value: 'skip' });
    expect(collector.problems().map((problem) => problem.reason)).toEqual([
      'a refused call resolves to nothing, so this route can answer with no body at all',
    ]);
  });

  it('should record a key function and a skip function rather than claiming a scope', () => {
    // Given a breaker whose circuit and whose exemptions both come from code
    const collector = collectorOver(
      onHandler({ key: () => 'tenant:1', failureThreshold: 5, skip: () => true }),
    );

    // When
    const policies = policiesOf(collector);

    // Then the breaker still stands and carries no key, and both records are made
    expect(policies[0]?.key).toBeUndefined();
    expect(collector.problems().map((problem) => problem.reason)).toEqual([
      'its circuit key comes from a function, so what the breaker counts failures per is not known',
      'it carries a skip function, so which calls go through the breaker at all is not known',
      'a refused call gets CircuitBreakerOpenError, whose status is not known',
    ]);
  });
});

describe('a breaker on a service, which is not a route fact', () => {
  it('should never read a provider, only the handler the pass hands it', () => {
    // Given a service method carrying the very same decorator, which is where the library's own
    // examples put it
    @Injectable()
    class PaymentsService {
      @WithCircuitBreaker({ key: 'stripe', failureThreshold: 5 })
      charge(): Promise<undefined> {
        return Promise.resolve(undefined);
      }
    }

    // The decorator really did write its metadata, asserted first so the absence below is a
    // statement about this collector and not about an empty search
    expect(
      Reflect.getMetadata(WITH_CIRCUIT_BREAKER_OPTIONS_KEY, methodOf(PaymentsService, 'charge')),
    ).toMatchObject({ key: 'stripe' });

    // When the collector runs over a route whose handler is not that method, in an application
    // where the service exists and is reachable through the container
    const collector = running(
      redisxCircuitBreakerCollector({
        resolvePackage: () => true,
        metadata: {
          get: (key, target): unknown => Reflect.getMetadata(key, target as object) as unknown,
        },
      }),
    );
    const found = collector.collect({
      ...contextOf(),
      moduleRef: { get: () => new PaymentsService() },
    });

    // Then nothing at all: the service's breaker is real and is not this endpoint's
    expect(found).toBeUndefined();
    expect(collector.problems()).toEqual([]);
  });
});

describe('the package resolution guard', () => {
  it('should decline with a reason when the library is not installed', () => {
    // Given
    const registration = redisxCircuitBreakerCollector({ resolvePackage: () => false });

    // When, Then
    expect(isRuntimeCollector(registration)).toBe(false);
    expect(registration.name).toBe(REDISX_CIRCUIT_BREAKER_COLLECTOR_NAME);
    expect('skipped' in registration ? registration.skipped : '').toContain(
      '@nestjs-redisx/circuit-breaker is not installed',
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
    redisxCircuitBreakerCollector({ resolvePackage: () => false, metadata });

    // Then a global symbol is readable in any process, so the absent library is what stops the read
    expect(asked).toBe(0);
  });

  it('should resolve the installed copy when no seam is given', () => {
    // Given the real resolution, over the real dependency tree of this package
    const registration = redisxCircuitBreakerCollector();

    // When, Then it runs, which is the entry point resolving where the manifest subpath would not
    expect(isRuntimeCollector(registration)).toBe(true);
  });

  it('should refuse the manifest subpath the entry point stands in for', () => {
    // Given the reading the note in `isPackageInstalled` rests on
    const resolve = createRequire(import.meta.url).resolve;

    // When, Then the entry point resolves and the manifest subpath does not, on an installation
    // where the package is present and working
    expect(() => resolve('@nestjs-redisx/circuit-breaker')).not.toThrow();
    expect(() => resolve('@nestjs-redisx/circuit-breaker/package.json')).toThrow();
  });

  it('should decline when the runtime offers no metadata reflection', () => {
    // Given a runtime with no `reflect-metadata`
    const held = Reflect.getMetadata;
    try {
      delete (Reflect as { getMetadata?: unknown }).getMetadata;

      // When
      const registration = redisxCircuitBreakerCollector({ resolvePackage: () => true });

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
      @WithCircuitBreaker({ key: 'live', failureThreshold: 2, windowMs: 5000, onOpen: 'skip' })
      charge(): Promise<undefined> {
        return Promise.resolve(undefined);
      }
    }
    const collector = running(redisxCircuitBreakerCollector());

    // When
    const found = collector.collect({
      ...contextOf(),
      controller: LiveController,
      declaredOn: LiveController,
      handler: methodOf(LiveController, 'charge') as (...args: never[]) => unknown,
      handlerName: 'charge',
    });

    // Then the whole path holds end to end: real decorator, real Reflect, real resolution
    expect(found?.handlerPolicies?.[0]).toMatchObject({
      kind: 'circuit-breaker',
      key: 'live',
      reach: 'handler',
      settings: [
        { name: 'failureThreshold', value: 2 },
        { name: 'windowMs', value: 5000 },
        { name: 'whenOpen', value: 'skip' },
      ],
    });
  });
});

describe('the package name', () => {
  it('should be the one the manifest declares', () => {
    // Given, When, Then
    expect(PACKAGE_NAME).toBe('@openref/collector-redisx-circuit-breaker');
  });
});

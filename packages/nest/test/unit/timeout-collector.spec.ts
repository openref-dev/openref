import { describe, expect, it } from 'vitest';
import type { IRConfidence, IRFact, IRNode } from '@openref/core';
import {
  timeoutCollector,
  TIMEOUT_COLLECTOR_NAME,
} from '../../src/runtime/infrastructure/collectors/timeout.collector';
import { isSkippedCollector } from '../../src/runtime/application/ports/collector.port';
import type { CollectorContext } from '../../src/runtime/application/ports/collector.port';
import type { HandlerLike, ReflectorLike } from '../../src/shared/types/nest-surface';

/**
 * `timeoutCollector`, held to SPEC 6.2.1: a number under the host's key, and nothing else ever.
 *
 * The interceptor whose enforcement the number describes is never read; a key is never guessed;
 * a value that is not a positive number becomes a `doctor` problem rather than a coerced fact.
 */

const KEY = 'app.timeout';

class OrdersController {
  list(): undefined {
    return undefined;
  }
}
const list: HandlerLike = function list() {
  return undefined;
};

/** A context whose reflector answers the timeout key with one prepared value. */
function contextOf(value: unknown): CollectorContext {
  const reflector: ReflectorLike = {
    get: () => undefined,
    getAllAndOverride(key: unknown): unknown {
      return key === KEY ? value : undefined;
    },
  };

  return {
    node: { id: 'orders.list' } as unknown as IRNode,
    controller: OrdersController,
    declaredOn: OrdersController,
    handler: list,
    handlerName: 'list',
    reflector,
    moduleRef: { get: () => undefined },
    globalGuards: [],
    globalPipes: [],
    fact: <T>(held: T, confidence: IRConfidence): IRFact<T> => ({
      value: held,
      confidence,
      collector: TIMEOUT_COLLECTOR_NAME,
    }),
  };
}

describe('timeoutCollector', () => {
  it('should report the number under the key as milliseconds, at derived', () => {
    // Given a route declaring 5000 under the application's key
    const collector = timeoutCollector({ metadataKey: KEY });
    if (isSkippedCollector(collector)) throw new Error('the key was usable');

    // When
    const found = collector.collect(contextOf(5000));

    // Then
    expect(found).toEqual({
      timeout: { value: { ms: 5000 }, confidence: 'derived', collector: TIMEOUT_COLLECTOR_NAME },
    });
  });

  it('should report nothing on a route with nothing under the key', () => {
    // Given
    const collector = timeoutCollector({ metadataKey: KEY });
    if (isSkippedCollector(collector)) throw new Error('the key was usable');

    // When, Then
    expect(collector.collect(contextOf(undefined))).toBeUndefined();
    expect(collector.problems()).toEqual([]);
  });

  it('should refuse a value that is not a positive number, and say so once per route', () => {
    // Given the shapes a misconfigured decorator produces
    const collector = timeoutCollector({ metadataKey: KEY });
    if (isSkippedCollector(collector)) throw new Error('the key was usable');

    // When, Then: none becomes a fact, each is recorded
    for (const wrong of ['5000', -1, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(collector.collect(contextOf(wrong))).toBeUndefined();
    }
    expect(collector.problems()).toHaveLength(5);
    expect(collector.problems()[0]?.reason).toContain('is not a duration, so no timeout is known');
    expect(collector.problems()[0]?.action).toContain('positive number of milliseconds');
    expect(collector.problems()[0]?.detail).toContain('rather than a coerced value');
  });

  it('should decline to exist without a usable key, with the reason', () => {
    // Given the empty string a missing constant becomes after a bad import
    const collector = timeoutCollector({ metadataKey: '' });

    // Then
    expect(isSkippedCollector(collector)).toBe(true);
    if (isSkippedCollector(collector)) {
      expect(collector.skipped).toContain('metadataKey');
    }
  });
});

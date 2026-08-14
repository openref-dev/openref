import { describe, expect, it } from 'vitest';
import type { IRConfidence, IRFact, IRNode } from '@openref/core';
import {
  headersCollector,
  HEADERS_COLLECTOR_NAME,
} from '../../src/runtime/infrastructure/collectors/headers.collector';
import { isSkippedCollector } from '../../src/runtime/application/ports/collector.port';
import type { CollectorContext } from '../../src/runtime/application/ports/collector.port';
import type { HandlerLike, ReflectorLike } from '../../src/shared/types/nest-surface';

/**
 * `headersCollector`, held to the one distinction it exists for: the names are metadata, the
 * requiredness is a conclusion, so the fact is `inferred` and never higher, per SPEC 6.2.1.
 */

const KEY = 'app.requiredHeaders';

class OrdersController {
  receipt(): undefined {
    return undefined;
  }
}
const receipt: HandlerLike = function receipt() {
  return undefined;
};

/** A context whose reflector answers the headers key with one prepared value. */
function contextOf(value: unknown): CollectorContext {
  const reflector: ReflectorLike = {
    get: () => undefined,
    getAllAndOverride(key: unknown): unknown {
      return key === KEY ? value : undefined;
    },
  };

  return {
    node: { id: 'orders.receipt' } as unknown as IRNode,
    controller: OrdersController,
    declaredOn: OrdersController,
    handler: receipt,
    handlerName: 'receipt',
    reflector,
    moduleRef: { get: () => undefined },
    globalGuards: [],
    globalPipes: [],
    fact: <T>(held: T, confidence: IRConfidence): IRFact<T> => ({
      value: held,
      confidence,
      collector: HEADERS_COLLECTOR_NAME,
    }),
  };
}

describe('headersCollector', () => {
  it('should report the header names at inferred, and never higher', () => {
    // Given guard metadata naming one header
    const collector = headersCollector({ metadataKey: KEY });
    if (isSkippedCollector(collector)) throw new Error('the key was usable');

    // When
    const found = collector.collect(contextOf(['X-Internal-Token']));

    // Then the names are the fact and the requiredness claim is `inferred`: the metadata names
    // what the guard is about, and whether absence refuses is the guard's unread logic
    expect(found).toEqual({
      requiredHeaders: {
        value: ['X-Internal-Token'],
        confidence: 'inferred',
        collector: HEADERS_COLLECTOR_NAME,
      },
    });
  });

  it('should report nothing on a route with nothing under the key', () => {
    // Given
    const collector = headersCollector({ metadataKey: KEY });
    if (isSkippedCollector(collector)) throw new Error('the key was usable');

    // When, Then
    expect(collector.collect(contextOf(undefined))).toBeUndefined();
    expect(collector.problems()).toEqual([]);
  });

  it('should refuse a value that is not a non-empty list of strings', () => {
    // Given the wrong shapes, including the empty list, which asserts nothing
    const collector = headersCollector({ metadataKey: KEY });
    if (isSkippedCollector(collector)) throw new Error('the key was usable');

    // When, Then
    for (const wrong of ['X-Token', [], [42], { name: 'X-Token' }]) {
      expect(collector.collect(contextOf(wrong))).toBeUndefined();
    }
    expect(collector.problems()).toHaveLength(4);
    expect(collector.problems()[0]?.reason).toContain('non-empty list of header names');
  });

  it('should decline to exist without a usable key, with the reason', () => {
    // Given
    const collector = headersCollector({ metadataKey: '' });

    // Then
    expect(isSkippedCollector(collector)).toBe(true);
    if (isSkippedCollector(collector)) {
      expect(collector.skipped).toContain('metadataKey');
    }
  });
});

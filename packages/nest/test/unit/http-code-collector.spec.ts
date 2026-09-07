import { describe, expect, it } from 'vitest';
import type { IRConfidence, IRFact, IRNode } from '@openref/core';
import {
  httpCodeCollector,
  HTTP_CODE_COLLECTOR_NAME,
} from '../../src/runtime/infrastructure/collectors/http-code.collector';
import { NEST_HTTP_CODE_METADATA } from '../../src/shared/types/nest-surface';
import type { CollectorContext } from '../../src/runtime/application/ports/collector.port';
import type { HandlerLike, ReflectorLike } from '../../src/shared/types/nest-surface';

/**
 * `httpCodeCollector`, held to the boundary SPEC 6.2.1 draws: the explicit decorator is a fact,
 * the framework default is behaviour, and only the first is ever reported.
 */

class OrdersController {
  create(): undefined {
    return undefined;
  }
}
const create: HandlerLike = function create() {
  return undefined;
};

/** A context whose reflector holds one value under NestJS's own key, on the handler. */
function contextOf(value: unknown): CollectorContext {
  const reflector: ReflectorLike = {
    get(key: unknown, target: unknown): unknown {
      return key === NEST_HTTP_CODE_METADATA && target === create ? value : undefined;
    },
    getAllAndOverride: () => undefined,
  };

  return {
    node: { id: 'orders.create' } as unknown as IRNode,
    controller: OrdersController,
    declaredOn: OrdersController,
    handler: create,
    handlerName: 'create',
    reflector,
    moduleRef: { get: () => undefined },
    globalGuards: [],
    globalPipes: [],
    fact: <T>(held: T, confidence: IRConfidence): IRFact<T> => ({
      value: held,
      confidence,
      collector: HTTP_CODE_COLLECTOR_NAME,
    }),
  };
}

describe('httpCodeCollector', () => {
  it('should report the explicit code at derived', () => {
    // Given `@HttpCode(204)` on the handler
    const collector = httpCodeCollector();

    // When
    const found = collector.collect(contextOf(204));

    // Then
    expect(found).toEqual({
      statusCode: { value: 204, confidence: 'derived', collector: HTTP_CODE_COLLECTOR_NAME },
    });
  });

  it('should report nothing without the decorator, so the framework default stays behaviour', () => {
    // Given a route answering the POST default with no decorator saying so
    const collector = httpCodeCollector();

    // When, Then: no fact, which is what keeps SP012 quiet on every ordinary route
    expect(collector.collect(contextOf(undefined))).toBeUndefined();
    expect(collector.problems()).toEqual([]);
  });

  it('should refuse a value that is not an HTTP status code', () => {
    // Given
    const collector = httpCodeCollector();

    // When, Then
    for (const wrong of ['201', 99, 600, 200.5]) {
      expect(collector.collect(contextOf(wrong))).toBeUndefined();
    }
    expect(collector.problems()).toHaveLength(4);
    expect(collector.problems()[0]?.reason).toContain(
      'is not a status code, so no explicit status is known',
    );
    expect(collector.problems()[0]?.action).toContain('pass a status code to @HttpCode');
    expect(collector.problems()[0]?.detail).toContain(
      'would document a status this handler never answers with',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { hashDocument, normalizeOpenApiDocument } from '@openref/core';
import type { IRDocument } from '@openref/core';
import { runRuntimePass } from '../../src/runtime/application/services/runtime-pass.service';
import { NEST_ROUTE_METADATA } from '../../src/shared/types/nest-surface';
import type {
  DiscoveryServiceLike,
  ModuleRefLike,
  ReflectorLike,
} from '../../src/shared/types/nest-surface';
import type { IRuntimeCollector } from '../../src/runtime/application/ports/collector.port';
import { specification } from '../mocks/fixtures';

/**
 * The pass end to end, over the fixture document and a controller that serves it.
 *
 * THE HASH IS THE ASSERTION THAT MATTERS MOST HERE. Facts attached under the old hash would be
 * served from the SPEC 12 cache as the page from before the pass, forever, and nothing else in
 * the suite would notice: the document would be right, the page would be stale, and the two
 * would agree with each other.
 */

/** A controller that serves `GET /orders/{id}`, which is what the fixture document describes. */
class OrdersController {
  readOrder(): string {
    return 'an order';
  }
}

const prototype = OrdersController.prototype as unknown as Record<string, unknown>;

const metadata = new Map<unknown, Record<string, unknown>>([
  [OrdersController, { [NEST_ROUTE_METADATA.path]: 'orders' }],
  [prototype.readOrder, { [NEST_ROUTE_METADATA.method]: 0, [NEST_ROUTE_METADATA.path]: ':id' }],
]);

const reflector: ReflectorLike = {
  get: (key, target) => metadata.get(target)?.[String(key)] ?? undefined,
  getAllAndOverride: () => undefined,
};

const moduleRef: ModuleRefLike = { get: () => undefined };

const discovery: DiscoveryServiceLike = {
  getControllers: () => [{ metatype: OrdersController, instance: new OrdersController() }],
};

/** A collector that reports one scope, so there is something to look for in the IR. */
const scopes: IRuntimeCollector = {
  name: 'scopesCollector',
  collect: (context) => ({ scopes: context.fact(['orders:read'], 'declared') }),
};

function document(): IRDocument {
  return normalizeOpenApiDocument(specification());
}

describe('runRuntimePass', () => {
  it('should attach a collector fact to the node the handler serves', () => {
    // Given
    const before = document();

    // When
    const result = runRuntimePass(before, {
      collectors: [scopes],
      discovery,
      reflector,
      moduleRef,
    });

    // Then
    const node = [...result.document.nodes.values()][0];
    expect(node?.runtime?.scopes).toEqual({
      value: ['orders:read'],
      confidence: 'declared',
      collector: 'scopesCollector',
    });
    expect(result.nodesWithFacts).toBe(1);
  });

  it('should retake the document hash, because the cache is keyed by it', () => {
    // Given
    const before = document();

    // When
    const result = runRuntimePass(before, {
      collectors: [scopes],
      discovery,
      reflector,
      moduleRef,
    });

    // Then
    expect(result.document.hash).not.toBe(before.hash);
    expect(result.document.hash).toBe(hashDocument(result.document));
  });

  it('should record what the collectors were, so a reader can tell empty from unasked', () => {
    // Given
    const before = document();

    // When
    const result = runRuntimePass(before, {
      collectors: [scopes, { name: 'throttlerCollector', skipped: '@nestjs/throttler is absent' }],
      discovery,
      reflector,
      moduleRef,
      sourceLinkTemplate: 'https://host/blob/{ref}/{file}#L{line}',
      nestVersion: '11.1.28',
    });

    // Then
    expect(result.document.runtime).toEqual({
      collectors: ['scopesCollector', 'throttlerCollector'],
      nestVersion: '11.1.28',
      sourceLinkTemplate: 'https://host/blob/{ref}/{file}#L{line}',
      skipped: [{ collector: 'throttlerCollector', reason: '@nestjs/throttler is absent' }],
    });
  });

  it('should leave every node alone when no collector was registered', () => {
    // Given, a host that imports forRoot for `sourceLink` alone is the M1 default
    const before = document();

    // When
    const result = runRuntimePass(before, { collectors: [], discovery, reflector, moduleRef });

    // Then, the pairing still ran and still reports, and no node grew a runtime block
    expect(result.pairing.targets).toHaveLength(1);
    expect([...result.document.nodes.values()].every((node) => node.runtime === undefined)).toBe(
      true,
    );
    expect(result.nodesWithFacts).toBe(0);
  });

  it('should report an operation the application does not serve rather than dropping it', () => {
    // Given, a document describing an endpoint no controller answers
    const before = document();

    // When
    const result = runRuntimePass(before, {
      collectors: [scopes],
      discovery: { getControllers: () => [] },
      reflector,
      moduleRef,
    });

    // Then
    expect(result.pairing.nodesWithoutRoute).toHaveLength(1);
    expect(result.nodesWithFacts).toBe(0);
  });

  it('should keep the hash stable when it is run twice over the same application', () => {
    // Given, a deterministic pass is what makes the SPEC 12 cache survive a restart
    const first = runRuntimePass(document(), {
      collectors: [scopes],
      discovery,
      reflector,
      moduleRef,
    });

    // When
    const second = runRuntimePass(document(), {
      collectors: [scopes],
      discovery,
      reflector,
      moduleRef,
    });

    // Then
    expect(second.document.hash).toBe(first.document.hash);
  });
});

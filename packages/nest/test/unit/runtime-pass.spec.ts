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

/**
 * The Documentation Health report of SPEC 7.2, as the pass hangs it on the document.
 *
 * WHAT IS BEING GUARDED HERE IS THE INPUT TO `orphan-operation` AND NOT THE RULE ITSELF, which is
 * tested in `core` against hand built documents. The pass is the only thing that knows which nodes
 * the application actually serves, and getting that wrong does not produce a missing finding: it
 * produces a finding telling a reader to delete documentation that is correct.
 */
describe('runRuntimePass, the health report', () => {
  it('should hang a report on the document and take the hash over it', () => {
    // Given
    // When
    const result = runRuntimePass(document(), {
      collectors: [scopes],
      discovery,
      reflector,
      moduleRef,
    });

    // Then a document whose hash predates its own panel is a cache key that never changes
    expect(result.document.health?.operationCount).toBe(1);
    expect(result.document.hash).toBe(hashDocument(result.document));
  });

  it('should count the collector registry as a check of its own', () => {
    // Given a collector that declined, per SPEC 7
    const result = runRuntimePass(document(), {
      collectors: [scopes, { name: 'throttlerCollector', skipped: '@nestjs/throttler is absent' }],
      discovery,
      reflector,
      moduleRef,
    });

    // When
    const check = result.document.health?.checks[0];

    // Then a failed collector is a health check and never a drift finding, per SPEC 7
    expect(check).toEqual({
      id: 'runtime-collectors',
      label: 'Runtime collectors that ran',
      passed: 1,
      total: 2,
      severity: 'warning',
    });
    expect(result.document.health?.drift.some((issue) => issue.rule === 'orphan-operation')).toBe(
      false,
    );
  });

  it('should call a node with no handler an orphan', () => {
    // Given an application serving nothing the document describes
    const result = runRuntimePass(document(), {
      collectors: [scopes],
      discovery: { getControllers: () => [] },
      reflector,
      moduleRef,
    });

    // When
    const orphans = result.document.health?.drift.filter(
      (issue) => issue.rule === 'orphan-operation',
    );

    // Then
    expect(orphans).toHaveLength(1);
    expect(orphans?.[0]?.classification).toEqual({ bucket: 'contradiction' });
  });

  it('should not call a paired node an orphan just because no collector had anything to say', () => {
    // Given, THE MISTAKE THIS PINS IS READING `node.runtime` INSTEAD OF THE PAIRING. A route that
    // was found and that every collector declined to describe still has a handler, and a document
    // whose host registered no collectors would otherwise report every operation as removed.
    const result = runRuntimePass(document(), { collectors: [], discovery, reflector, moduleRef });

    // When
    const orphans = result.document.health?.drift.filter(
      (issue) => issue.rule === 'orphan-operation',
    );

    // Then
    expect(result.nodesWithFacts).toBe(0);
    expect(orphans).toEqual([]);
  });

  it('should carry the guard to scheme mapping through to security-drift', () => {
    // Given a guarded route, a document requiring a different scheme, and the host's mapping
    const guards: IRuntimeCollector = {
      name: 'guardsCollector',
      collect: () => ({
        guards: [{ name: 'JwtAuthGuard', confidence: 'derived', collector: 'guardsCollector' }],
      }),
    };
    const withSecurity = document();
    const secured = new Map(withSecurity.nodes);
    for (const [id, node] of secured) {
      if (node.kind === 'operation') {
        secured.set(id, { ...node, security: [{ schemeId: 'apiKey', scopes: [] }] });
      }
    }

    // When
    const result = runRuntimePass(
      { ...withSecurity, nodes: secured },
      {
        collectors: [guards],
        discovery,
        reflector,
        moduleRef,
        guardSecuritySchemes: { JwtAuthGuard: 'bearer' },
      },
    );

    // Then without the mapping this operation is quiet, because a guard class name names no scheme
    const found = result.document.health?.drift.filter((issue) => issue.rule === 'security-drift');
    expect(found).toHaveLength(1);
    expect(found?.[0]?.classification).toEqual({ bucket: 'contradiction' });
  });
});

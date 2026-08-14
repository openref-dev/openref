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
 * The other direction of the collector boundary, per SPEC 6.2 and the T031 amendment.
 *
 * The pass already freezes what a collector is GIVEN. This is about what it HANDS BACK.
 * `scopes`, `roles`, `rateLimit`, `streaming` and `source` are carried into the IR as the
 * collector's own objects: `stamp` sets the `collector` field and leaves `value` alone. A
 * collector that keeps a reference and edits it after boot changes what is served, after the
 * hash was taken, so no cache keyed by that hash ever notices.
 *
 * FROM T031 THE COLLECTOR CONTRACT IS PUBLISHED, which is what turns this from "our collectors
 * do not do that" into "the contract permits it and says nothing". The answer is the same
 * mechanism as the theme boundary: the document a reader is served is frozen, so the write is
 * refused by the value rather than by a rule the author has to have read.
 */

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
  getProviders: () => [],
};

function document(): IRDocument {
  return normalizeOpenApiDocument(specification());
}

/**
 * A collector written the way a hostile or careless third party one would be: it keeps the
 * array it handed over and edits it once the application has booted.
 */
function retainingCollector(): { collector: IRuntimeCollector; scopes: string[] } {
  const scopes = ['orders:read'];
  return {
    scopes,
    collector: {
      name: 'retainingCollector',
      collect: (context) => ({ scopes: context.fact(scopes, 'declared') }),
    },
  };
}

describe('a collector that keeps a reference to what it returned', () => {
  it('should be refused when it writes after the pass has finished', () => {
    // Given
    const { collector, scopes } = retainingCollector();
    runRuntimePass(document(), { collectors: [collector], discovery, reflector, moduleRef });

    // When
    const write = (): void => {
      scopes.push('orders:write');
    };

    // Then
    expect(write).toThrow(TypeError);
  });

  it('should leave the served document saying what the hash was taken over', () => {
    // Given
    const { collector, scopes } = retainingCollector();
    const result = runRuntimePass(document(), {
      collectors: [collector],
      discovery,
      reflector,
      moduleRef,
    });
    const hashAtBoot = result.document.hash;

    // When
    try {
      scopes.push('orders:write');
    } catch {
      // The refusal is asserted by the case above. What this one measures is the document.
    }

    // Then
    const node = [...result.document.nodes.values()][0];
    expect(node?.runtime?.scopes?.value).toEqual(['orders:read']);
    expect(result.document.hash).toBe(hashAtBoot);
    expect(result.document.hash).toBe(hashDocument(result.document));
  });

  it('should refuse a write to the fact wrapper as well as to the value inside it', () => {
    // Given
    const { collector } = retainingCollector();
    const result = runRuntimePass(document(), {
      collectors: [collector],
      discovery,
      reflector,
      moduleRef,
    });
    const node = [...result.document.nodes.values()][0];

    // When
    const rewriteProvenance = (): void => {
      const fact = node?.runtime?.scopes as { confidence: string } | undefined;
      if (fact === undefined) throw new Error('the fixture produced no scopes fact');
      fact.confidence = 'inferred';
    };

    // Then
    expect(rewriteProvenance).toThrow(TypeError);
    expect(node?.runtime?.scopes?.confidence).toBe('declared');
  });
});

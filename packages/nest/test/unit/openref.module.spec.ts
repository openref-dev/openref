import { describe, expect, it } from 'vitest';
import { ConfigError, InvalidOptionsError } from '@openref/core';
import { OpenRefModule } from '../../src/api/openref.module';
import { referenceRoutes } from '../../src/reference/domain/routes';
import { assetPlan, fakeExpressResponse, fakeHttpAdapter, specification } from '../mocks/fixtures';
import type { AssetPlan } from '../../src/assets/infrastructure/adapters/package-assets.adapter';
import type { FakeHttpAdapter } from '../mocks/fixtures';

/**
 * Setup against a fake application, with the asset plan supplied rather than read from disk.
 *
 * The bundle and the stylesheets are given as absolute paths in real use. Here they are the
 * fixture bytes, which is what keeps this a unit test: it asks whether the module registers
 * the right routes, not whether a theme package is installed.
 *
 * @param adapter - The fake NestJS adapter
 * @param plan - Asset plan to serve
 * @returns Nothing; the assertions read the adapter
 */
function setupAgainst(adapter: FakeHttpAdapter, plan: AssetPlan = assetPlan()): void {
  OpenRefModule.setup(
    '/docs',
    { getHttpAdapter: () => adapter },
    { document: specification(), highlight: false, assetPlan: plan },
  );
}

/**
 * Waits for an asynchronous handler to have written its reply.
 *
 * @param done - Whether the reply has arrived
 * @param timeoutMs - How long to keep asking
 */
async function settle(done: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!done() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('OpenRefModule.setup', () => {
  it('should register exactly the SPEC 13.3 route table, in order', () => {
    // Given
    const adapter = fakeHttpAdapter('express');

    // When
    setupAgainst(adapter);

    // Then
    expect(adapter.routes.map((route) => route.pattern)).toEqual(
      referenceRoutes('/docs').map((route) => route.pattern),
    );
  });

  it('should answer through the routes it registered', async () => {
    // Given
    const adapter = fakeHttpAdapter('express');
    setupAgainst(adapter);
    const reply = fakeExpressResponse();

    // When
    adapter.routes[0]?.handler({ params: {}, headers: {} }, reply);
    // Polled rather than given a fixed pause. Rendering a page loads the markdown renderer and
    // runs Vue's server renderer, and how long that takes depends on the machine and on
    // whether the run is instrumented for coverage. A fixed wait passes locally and fails in
    // CI, which is the worst kind of test.
    await settle(() => reply.statusCode !== 0);

    // Then
    expect(reply.statusCode).toBe(200);
    expect(String(reply.body)).toContain('<!DOCTYPE html>');
  });

  it('should register on Fastify just as readily', () => {
    // Given
    const adapter = fakeHttpAdapter('fastify');

    // When
    setupAgainst(adapter);

    // Then
    expect(adapter.routes).toHaveLength(referenceRoutes('/docs').length);
  });

  it('should refuse anything that is not the application', () => {
    // Given
    const notAnApp = {
      listen: () => {
        return undefined;
      },
    };

    // When
    const act = (): unknown =>
      OpenRefModule.setup('/docs', notAnApp as unknown as { getHttpAdapter: () => never }, {
        document: specification(),
      });

    // Then
    expect(act).toThrow(InvalidOptionsError);
  });

  it('should refuse a platform it cannot write a reply to, before registering anything', () => {
    // Given
    const adapter = fakeHttpAdapter('hapi');

    // When
    const act = (): void => {
      setupAgainst(adapter);
    };

    // Then
    expect(act).toThrow(ConfigError);
    expect(adapter.routes).toEqual([]);
  });

  it('should mount at the root when asked to', () => {
    // Given
    const adapter = fakeHttpAdapter('express');

    // When
    OpenRefModule.setup(
      '/',
      { getHttpAdapter: () => adapter },
      { document: specification(), highlight: false, assetPlan: assetPlan() },
    );

    // Then
    expect(adapter.routes.map((route) => route.pattern)).toContain('/:nodeId');
  });
});

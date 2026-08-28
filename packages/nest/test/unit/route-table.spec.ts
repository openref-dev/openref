import { describe, expect, it } from 'vitest';
import { mountRouteTable } from '../../src/api/route-table';
import { referenceRoutes } from '../../src/reference/domain/routes';
import { RouteAdmission } from '../../src/visibility/domain/admission';
import { createReferenceAdapter } from '../../src/http/infrastructure/adapters/reference-adapter.factory';
import { fakeHttpAdapter } from '../mocks/fixtures';
import type { ReferenceReply } from '../../src/http/application/ports/reference-http.port';

/**
 * The one loop that registers the route table, and the defect that made it one loop.
 *
 * `setup` READ THE METHOD AND `forRoot` DID NOT, so the proxy of SPEC 14.5 was registered as a
 * `GET` on every document `forRoot` mounted. The `POST` a page sends reached nothing, and the
 * route that did exist was the one route of the seventeen whose whole contract is a request body.
 * Both entry points now walk this function, and the case below fails the moment either of them
 * stops reading `method`.
 */

const ANSWER: ReferenceReply = { status: 200, headers: {}, body: 'ok' };

/**
 * Mounts the table on a fake adapter and reports what was registered.
 *
 * @param health - Whether the Documentation Health page answers
 * @returns The registered routes, as method and pattern pairs
 */
function registered(health = true): readonly { method: string; pattern: string }[] {
  const nest = fakeHttpAdapter('express');
  const adapter = createReferenceAdapter(nest, RouteAdmission.open());

  mountRouteTable(adapter, {
    basePath: '/docs',
    health,
    handle: () => Promise.resolve(ANSWER),
  });

  return nest.routes.map((route) => ({ method: route.method, pattern: route.pattern }));
}

describe('mountRouteTable', () => {
  it('should register the proxy on the method the table names, which is not GET', () => {
    // Given, SPEC 13.3 and the `method` field of the table: one route is a POST and it is `_proxy`
    const routes = registered();

    // When
    const proxy = routes.filter((route) => route.pattern === '/docs/_proxy');

    // Then
    expect(proxy).toEqual([{ method: 'post', pattern: '/docs/_proxy' }]);
  });

  it('should register every route of the table, on the method the table names', () => {
    // Given
    const expected = referenceRoutes('/docs').map((route) => ({
      method: route.method,
      pattern: route.pattern,
    }));

    // When
    const routes = registered();

    // Then
    expect(routes).toEqual(expected);
  });

  it('should leave the health page unregistered when a host turned it off', () => {
    // Given
    const on = registered(true);

    // When
    const off = registered(false);

    // Then, the page is gone and nothing else moved
    expect(on.some((route) => route.pattern === '/docs/health')).toBe(true);
    expect(off.some((route) => route.pattern === '/docs/health')).toBe(false);
    expect(off).toHaveLength(on.length - 1);
  });
});

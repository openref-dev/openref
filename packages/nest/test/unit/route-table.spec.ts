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
 * route that did exist was the one route in the table whose whole contract is a request body.
 * Both entry points now walk this function, and the case below fails the moment either of them
 * stops reading `method`.
 */

const ANSWER: ReferenceReply = { status: 200, headers: {}, body: 'ok' };

/** One mounting: the fake adapter's route log, and the node route that was handed back. */
interface Mounting {
  readonly routes: readonly { method: string; pattern: string }[];
  readonly registerNodeRoute: () => void;
  readonly read: () => readonly { method: string; pattern: string }[];
}

/**
 * Mounts the table on a fake adapter and reports what was registered.
 *
 * THE NODE ROUTE IS NOT REGISTERED BY THIS, since `T065`: it is handed back, and the caller
 * decides when. `read` is what the log says at the moment it is called, so a case can look before
 * and after.
 *
 * @param health - Whether the Documentation Health page answers
 * @returns The log, the deferred registration, and a reader of the log
 */
function mount(health = true): Mounting {
  const nest = fakeHttpAdapter('express');
  const adapter = createReferenceAdapter(nest, RouteAdmission.open());

  const registerNodeRoute = mountRouteTable(adapter, {
    basePath: '/docs',
    health,
    handle: () => Promise.resolve(ANSWER),
  });

  const read = (): readonly { method: string; pattern: string }[] =>
    nest.routes.map((route) => ({ method: route.method, pattern: route.pattern }));

  return { routes: read(), registerNodeRoute, read };
}

/**
 * Mounts the table and registers the node route at once, which is what a lone `setup` does.
 *
 * @param health - Whether the Documentation Health page answers
 * @returns The registered routes, as method and pattern pairs
 */
function registered(health = true): readonly { method: string; pattern: string }[] {
  const mounting = mount(health);
  mounting.registerNodeRoute();

  return mounting.read();
}

describe('mountRouteTable', () => {
  it('should register the proxy on both methods, so a GET is not read as a node id', () => {
    // Given, SPEC 13.3 as amended at T065: the envelope arrives in a POST, and the GET exists so
    // that opening the address is not answered by the node page route with "no operation of that
    // name" about an address that exists. It is the `mcp` precedent, one address to the left.
    const routes = registered();

    // When
    const proxy = routes.filter((route) => route.pattern === '/docs/_proxy');

    // Then
    expect(proxy).toEqual([
      { method: 'post', pattern: '/docs/_proxy' },
      { method: 'get', pattern: '/docs/_proxy' },
    ]);
  });

  /**
   * The deferral of SPEC 13.3, which is about a second mount rather than about this one.
   *
   * The bare parameter matches the whole first segment under the mount, including the mount point
   * of a reference nested inside it, and Express matches in registration order. So the parameter
   * is handed back rather than registered, and `MountedReferences` registers every deferred one
   * after the named routes of every mount in the process.
   */
  it('should hand the node page route back rather than registering it', () => {
    // Given
    const mounting = mount();

    // When
    const before = mounting.routes;
    mounting.registerNodeRoute();
    const after = mounting.read();

    // Then
    expect(before.some((route) => route.pattern === '/docs/:nodeId')).toBe(false);
    expect(after[after.length - 1]).toEqual({ method: 'get', pattern: '/docs/:nodeId' });
    expect(after).toHaveLength(before.length + 1);
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

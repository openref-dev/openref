import { describe, expect, it } from 'vitest';
import { InvalidOptionsError } from '@openref/core';
import { searchIndexHref, SEARCH_INDEX_SEGMENT as RENDERER_SEGMENT } from '@openref/render';
import {
  assetHref,
  normalizeRoute,
  referenceRoutes,
  SEARCH_INDEX_SEGMENT,
  type ReferenceRouteId,
} from '../../src/reference/domain/routes';

describe('normalizeRoute', () => {
  it('should drop a trailing slash so every path is built the same way', () => {
    // Given
    const written = '/docs/';

    // When
    const result = normalizeRoute(written);

    // Then
    expect(result).toBe('/docs');
  });

  it('should read the root as the empty base path', () => {
    // Given
    const written = ['/', '', '   '];

    // When
    const results = written.map((route) => normalizeRoute(route));

    // Then
    expect(results).toEqual(['', '', '']);
  });

  it('should refuse a route that does not start with a slash', () => {
    // Given
    const written = 'docs';

    // When
    const act = (): string => normalizeRoute(written);

    // Then
    expect(act).toThrow(InvalidOptionsError);
  });

  it('should refuse a route carrying a query, a fragment or a parameter', () => {
    // Given
    const written = ['/docs?v=1', '/docs#top', '/docs/:id'];

    // When
    const results = written.map((route) => {
      try {
        normalizeRoute(route);
        return 'accepted';
      } catch {
        return 'refused';
      }
    });

    // Then
    expect(results).toEqual(['refused', 'refused', 'refused']);
  });
});

describe('referenceRoutes', () => {
  it('should register the node page last, since Express matches in order', () => {
    // Given
    const routes = referenceRoutes('/docs');

    // When
    const last = routes[routes.length - 1];

    // Then
    expect(last).toEqual({ id: 'node', pattern: '/docs/:nodeId', method: 'get' });
  });

  it('should put every static path before the parameter that would swallow it', () => {
    // Given
    const routes = referenceRoutes('/docs');

    // When
    const nodeAt = routes.findIndex((route) => route.id === 'node');
    const staticAfter = routes
      .slice(nodeAt + 1)
      .filter((route) => !route.pattern.includes(':'))
      .map((route) => route.pattern);

    // Then
    expect(staticAfter).toEqual([]);
  });

  it('should answer the whole SPEC 13.3 set of this milestone', () => {
    // Given
    const routes = referenceRoutes('/docs');

    // When
    const patterns = routes.map((route) => route.pattern);

    // Then, the page family on bare segments and the machine family behind underscores, per
    // the 2026-08-14 amendment: `health` is the page and `_health` the liveness JSON, `service`
    // answers the card on a federated document per SPEC 15.3, and `_federation` is the live
    // snapshot registered on every mount so "not a federation" is tellable from "no route".
    expect(patterns).toEqual([
      '/docs',
      '/docs/',
      '/docs/openapi.json',
      '/docs/openapi.yaml',
      '/docs/asyncapi.json',
      '/docs/asyncapi.yaml',
      '/docs/_assets/:asset',
      '/docs/_search-index',
      '/docs/_navigation/:documentHash',
      '/docs/_health',
      '/docs/_federation',
      '/docs/health',
      '/docs/bench/:nodeId',
      '/docs/shapes/:schemaId',
      '/docs/states',
      '/docs/service/:serviceId',
      '/docs/_oauth/callback',
      '/docs/_proxy',
      '/docs/_bridge',
      '/docs/schema/:schemaId',
      '/docs/:nodeId',
    ]);
  });

  /**
   * The totality the case above cannot state, added by the pre-M4 review.
   *
   * That case pins eighteen patterns and would stay green with a nineteenth route id in the
   * union and no pattern registered for it. The dispatch in `reference.service.ts` is a switch
   * with no default, so a new id fails to compile there and the handler half is safe; nothing
   * held the registration half, which is an array a person writes by hand. An id with no pattern
   * is a route the service can answer and no router will ever call, which reads as a 404 from a
   * mounted module: working, wrong, and nothing goes red. The record below is total over
   * `ReferenceRouteId`, so a new id does not compile until it is listed here and then fails this
   * case until it is registered.
   */
  it('should register a pattern for every route id the union carries', () => {
    // Given the union, spelled out once
    const everyId: Record<ReferenceRouteId, true> = {
      overview: true,
      'openapi-json': true,
      'openapi-yaml': true,
      'asyncapi-json': true,
      'asyncapi-yaml': true,
      asset: true,
      'search-index': true,
      navigation: true,
      status: true,
      federation: true,
      health: true,
      bench: true,
      shapes: true,
      states: true,
      service: true,
      'oauth-callback': true,
      proxy: true,
      bridge: true,
      schema: true,
      node: true,
    };

    // When
    const registered = new Set(referenceRoutes('/docs').map((route) => route.id));

    // Then
    expect(Object.keys(everyId).filter((id) => !registered.has(id as ReferenceRouteId))).toEqual(
      [],
    );
  });

  it('should carry no wildcard, since the three routers spell one differently', () => {
    // Given
    const routes = referenceRoutes('/docs');

    // When
    const wildcards = routes.filter((route) => route.pattern.includes('*'));

    // Then
    expect(wildcards).toEqual([]);
  });

  it('should serve the overview at the root when mounted there', () => {
    // Given
    const routes = referenceRoutes('');

    // When
    const overview = routes.filter((route) => route.id === 'overview').map((r) => r.pattern);

    // Then
    expect(overview).toEqual(['/', '/']);
  });
});

describe('the search index address', () => {
  it('should be served at the one segment the fetching half builds its href from', () => {
    // Given the defect this constant was collapsed for at T042: the segment was written out three
    // times, here, in `page-plan.ts` of `@openref/static` and in `links.ts` of `@openref/render`,
    // and nothing compared any two of them. A drift is not a crash: the palette fetches a 404 and
    // falls open to the navigation rows, so the page works and full text search is simply gone.
    const routes = referenceRoutes('/docs');

    // When
    const served = routes.filter((route) => route.id === 'search-index').map((r) => r.pattern);

    // Then the route this package registers and the address the page asks for are one string,
    // and this package's own export is the renderer's binding rather than a copy that matches
    expect(SEARCH_INDEX_SEGMENT).toBe(RENDERER_SEGMENT);
    expect(served).toEqual([searchIndexHref('/docs')]);
  });
});

describe('assetHref', () => {
  it('should encode a name so it survives the url it is written into', () => {
    // Given
    const servedName = 'a b.0123456789abcdef.css';

    // When
    const result = assetHref('/docs', servedName);

    // Then
    expect(result).toBe('/docs/_assets/a%20b.0123456789abcdef.css');
  });
});

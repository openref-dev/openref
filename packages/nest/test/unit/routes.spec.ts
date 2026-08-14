import { describe, expect, it } from 'vitest';
import { InvalidOptionsError } from '@openref/core';
import { assetHref, normalizeRoute, referenceRoutes } from '../../src/reference/domain/routes';

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
    // the 2026-08-14 amendment: `health` is the page and `_health` the liveness JSON, and
    // `service` is registered and reserved so that "no services" is tellable from "no route".
    expect(patterns).toEqual([
      '/docs',
      '/docs/',
      '/docs/openapi.json',
      '/docs/openapi.yaml',
      '/docs/_assets/:asset',
      '/docs/_search-index',
      '/docs/_navigation/:documentHash',
      '/docs/_health',
      '/docs/health',
      '/docs/bench/:nodeId',
      '/docs/shapes/:schemaId',
      '/docs/states',
      '/docs/service/:serviceId',
      '/docs/_oauth/callback',
      '/docs/_proxy',
      '/docs/schema/:schemaId',
      '/docs/:nodeId',
    ]);
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

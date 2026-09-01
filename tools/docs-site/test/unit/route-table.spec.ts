import { describe, expect, it } from 'vitest';
import { referenceRoutes } from '@openref/nest';
import {
  DOCUMENTED_ROUTE,
  documentationSpecification,
  documentedRoutes,
  ROUTE_GROUPS,
  ROUTE_PROSE,
} from '../../src/index.ts';

/**
 * The documentation site's route table, held to the one the module really registers.
 *
 * THE ADDRESSES ARE NO LONGER TRANSCRIBED. `documentedRoutes` calls `referenceRoutes`, so the
 * paths and methods cannot drift by construction and what remains to reconcile is the prose:
 * one entry per route id, written by hand because nothing can write it.
 *
 * BOTH DIRECTIONS, BECAUSE ONE OF THEM IS THE FAILURE THAT MATTERS. A route the product gains
 * and the site never documents is a page that quietly describes less than the product does. The
 * type catches that at compile time; this file catches it at run time as well, and catches the
 * other direction, prose for a route that no longer exists, which the type cannot see.
 */

/** The two normalizations `DOCUMENTED_ROUTES` states, applied to the router's own list. */
function normalizedRouterTable(): readonly string[] {
  const seen = new Set<string>();

  for (const route of referenceRoutes(DOCUMENTED_ROUTE)) {
    const braced = route.pattern.replace(/:([A-Za-z][A-Za-z0-9]*)/g, '{$1}');
    // The mount with a trailing slash is the same path item as the mount.
    const path = braced === `${DOCUMENTED_ROUTE}/` ? DOCUMENTED_ROUTE : braced;
    seen.add(`${route.id} ${route.method} ${path}`);
  }

  return [...seen].sort();
}

/** The site's table, in the same spelling. */
function documentedTable(): readonly string[] {
  return [
    ...new Set(
      documentedRoutes().map(
        (route) => `${route.id} ${route.method} ${DOCUMENTED_ROUTE}${route.suffix}`,
      ),
    ),
  ].sort();
}

describe('the documented route table', () => {
  it('should be present before anything is proved about it', () => {
    // Given the router's own list
    const router = normalizedRouterTable();

    // Then it is not empty, so an equality below cannot pass by comparing nothing
    expect(router.length).toBeGreaterThan(20);
    expect(documentedTable().length).toBe(router.length);
  });

  it('should name every route the module registers, and no route it does not', () => {
    // Given
    const router = normalizedRouterTable();

    // When
    const documented = documentedTable();

    // Then
    expect(documented).toEqual(router);
  });

  it('should carry prose for every route id', () => {
    // Given
    const ids = [...new Set(documentedRoutes().map((route) => route.id))];

    // Then
    expect(ids.length).toBeGreaterThan(20);
    for (const id of ids) {
      expect(ROUTE_PROSE[id].summary.length).toBeGreaterThan(0);
      expect(ROUTE_PROSE[id].description.length).toBeGreaterThan(40);
    }
  });

  it('should put every route in a declared group, and leave no group empty', () => {
    // Given
    const used = new Set(Object.values(ROUTE_PROSE).map((prose) => prose.tag));

    // Then, both directions: no prose invents a group, and no declared group is unused
    expect([...used].sort()).toEqual([...ROUTE_GROUPS].sort());
  });

  it('should produce one path item per address, with both methods of the agent endpoint', () => {
    // Given
    const specification = documentationSpecification() as {
      paths: Record<string, Record<string, unknown>>;
    };

    // When
    const agent = specification.paths[`${DOCUMENTED_ROUTE}/mcp`];

    // Then
    expect(agent).toBeDefined();
    expect(Object.keys(agent ?? {}).sort()).toEqual(['get', 'parameters', 'post']);
  });

  it('should declare a path parameter for every brace in an address', () => {
    // Given
    const specification = documentationSpecification() as {
      paths: Record<string, { parameters?: { name: string }[] }>;
    };

    // Then
    for (const [path, item] of Object.entries(specification.paths)) {
      const braces = [...path.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map(([, name]) => name);
      expect((item.parameters ?? []).map((parameter) => parameter.name)).toEqual(braces);
    }
  });
});

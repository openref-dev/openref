import { describe, expect, it } from 'vitest';
import { InvalidOptionsError, normalizeSpecification, operationNodeId } from '@openref/core';
import {
  nodeSegmentOf,
  RESERVED_MOUNT_SEGMENTS,
  searchIndexHref,
  SEARCH_INDEX_SEGMENT as RENDERER_SEGMENT,
} from '@openref/render';
import {
  assertMountsDoNotCollide,
  assetHref,
  collidingMountRoutes,
  normalizeRoute,
  referenceRoutes,
  SEARCH_INDEX_SEGMENT,
  type ReferenceRouteId,
} from '../../src/reference/domain/routes';

/**
 * Every name a mount claims under its own root, sorted, written out once.
 *
 * IT IS SPELLED OUT RATHER THAN DERIVED, because a list derived from the table cannot tell the
 * table it grew: a route added with a new first segment would simply extend both sides of the
 * comparison and nothing would go red. The case that compares this to the table is what makes a
 * new reserved name a decision somebody takes rather than a name a node quietly loses.
 */
const RESERVED_SEGMENTS: readonly string[] = [
  '_assets',
  '_bridge',
  '_federation',
  '_health',
  '_navigation',
  '_oauth',
  '_proxy',
  '_search-index',
  'asyncapi.json',
  'asyncapi.yaml',
  'bench',
  'health',
  'llms-full.txt',
  'llms.txt',
  'mcp',
  'openapi.json',
  'openapi.yaml',
  'schema',
  'service',
  'shapes',
  'states',
];

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
      // `_proxy` appears twice, once per method, for the reason `mcp` does below: the envelope
      // arrives in a POST, and the GET exists so the address is not answered by the node page.
      '/docs/_proxy',
      '/docs/_proxy',
      '/docs/_bridge',
      // The agent surface of SPEC 18.1, from T058. `mcp` appears twice, once per method: the
      // JSON-RPC body arrives in a POST, and the GET exists so that opening the address in a
      // client is not answered by the node page route with "no operation of that name".
      '/docs/llms.txt',
      '/docs/llms-full.txt',
      '/docs/mcp',
      '/docs/mcp',
      '/docs/schema/:schemaId',
      '/docs/:nodeId',
    ]);
  });

  it('should register the MCP address on both methods, so a GET is not read as a node id', () => {
    // Given
    const routes = referenceRoutes('/docs');

    // When
    const methods = routes.filter((route) => route.id === 'mcp').map((route) => route.method);

    // Then
    expect(methods).toEqual(['post', 'get']);
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
      llms: true,
      'llms-full': true,
      mcp: true,
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

  /**
   * The names a mount occupies under its own root, and the other half of the ordering rule.
   *
   * SPEC 13.3 as amended at `T065` states both directions. One is that the bare parameter must not
   * swallow a named route, which the table settles by order and `MountedReferences` settles across
   * mounts. The other is that a named route stands in front of the parameter, so a node whose id
   * were one of these names would have a page nothing could open: the route answers first.
   */
  it('should occupy exactly the twenty one names SPEC 13.3 lists under the mount', () => {
    // Given
    const routes = referenceRoutes('/docs');

    // When, the first segment under the mount of every route that has one
    const occupied = [
      ...new Set(
        routes
          .map((route) => route.pattern.slice('/docs/'.length).split('/')[0] ?? '')
          .filter((segment) => segment !== '' && !segment.startsWith(':')),
      ),
    ].sort();

    // Then, and the renderer's own copy is the same list rather than one that matches: it is what
    // `nodeSegmentOf` escapes against, and it sits below the server, the links and the static build
    expect(occupied).toEqual(RESERVED_SEGMENTS);
    expect([...RESERVED_MOUNT_SEGMENTS].sort()).toEqual(RESERVED_SEGMENTS);
  });

  /**
   * THE DOOR THAT IS SHUT, and it is the one the first writing of this mistook for the only one.
   *
   * A method key written directly on a Path Item Object is read only when it is one of the nine the
   * specification enumerates, so `_search` there produces no operation at all and the reserved name
   * cannot be assembled that way. That is still worth a case, because it is what makes the two
   * doors distinguishable: this one is shut by the normalizer, and the one below is not.
   */
  it('should not be reachable through a method key written on the path item itself', () => {
    // Given a document trying to claim three reserved names by path, one of them through a method
    // key the specification does not enumerate
    const document = {
      openapi: '3.1.0',
      info: { title: 'Reserved', version: '1.0.0' },
      paths: {
        '/health': { get: { responses: { '200': { description: 'ok' } } } },
        '/states': { get: { responses: { '200': { description: 'ok' } } } },
        '/index': { _search: { responses: { '200': { description: 'ok' } } } },
      },
    };

    // When
    const ids = [...normalizeSpecification(document).nodes.keys()];

    // Then the subject is expressible, the unenumerated key produced nothing, and no id collides
    expect(ids).toEqual([operationNodeId('get', '/health'), operationNodeId('get', '/states')]);
    expect(ids.filter((id) => RESERVED_SEGMENTS.includes(id))).toEqual([]);
  });

  /**
   * THE DOOR THAT IS OPEN, found by a blind review after the first writing declared it shut.
   *
   * `additionalOperations` is OpenAPI 3.2's member for exactly the methods the nine do not cover,
   * so it reads a non-standard key deliberately, and `operationNodeId` then writes `_search-index`
   * from `_search` and `/index`. Measured on both adapters before the escape existed:
   * `/docs/_search-index` answered the search index JSON and that node's page was unreachable.
   * The document is legal, so it is escaped rather than refused, and both addresses answer.
   */
  it('should escape a node id that additionalOperations makes equal to a reserved name', () => {
    // Given the legal 3.2 document that claims one
    const document = {
      openapi: '3.2.0',
      info: { title: 'Reserved', version: '1.0.0' },
      paths: {
        '/index': {
          additionalOperations: { _search: { responses: { '200': { description: 'ok' } } } },
        },
      },
    };

    // When
    const ids = [...normalizeSpecification(document).nodes.keys()];

    // Then the id really is the reserved name, which is the subject asserted present, and the
    // segment a link and a server both spell for it is not
    expect(ids).toEqual(['_search-index']);
    expect(RESERVED_SEGMENTS).toContain('_search-index');
    expect(nodeSegmentOf('_search-index')).toBe('_u005f_search-index');
    expect(RESERVED_SEGMENTS).not.toContain(nodeSegmentOf('_search-index'));
  });

  it('should leave every ordinary node id exactly as it was, which is most of them', () => {
    // Given the ids the ordinary producers write
    const ordinary = ['get-orders', 'post-orders-id-items', 'channel-orders-created', 'a_b'];

    // When
    const segments = ordinary.map((id) => nodeSegmentOf(id));

    // Then the escape is a whole name rule and touches nothing else
    expect(segments).toEqual(ordinary);
  });

  it('should be unreachable by every node id an AsyncAPI document can produce', () => {
    // Given a document whose channel addresses are reserved names verbatim
    const document = {
      asyncapi: '3.0.0',
      info: { title: 'Reserved', version: '1.0.0' },
      channels: {
        a: { address: 'health' },
        b: { address: '_proxy' },
        c: { address: 'llms.txt' },
      },
    };

    // When
    const ids = [...normalizeSpecification(document).nodes.keys()];

    // Then
    expect(ids).toHaveLength(3);
    expect(ids.filter((id) => RESERVED_SEGMENTS.includes(id))).toEqual([]);
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

/**
 * The third direction of SPEC 13.3's shadowing rule, which is a refusal rather than an order.
 *
 * MEASURED ON BOTH ADAPTERS BEFORE IT EXISTED. `route: '/docs/health'` beside `setup('/docs')`
 * booted on express, serving the enclosing Documentation Health page while the nested mount
 * silently lost its overview, and threw `FastifyError: Method 'GET' already declared for route
 * '/docs/health'` on fastify. Both sides are static, so no registration order settles it.
 */
describe('assertMountsDoNotCollide', () => {
  it('should admit a mount nested on a bare segment, which the deferral makes work', () => {
    // Given the supported shape, asserted before anything is refused
    const mounts = [
      { id: 'http', basePath: '/docs' },
      { id: 'events', basePath: '/docs/events' },
    ];

    // When
    const act = (): void => {
      assertMountsDoNotCollide(mounts);
    };

    // Then
    expect(act).not.toThrow();
  });

  /**
   * Twenty of the twenty one, and the twenty first is admitted because it is measured safe.
   *
   * `_oauth` IS THE EXCEPTION AND IT IS NOT AN OVERSIGHT. The enclosing table's only route under it
   * is `/docs/_oauth/callback`, a static two segment address, and a mount at `/docs/_oauth` answers
   * nothing literally called `callback` except through its own node parameter, which is excluded on
   * both sides. Measured on both adapters 2026-09-03 with that mount configured beside
   * `setup('/docs')`: no throw anywhere, and `/docs`, `/docs/_oauth`, `/docs/_oauth/openapi.json`,
   * `/docs/_oauth/health` and `/docs/_oauth/callback` all answer 200 on express and on fastify
   * alike. There is no divergence to refuse, so refusing it would be a rule with no defect under it.
   */
  it('should refuse a mount on twenty of the twenty one reserved names', () => {
    // Given each of the twenty one names in turn, under an enclosing mount
    const refused = RESERVED_SEGMENTS.filter((segment) => {
      try {
        assertMountsDoNotCollide([
          { id: 'outer', basePath: '/docs' },
          { id: 'inner', basePath: `/docs/${segment}` },
        ]);
        return false;
      } catch {
        return true;
      }
    });

    // Then every one of them but the one both adapters agree about
    expect(refused).toEqual(RESERVED_SEGMENTS.filter((segment) => segment !== '_oauth'));
    expect(refused).toHaveLength(20);
  });

  it('should refuse a mount on a parameterized route of an enclosing mount', () => {
    // Given, which is the same divergence one segment deeper: express keeps the enclosing bench
    // page and fastify ranks the nested static mount above it
    const act = (): void => {
      assertMountsDoNotCollide([
        { id: 'outer', basePath: '/docs' },
        { id: 'inner', basePath: '/docs/bench/x' },
      ]);
    };

    // Then
    expect(act).toThrow(InvalidOptionsError);
  });

  it('should refuse two mounts on one address, whichever order they were written in', () => {
    // Given
    const forward = (): void => {
      assertMountsDoNotCollide([
        { id: 'a', basePath: '/docs' },
        { id: 'b', basePath: '/docs' },
      ]);
    };
    const backward = (): void => {
      assertMountsDoNotCollide([
        { id: 'b', basePath: '/docs/health' },
        { id: 'a', basePath: '/docs' },
      ]);
    };

    // Then, the pair is checked in both directions because "enclosing" is a fact about the paths
    expect(forward).toThrow(InvalidOptionsError);
    expect(backward).toThrow(InvalidOptionsError);
  });

  it('should name both mounts and the colliding route, since a refusal is a diagnosis', () => {
    // Given
    const act = (): void => {
      assertMountsDoNotCollide([
        { id: 'outer', basePath: '/docs' },
        { id: 'inner', basePath: '/docs/health' },
      ]);
    };

    // Then
    expect(act).toThrow(/"inner"/);
    expect(act).toThrow(/"outer"/);
    expect(act).toThrow(/"\/docs\/health"/);
  });

  it('should leave two references that do not enclose each other alone', () => {
    // Given
    const act = (): void => {
      assertMountsDoNotCollide([
        { id: 'a', basePath: '/docs' },
        { id: 'b', basePath: '/reference' },
        { id: 'c', basePath: '/docs/events' },
      ]);
    };

    // Then
    expect(act).not.toThrow();
  });
});

describe('collidingMountRoutes', () => {
  it('should exclude the node route, which is the one the deferral puts last', () => {
    // Given a mount reached only through the enclosing node parameter
    const nested = collidingMountRoutes('/docs', '/docs/events');

    // When, a mount on a name the table occupies
    const named = collidingMountRoutes('/docs', '/docs/health');

    // Then the legal nesting is silent and the collision names both sides
    expect(nested).toBeUndefined();
    expect(named).toEqual(['/docs/health', '/docs/health']);
  });

  it('should find a collision deeper than the mount point, which is where seven of them are', () => {
    // Given `/docs/bench`, whose own overview no enclosing named route answers
    const collision = collidingMountRoutes('/docs', '/docs/bench');

    // Then the pair is the enclosing bench page against a machine route of the nested mount
    expect(collision?.[0]).toBe('/docs/bench/:nodeId');
    expect(collision?.[1]).toMatch(/^\/docs\/bench\//);
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

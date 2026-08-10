/**
 * The route table of SPEC 13.3, as data.
 *
 * One place decides what is served where, for the same reason `links.ts` in `@openref/render`
 * decides where a page lives: the server has to answer at exactly the paths the rendered
 * navigation links to, and a disagreement between the two is a broken link that neither side's
 * own tests would notice.
 *
 * EVERY PATTERN IS MADE OF STATIC SEGMENTS AND SINGLE SEGMENT PARAMETERS, with no wildcard
 * anywhere. That is a compatibility decision rather than a style: Express 4 routes `'*'`,
 * Express 5 refuses it and wants `'*splat'`, and Fastify wants `'/*'`. NestJS 10 carries the
 * first and NestJS 11 the second, and SPEC 23 supports both. A named parameter means the same
 * thing in all three, so the table has one spelling instead of a per adapter dialect.
 *
 * ORDER IS PART OF THE TABLE. Express matches in registration order, so the node page, whose
 * pattern is a bare parameter, has to be registered after every static route it would
 * otherwise swallow. Fastify ranks static segments above parameters and does not care, which
 * is precisely why the order has to be right here rather than left to the router.
 */

import { ErrorCode, InvalidOptionsError } from '@openref/core';

/** Segment under which hashed static assets are served. */
export const ASSET_SEGMENT = '_assets';

/** Segment serving the serialized search index. */
export const SEARCH_INDEX_SEGMENT = '_search-index';

/** Segment serving the health report. */
export const HEALTH_SEGMENT = 'health';

/** Name of the parameter carrying an asset file name. */
export const ASSET_PARAM = 'asset';

/** Name of the parameter carrying a node id. */
export const NODE_PARAM = 'nodeId';

/** Name of the parameter carrying a schema id. */
export const SCHEMA_PARAM = 'schemaId';

/** What a route answers with. */
export type ReferenceRouteId =
  | 'overview'
  | 'openapi-json'
  | 'openapi-yaml'
  | 'asset'
  | 'search-index'
  | 'health'
  | 'schema'
  | 'node';

/** One registered route. */
export interface ReferenceRoute {
  readonly id: ReferenceRouteId;
  /** Absolute path pattern, in the `:name` parameter dialect both adapters share. */
  readonly pattern: string;
}

/**
 * Normalizes the mount point a host asked for.
 *
 * @param route - Mount point as written by the host, such as `/docs`
 * @returns The same path with a leading slash and no trailing one, `''` for the root
 * @throws {InvalidOptionsError} When the route is not a plausible mount point
 */
export function normalizeRoute(route: string): string {
  const trimmed = route.trim();

  if (trimmed === '' || trimmed === '/') return '';

  if (!trimmed.startsWith('/')) {
    throw new InvalidOptionsError(
      `the reference route must start with a slash, received "${route}"`,
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { route },
    );
  }

  if (trimmed.includes('?') || trimmed.includes('#') || trimmed.includes(':')) {
    throw new InvalidOptionsError(
      `the reference route must be a plain path, received "${route}"`,
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { route },
    );
  }

  return trimmed.replace(/\/+$/, '');
}

/**
 * The route table for one mount point, in registration order.
 *
 * The overview appears twice, with and without a trailing slash. Express treats the two as
 * one route and Fastify does not, so registering both is what makes `/docs/` work on Fastify
 * without asking a host to turn on `ignoreTrailingSlash` for the whole application.
 *
 * @param basePath - Mount point, already normalized
 * @returns Routes in the order they must be registered
 */
export function referenceRoutes(basePath: string): readonly ReferenceRoute[] {
  const at = (suffix: string): string => `${basePath}${suffix}`;

  return [
    { id: 'overview', pattern: basePath === '' ? '/' : basePath },
    { id: 'overview', pattern: at('/') },
    { id: 'openapi-json', pattern: at('/openapi.json') },
    { id: 'openapi-yaml', pattern: at('/openapi.yaml') },
    { id: 'asset', pattern: at(`/${ASSET_SEGMENT}/:${ASSET_PARAM}`) },
    { id: 'search-index', pattern: at(`/${SEARCH_INDEX_SEGMENT}`) },
    { id: 'health', pattern: at(`/${HEALTH_SEGMENT}`) },
    { id: 'schema', pattern: at(`/schema/:${SCHEMA_PARAM}`) },
    { id: 'node', pattern: at(`/:${NODE_PARAM}`) },
  ];
}

/**
 * Path of one asset, as the shell writes it into the document.
 *
 * @param basePath - Mount point, already normalized
 * @param servedName - Hashed file name from the asset catalog
 * @returns Absolute path of the asset
 */
export function assetHref(basePath: string, servedName: string): string {
  return `${basePath}/${ASSET_SEGMENT}/${encodeURIComponent(servedName)}`;
}

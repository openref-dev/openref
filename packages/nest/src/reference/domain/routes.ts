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
import {
  FEDERATION_SEGMENT,
  PROXY_SEGMENT,
  SEARCH_INDEX_SEGMENT,
  SERVICE_SEGMENT,
} from '@openref/render';

/** Segment under which hashed static assets are served. */
export const ASSET_SEGMENT = '_assets';

/**
 * Segment serving the serialized search index.
 *
 * DEFINED IN `links.ts` OF `@openref/render` SINCE `T042`, on the `PROXY_SEGMENT` precedent and for
 * a defect that had already happened three times over. The address was spelled out here, in
 * `page-plan.ts` of `@openref/static` as the file a build writes, and in `links.ts` as the href the
 * palette fetches, and nothing compared any two of them: three unconnected literals for one url,
 * where a drift in any one of them is a palette that fetches a 404 and silently falls back to the
 * navigation rows, which is a working page and therefore a defect nothing goes red on.
 * `@openref/render` is the floor all three surfaces may reach, per STANDARDS 3.5, and it is where
 * the fetching half already lives. Re-exported so this package's public surface is unchanged.
 */
export { SEARCH_INDEX_SEGMENT } from '@openref/render';

/**
 * Segment serving the whole navigation, addressed by document hash.
 *
 * It mirrors `navigationHref` in `@openref/render`, which is what the page fetches, for the
 * same reason every other route here mirrors `links.ts`: two spellings of one path is a broken
 * link that neither side's tests would see. `routes.spec.ts` compares the two.
 */
export const NAVIGATION_SEGMENT = '_navigation';

/**
 * Segment serving the machine readable liveness answer, per SPEC 13.3 as amended 2026-08-14.
 *
 * IT WAS THE BARE `health` UNTIL `TX-FRAME`, and the move is the page family taking the name
 * the layout gave it: `health` is the Documentation Health page now, and one address never
 * answers two ways by request header, which is the preserved half of the 2026-08-11 decision.
 * The underscore is the machine endpoint convention every other fetched segment here follows.
 */
export const STATUS_SEGMENT = '_health';

/** Segment of the Documentation Health page, per SPEC 7.3 as amended 2026-08-14. */
export const HEALTH_PAGE_SEGMENT = 'health';

/** Segment of the bench page: the console on its own address, addressed by node. */
export const BENCH_SEGMENT = 'bench';

/** Segment of the shapes showcase, addressed by schema. */
export const SHAPES_SEGMENT = 'shapes';

/** Segment of the states showcase. */
export const STATES_SEGMENT = 'states';

/**
 * Segment of the federated service card, per SPEC 13.3 and 15.3.
 *
 * IT WAS RESERVED FROM M2 AND ANSWERED WITH WORDS UNTIL M4, by the `_proxy` precedent: a route
 * that exists only when federation is mounted makes "no services" and "no such address" the
 * same 404 from outside. Since `T046` it answers the card on a document that carries
 * `services`, and a 404 with words otherwise; since the pre-M5 cleanup the 404 itself says
 * which fact holds, "not a federation" or "no such service", per SPEC 13.3, because a reader
 * acts on the two differently.
 *
 * DEFINED IN `links.ts` OF `@openref/render` SINCE `T046`, by the `PROXY_SEGMENT` precedent:
 * the navigation's service groups link the address, and two spellings of one path is the
 * broken link `links.ts` exists to prevent. Re-exported so this package's surface is unchanged.
 */
export { SERVICE_SEGMENT, FEDERATION_SEGMENT } from '@openref/render';

/**
 * Segments an authorization server returns a reader to, per SPEC 13.3 and 14.4.
 *
 * TWO SEGMENTS AND NOT A WILDCARD, for the reason the header of this file gives about Express 4,
 * Express 5 and Fastify disagreeing on how a wildcard is spelled. The path is fixed anyway: it is
 * registered with the provider, so it cannot vary per operation.
 */
export const OAUTH_SEGMENT = '_oauth';

/** Segment of the OAuth2 redirect uri, under {@link OAUTH_SEGMENT}. */
export const OAUTH_CALLBACK_SEGMENT = 'callback';

/**
 * Segment the same origin proxy of SPEC 14.5 answers on.
 *
 * REGISTERED ON EVERY MOUNT, INCLUDING THE ONES WHERE THE PROXY IS OFF, and the reason is that
 * "off" has to be something a request can be told. A route that exists only when the proxy is
 * enabled makes the two states indistinguishable from outside: a 404 is what a mount with no
 * proxy answers and also what a mount whose proxy route failed to register answers. This one
 * answers 403 with the reason, which is a fact about the deployment rather than about the url.
 *
 * DEFINED IN `links.ts` OF `@openref/render` SINCE `T040`, because the static build of SPEC 16.2
 * writes its rewrite rules under the same segment and cannot see this package. Re-exported here
 * so this package's public surface is unchanged.
 */
export { PROXY_SEGMENT } from '@openref/render';

/**
 * Segment the broker bridge of SPEC 14.8 answers on.
 *
 * REGISTERED ON EVERY MOUNT, INCLUDING THE ONES WHERE THE BRIDGE IS OFF, by the `_proxy` precedent
 * this file states one entry above: a route that exists only when a feature is on makes "off" and
 * "no such address" the same 404 from outside. This one answers 403 with the reason.
 *
 * DECLARED HERE AND NOT IN `links.ts` OF `@openref/render`, which is the opposite of `_proxy`,
 * `_search-index`, `service` and `_federation`, and the difference is measured rather than
 * stylistic. Those four are addresses a page links or fetches, so two spellings of one path is a
 * broken link; nothing in the shipped bundle addresses this one, because SPEC 14.7 recorded the
 * interactive console as a debt against 40 bytes of stylesheet headroom and SPEC 14.8 puts the
 * reader's indicator in the stream instead of on a page. The day a page fetches it, the constant
 * moves for the reason the others did.
 */
export const BRIDGE_SEGMENT = '_bridge';

/** Name of the parameter carrying an asset file name. */
export const ASSET_PARAM = 'asset';

/** Name of the parameter carrying a node id. */
export const NODE_PARAM = 'nodeId';

/** Name of the parameter carrying a schema id. */
export const SCHEMA_PARAM = 'schemaId';

/** Name of the parameter carrying the document hash a navigation payload is asked for by. */
export const NAVIGATION_PARAM = 'documentHash';

/** Name of the parameter carrying a federated service id, per SPEC 15.3. */
export const SERVICE_PARAM = 'serviceId';

/** What a route answers with. */
export type ReferenceRouteId =
  | 'overview'
  | 'openapi-json'
  | 'openapi-yaml'
  | 'asyncapi-json'
  | 'asyncapi-yaml'
  | 'asset'
  | 'search-index'
  | 'navigation'
  | 'status'
  | 'federation'
  | 'health'
  | 'bench'
  | 'shapes'
  | 'states'
  | 'service'
  | 'oauth-callback'
  | 'proxy'
  | 'bridge'
  | 'schema'
  | 'node';

/** How a route is reached. */
export type ReferenceRouteMethod = 'get' | 'post';

/** One registered route. */
export interface ReferenceRoute {
  readonly id: ReferenceRouteId;
  /** Absolute path pattern, in the `:name` parameter dialect both adapters share. */
  readonly pattern: string;
  /**
   * The method it answers on.
   *
   * ONE ROUTE IS NOT A `GET` AND IT IS THE PROXY. Everything else here is a document addressed by
   * its path, which is what made the method implicit until M2. The proxy takes a request in its
   * body, so it is a `POST`, and the field exists rather than being inferred from the id because
   * the registration loop reads it.
   */
  readonly method: ReferenceRouteMethod;
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
    { id: 'overview', pattern: basePath === '' ? '/' : basePath, method: 'get' },
    { id: 'overview', pattern: at('/'), method: 'get' },
    { id: 'openapi-json', pattern: at('/openapi.json'), method: 'get' },
    { id: 'openapi-yaml', pattern: at('/openapi.yaml'), method: 'get' },
    // THE EVENT DOCUMENT'S OWN ADDRESSES, per SPEC 13.3, registered on every mount by the
    // `_proxy` precedent: on an HTTP mount they answer 404 with words, so "this reference
    // describes no events" is a fact a request can learn rather than a missing address, and an
    // events document is never served under a name that says OpenAPI.
    { id: 'asyncapi-json', pattern: at('/asyncapi.json'), method: 'get' },
    { id: 'asyncapi-yaml', pattern: at('/asyncapi.yaml'), method: 'get' },
    { id: 'asset', pattern: at(`/${ASSET_SEGMENT}/:${ASSET_PARAM}`), method: 'get' },
    { id: 'search-index', pattern: at(`/${SEARCH_INDEX_SEGMENT}`), method: 'get' },
    { id: 'navigation', pattern: at(`/${NAVIGATION_SEGMENT}/:${NAVIGATION_PARAM}`), method: 'get' },
    { id: 'status', pattern: at(`/${STATUS_SEGMENT}`), method: 'get' },
    // The live federation snapshot of SPEC 15.3, registered on every mount by the `_proxy`
    // precedent: on a single service mount it answers 404 with words, so "not a federation"
    // is a fact a request can learn rather than a missing address.
    { id: 'federation', pattern: at(`/${FEDERATION_SEGMENT}`), method: 'get' },
    { id: 'health', pattern: at(`/${HEALTH_PAGE_SEGMENT}`), method: 'get' },
    { id: 'bench', pattern: at(`/${BENCH_SEGMENT}/:${NODE_PARAM}`), method: 'get' },
    { id: 'shapes', pattern: at(`/${SHAPES_SEGMENT}/:${SCHEMA_PARAM}`), method: 'get' },
    { id: 'states', pattern: at(`/${STATES_SEGMENT}`), method: 'get' },
    { id: 'service', pattern: at(`/${SERVICE_SEGMENT}/:${SERVICE_PARAM}`), method: 'get' },
    {
      id: 'oauth-callback',
      pattern: at(`/${OAUTH_SEGMENT}/${OAUTH_CALLBACK_SEGMENT}`),
      method: 'get',
    },
    { id: 'proxy', pattern: at(`/${PROXY_SEGMENT}`), method: 'post' },
    // The broker bridge of SPEC 14.8, registered on every mount by the `_proxy` precedent: with
    // the bridge off it answers 403 with the reason, so "off" is a fact a request can learn.
    { id: 'bridge', pattern: at(`/${BRIDGE_SEGMENT}`), method: 'get' },
    { id: 'schema', pattern: at(`/schema/:${SCHEMA_PARAM}`), method: 'get' },
    { id: 'node', pattern: at(`/:${NODE_PARAM}`), method: 'get' },
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

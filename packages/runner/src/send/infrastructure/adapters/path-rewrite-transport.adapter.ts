/**
 * The path rewrite transport of SPEC 16.2: address the rule the static build generated, on this
 * page's own origin, and let the platform put the request on the wire.
 *
 * WHY THE ENVELOPE PROXY CANNOT SERVE THIS AND A SECOND ADAPTER HAS TO EXIST. `ProxyHttpTransport`
 * POSTs `{method, url, headers, body}` to one route, and the route is a handler that reads the
 * envelope and decides. A Netlify redirect, a Vercel rewrite, an nginx `location` and a CloudFront
 * behaviour read none of that: they match a path and concatenate what is left of it onto a pinned
 * base. So the request has to BE the request, at the address the rule matches, which is what this
 * adapter builds.
 *
 * THE PINNED LIST IS THE WHOLE OF THE REACH, per SPEC 19.9. The build wrote one rule per upstream
 * at `<prefix>/u<N>/`, indexed by position, and this transport resolves a request url against the
 * same list in the same order, so the browser and the rule agree on which rule serves the request.
 * A url that matches nothing is refused rather than sent direct: the point of a static console
 * under a proxy is that it cannot address a host the deployment did not pin, and a fallback to
 * direct mode would be that guarantee quietly not holding.
 *
 * THE SUFFIX GUARD IS THE CLIENT HALF OF A SERVER SIDE REFUSAL. `SUFFIX_GUARD_LINES` in
 * `@openref/static` is emitted verbatim into the Nitro route, the Pages Function and the
 * CloudFront function, and THAT is the enforcement: a platform is what stands between a request
 * and the pinned base, and nothing a browser does can be trusted to have happened. The two
 * expressions below are the same two, duplicated deliberately because STANDARDS 3.5 gives
 * `@openref/runner` no edge to `@openref/static` and neither may see the other. What the copy
 * buys is that this transport cannot form a request the platform would answer 403 to, and that on
 * a platform whose rewrite is lax the client did not contribute the climb.
 *
 * A BODY OF BYTES IS SENT RATHER THAN REFUSED, which is the opposite of the envelope proxy and is
 * honest for the same reason the refusal there is. There is no JSON envelope to squeeze a file
 * through: the plan's body goes to `fetch` exactly as direct mode hands it over, and the platform
 * forwards the bytes it received. A multipart upload through a generated rule is an ordinary
 * request.
 *
 * THE SEND ITSELF IS THE DIRECT TRANSPORT'S, OVER A REWRITTEN PLAN, and that composition is a
 * policy decision rather than a saving. What comes back here is a real response from a real API,
 * not a proxy envelope a documentation server already bounded, so it needs the time bound and the
 * size bound of SPEC 14.1: a rule that forwards ten gigabytes is F8 arriving through a rewrite.
 * `FetchHttpTransport` owns both bounds, the `credentials: 'omit'` rule and the abort mapping, and
 * one implementation of those is what keeps this path from drifting away from the one that is
 * tested hardest.
 */

import { ErrorCode, RunnerError } from '@openref/core';
import { isHttpUrl, refusesPathSuffix } from '@openref/core/security';
import type { RequestPlan } from '../../../request/domain/request-plan';
import type {
  IHttpTransport,
  TransportResponse,
} from '../../application/ports/http-transport.port';
import { FetchHttpTransport, type FetchLike } from './fetch-transport.adapter';

/** How the path rewrite transport is built. */
export interface PathRewriteTransportOptions {
  /**
   * Absolute path every generated rule lives under, such as `/docs/_proxy`.
   *
   * A PATH AND NOT A URL, for the reason `ProxyTransportOptions.endpoint` gives: the one thing
   * this transport must never do is send to another origin, and a path cannot name one.
   */
  readonly prefix: string;
  /**
   * The upstreams the build pinned, in the `u<N>` order the rules index them by.
   *
   * The index into this list is the `<N>` of the rule, so the order is part of the contract
   * between the generated configuration and this transport, not a presentation detail.
   */
  readonly upstreams: readonly string[];
  /**
   * The implementation to call. Defaults to the global `fetch`.
   *
   * THE ONLY KNOB, AND THE TIME AND SIZE BOUNDS ARE DELIBERATELY NOT ONES. SPEC 14.1's limits
   * belong to the transport that does the sending, which is the direct one, and a second place
   * to set them would be a second policy for one request. This adapter is constructed by
   * `createPageRunner` and by tests, and neither has anything to say about them.
   */
  readonly fetch?: FetchLike;
}

/** Where one request url landed in the pinned list. */
interface PinnedMatch {
  /** Index into the pinned list, which is the `<N>` of the rule. */
  readonly index: number;
  /** Path below the upstream's base path, with no leading slash. */
  readonly rest: string;
  /** The query as it will be sent, `''` when there is none. */
  readonly search: string;
}

/**
 * Finds the first pinned upstream that serves a url, in `u<N>` order.
 *
 * FIRST MATCH WINS BECAUSE THE RULES ARE ORDERED. Every generated format matches its rules in
 * the order they were written, so two upstreams that overlap, an origin and a path under it,
 * are served by the earlier rule whatever this function would prefer. Agreeing with that is the
 * whole reason this walks the list rather than picking the longest base path.
 *
 * A URL THAT DOES NOT PARSE, OR PARSES TO ANOTHER SCHEME, IS ONE MORE URL NO RULE SERVES rather
 * than a case of its own. A relative server such as `/api` is this site's own origin, which
 * `planUpstreams` pins nothing for, and a `ws:` server is a scheme no route rewrite can carry.
 * Both leave the reader in the same position, with a server this deployment cannot reach, so both
 * take the same refusal.
 *
 * @param upstreams - The pinned upstreams, in `u<N>` order
 * @param requested - The request url as `buildRequest` resolved it
 * @returns Where it landed, or null when no pinned upstream serves it
 */
function pinnedMatch(upstreams: readonly string[], requested: string): PinnedMatch | null {
  const url = absoluteHttp(requested);
  if (url === null) return null;

  for (const [index, upstream] of upstreams.entries()) {
    const base = absoluteHttp(upstream);
    if (base?.origin !== url.origin) continue;

    // ORIGIN PLUS BASE PATH, EXACTLY AS THE RULES PIN THEM. An upstream of
    // `https://api.example.com/v1` serves `/v1` and everything under it and nothing else, because
    // that is what its rule concatenates onto. A prefix comparison alone would let `/v11` through
    // to a rule that would then address `/v1/1`.
    const basePath = base.pathname.replace(/\/+$/, '');
    const servesPath =
      basePath === '' || url.pathname === basePath || url.pathname.startsWith(`${basePath}/`);
    if (!servesPath) continue;

    return {
      index,
      rest: url.pathname.slice(basePath.length).replace(/^\//, ''),
      search: url.search,
    };
  }

  return null;
}

/**
 * A url as an absolute http(s) `URL`, or null when it is neither.
 *
 * @param url - The request url, or an upstream
 * @returns The parsed url, or null
 */
function absoluteHttp(url: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  return isHttpUrl(parsed) ? parsed : null;
}

/**
 * How a refused request names its server, which is the origin and never the url.
 *
 * A PLAN'S URL CARRIES ANY apiKey THE DOCUMENT DECLARES `in: query`, per SPEC 14.2, and a refusal
 * is rendered into the page. A message quoting the url would print the credential beside it.
 *
 * @param url - The request url
 * @returns The origin, or a phrase for a url that names no http host
 */
function serverOf(url: string): string {
  return absoluteHttp(url)?.origin ?? 'a server with no absolute http host';
}

/**
 * Whether the generated guard would refuse this suffix.
 *
 * @param rest - The path below the upstream's base path
 * @returns True when the request must not be formed
 */
function refusedSuffix(rest: string): boolean {
  return refusesPathSuffix(rest);
}

/** Sends through the generated rewrite rules rather than straight to the API. */
export class PathRewriteHttpTransport implements IHttpTransport {
  private readonly prefix: string;
  private readonly upstreams: readonly string[];
  private readonly inner: FetchHttpTransport;

  /**
   * @param options - The prefix, the pinned upstreams and how to reach them
   * @throws {RunnerError} When the prefix is not a path on this origin
   */
  constructor(options: PathRewriteTransportOptions) {
    if (!options.prefix.startsWith('/') || options.prefix.startsWith('//')) {
      throw new RunnerError(
        `the proxy prefix must be an absolute path on this origin, received '${options.prefix}'`,
        ErrorCode.CONFIG_INVALID_OPTIONS,
        undefined,
        { prefix: options.prefix },
      );
    }

    this.prefix = options.prefix;
    this.upstreams = options.upstreams;
    this.inner = new FetchHttpTransport(
      options.fetch === undefined ? {} : { fetch: options.fetch },
    );
  }

  /**
   * @param plan - The request as `buildRequest` resolved it
   * @returns What the API answered, through the rule that serves its upstream
   * @throws {RunnerError} When no pinned upstream serves the url, or when the path below it is
   *         one the generated guard refuses
   */
  async send(plan: RequestPlan): Promise<TransportResponse> {
    const match = pinnedMatch(this.upstreams, plan.url);

    if (match === null) {
      throw new RunnerError(
        `the servers this page can reach are the ${String(this.upstreams.length)} its build ` +
          `pinned a proxy rule for; ${serverOf(plan.url)} is not one`,
        ErrorCode.RUN_PROXY_HOST_BLOCKED,
        undefined,
        { upstreams: [...this.upstreams] },
      );
    }

    if (refusedSuffix(match.rest)) {
      throw new RunnerError(
        'the proxy rules refuse a path with a dot segment or an ambiguous percent encoding, ' +
          'either of which can climb above the upstream the rule pinned',
        ErrorCode.RUN_PROXY_HOST_BLOCKED,
        undefined,
        { rest: match.rest },
      );
    }

    // THE TRAILING SLASH IS ALWAYS WRITTEN, and it is what makes an empty suffix addressable. Every
    // generated rule matches `<prefix>/u<N>/` plus a remainder, so `<prefix>/u<N>` on its own
    // matches no rule and would be answered by the site's own 404 rather than by the API's root.
    const url = `${this.prefix}/u${String(match.index)}/${match.rest}${match.search}`;

    return this.inner.send({ ...plan, url });
  }
}

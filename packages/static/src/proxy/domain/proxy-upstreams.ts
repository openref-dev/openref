/**
 * The pinned upstreams of SPEC 16.2, derived from `servers[]` at build time.
 *
 * THE DERIVATION IS THE SECURITY PROPERTY. Every host a generated rule can ever reach is
 * decided here, from the document alone, before anything is deployed; the client contributes a
 * path suffix and nothing else, which is why the SSRF class disappears by construction. So this
 * module is strict about what counts as an upstream: an absolute http(s) url whose every
 * variable resolves from a declared `enum`, and nothing softer. Anything it cannot pin is
 * skipped with a warning naming the reason, never guessed at, per SPEC 6.
 */

import { addressRefusal, isAddressLiteral, isHttpUrl } from '@openref/core';
import type { IRServer, IRServerVariable } from '@openref/core';

/**
 * Greatest number of upstreams one server template may expand to.
 *
 * PER SPEC 16.2: a rule is generated per unique upstream and the product of `enum` lengths is
 * bounded by nothing else, so without a limit a hostile document buys arbitrarily large
 * generation. Fifty hosts for one logical server is already beyond any documentation this
 * project has seen; a template above it is skipped whole, with the product in the warning,
 * rather than truncated to an arbitrary subset that would silently pin some hosts and not
 * others.
 */
export const UPSTREAM_EXPANSION_LIMIT = 50;

/**
 * Greatest number of upstreams one document may pin in total.
 *
 * THE LIMIT ABOVE BOUNDS A TEMPLATE AND THE REASON IT GIVES IS ABOUT THE TOTAL, which is the gap
 * `T043` measured: a document multiplies templates as freely as it multiplies enum values, so
 * forty servers each under the per template cap pinned two thousand upstreams and a thousand
 * pinned fifty thousand. A 379 KB specification produced a 1.69 MB Cloudflare Pages Function in
 * 0.8 seconds, over that platform's own script limit, and the build reported success. Five
 * hundred is above every real document, above the two hundred the adversarial task names as its
 * stress case, and far below the size at which a generated artefact stops being one a platform
 * will take. A document above it pins nothing, with the number in the warning, for the reason a
 * template above its own cap pins nothing: a silently pinned subset is worse than none.
 */
export const UPSTREAM_TOTAL_LIMIT = 500;

/** What planning the upstreams of one document produced. */
export interface UpstreamPlan {
  /**
   * How many upstreams were materialised before the plan was answered.
   *
   * REPORTED SO THE BOUND CAN BE ASSERTED RATHER THAN TIMED. `T043`'s verification found the test
   * for the total limit asserting a duration against a budget set at about twice the mutated
   * figure, which stays green on a machine that is merely fast; a test that passes for a reason
   * that is not the property is not a test of the property. This is the property: the number of
   * entries the expansion ever held, which the limit exists to bound.
   */
  readonly materialized: number;
  /**
   * The pinned upstreams: absolute http(s) urls, origin plus path with no trailing slash,
   * deduplicated, in first seen order. The index into this list is the `u<N>` of every rule.
   */
  readonly upstreams: readonly string[];
  /** One sentence per server that could not be pinned, naming which and why. */
  readonly warnings: readonly string[];
}

/** Matches one `{variable}` of a server url template. */
const VARIABLE_PATTERN = /\{([^{}]+)\}/g;

/**
 * Derives the pinned upstreams from a document's servers.
 *
 * @param servers - `IRDocument.servers`, as the normalizer produced them
 * @returns The upstreams and the warnings for everything that is not one
 */
export function planUpstreams(servers: readonly IRServer[]): UpstreamPlan {
  const upstreams: string[] = [];
  const seen = new Set<string>();
  const warnings: string[] = [];

  for (const server of servers) {
    const resolved = resolveServer(server);

    if (typeof resolved === 'string') {
      if (resolved !== '') warnings.push(resolved);
      continue;
    }

    for (const url of resolved) {
      if (seen.has(url)) continue;
      seen.add(url);
      upstreams.push(url);

      // COUNTED WHILE EXPANDING, NOT AFTER. A limit checked over a finished list bounds the
      // output and not the memory the list took, which is half of what the limit is for.
      if (upstreams.length > UPSTREAM_TOTAL_LIMIT) return refuseTotal(warnings, upstreams.length);
    }
  }

  return { upstreams, warnings, materialized: upstreams.length };
}

/**
 * The plan a document above {@link UPSTREAM_TOTAL_LIMIT} gets: nothing pinned, and the limit said.
 *
 * @param warnings - What was already warned about
 * @returns The refusing plan
 */
function refuseTotal(warnings: readonly string[], materialized: number): UpstreamPlan {
  return {
    upstreams: [],
    materialized,
    warnings: [
      ...warnings,
      `no proxy rules were generated: this document's servers pin more than ` +
        `${String(UPSTREAM_TOTAL_LIMIT)} upstreams in total, and pinning a subset silently would ` +
        'be worse than pinning none',
    ],
  };
}

/**
 * Resolves one server template into its upstreams.
 *
 * @param server - The server
 * @returns The upstream urls, or a warning sentence, or `''` for a relative server, which is
 *   this site's own origin already and so is neither an upstream nor a defect
 */
function resolveServer(server: IRServer): readonly string[] | string {
  const names = [...new Set([...server.url.matchAll(VARIABLE_PATTERN)].map((match) => match[1]))];

  const enums: [string, readonly string[]][] = [];
  let product = 1;

  for (const name of names) {
    if (name === undefined) continue;

    const variable: IRServerVariable | undefined = server.variables?.[name];
    const values = variable?.enum;

    if (values === undefined || values.length === 0) {
      return (
        `the server "${server.url}" was skipped: the variable "${name}" declares no enum, so ` +
        'the hosts it can name are an open set and cannot be pinned at build time'
      );
    }

    enums.push([name, values]);
    product *= values.length;
  }

  if (product > UPSTREAM_EXPANSION_LIMIT) {
    return (
      `the server "${server.url}" was skipped: its enums expand to ${String(product)} ` +
      `upstreams, above the limit of ${String(UPSTREAM_EXPANSION_LIMIT)}, and pinning a subset ` +
      'silently would be worse than pinning none'
    );
  }

  const urls: string[] = [];

  for (const values of assignments(enums)) {
    let url = server.url;
    for (const [name, value] of values) url = url.replaceAll(`{${name}}`, value);

    const upstream = asUpstream(url);
    if (upstream === null) {
      // A RELATIVE URL IS THIS ORIGIN, NOT A DEFECT, per SPEC 16.2 and the T004-R1 reasoning:
      // `/` names no host, a direct request already reaches it, and a proxy to oneself is a
      // rule nobody needs. A scheme relative url does name another host, but without a scheme
      // to pin, and pinning a guessed one is the substitution SPEC 6 forbids. Anything absolute
      // but not http(s) cannot be reached by a route rewrite. Both of those are warned about.
      if (url.startsWith('//')) {
        return (
          `the server "${server.url}" was skipped: "${url}" is scheme relative, and an ` +
          'upstream cannot be pinned to a guessed scheme'
        );
      }
      if (isAbsoluteNonHttp(url)) {
        return (
          `the server "${server.url}" was skipped: "${url}" is not an http(s) url, and a ` +
          'route rewrite cannot reach any other scheme'
        );
      }
      return '';
    }

    const infrastructure = infrastructureHost(upstream);
    if (infrastructure !== null) {
      return (
        `the server "${server.url}" was skipped: "${upstream}" is ${infrastructure}, and a ` +
        'generated rule for it would be a public gateway to infrastructure the reader deploys ' +
        'on rather than to an API'
      );
    }

    const unsafe = unsafeUpstreamCharacter(upstream);
    if (unsafe !== null) {
      return (
        `the server "${server.url}" was skipped: the resolved upstream "${upstream}" carries ` +
        `"${unsafe}", which at least one generated format reads as an injection or a route ` +
        'placeholder, and one document plans one set of upstreams for every target'
      );
    }

    urls.push(upstream);
  }

  return urls;
}

/**
 * Host names that answer for the machine rather than for an API.
 *
 * THE WELL KNOWN METADATA ENDPOINTS BY NAME, because a name resolves to the same place an address
 * does and the document is free to write either.
 */
const METADATA_HOST = new Set([
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'metadata.azure.com',
]);

/**
 * What kind of infrastructure address an upstream names, or null when it names none.
 *
 * THE HOLE §16.2 THOUGHT IT HAD CLOSED. "The SSRF class disappears by construction" is true about
 * the client: the reader's request cannot choose a host. It is not true about the document, and
 * the document is the part this project did not write. `T043`'s verification measured a
 * specification whose `servers` named `169.254.169.254`, `metadata.google.internal` and
 * `100.100.100.200` producing eight rules and no warning at all, which is an anonymous public
 * gateway to an instance's credential endpoint, deployed on the reader's own infrastructure by a
 * tool the reader trusted.
 *
 * SKIPPED RATHER THAN COMMENTED, because a comment in a generated file is read after the
 * deployment and the rule answers from the first second of it.
 *
 * @param upstream - The pinned upstream url
 * @returns A noun phrase naming what it is, or null
 */
export function infrastructureHost(upstream: string): string | null {
  let host: string;
  try {
    host = new URL(upstream).hostname.toLowerCase();
  } catch {
    return null;
  }

  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

  // A NAME RATHER THAN AN ADDRESS IS STILL ANSWERED BY NAME, because a hostname resolves at
  // deployment time and there is nothing to inspect here. The set is the published metadata
  // names plus the one this project has already met.
  if (METADATA_HOST.has(host)) return 'a well known cloud metadata host';
  if (host === 'localhost') return 'a loopback address';

  // AND AN ADDRESS IS ANSWERED BY THE ONE POLICY, NOT BY A SECOND LIST OF RANGES. Until the
  // pre-M4 review this function was a hand written denylist beside an allowlist of address space
  // whose own header explains why a denylist is wrong, and the two disagreed on 17 addresses
  // measured, including the mapped form of the metadata address this function was written to
  // refuse. `addressRefusal` answers the opposite question, which is the one that stays right as
  // registries allocate: an address is refused unless it is global unicast.
  if (isAddressLiteral(bare)) {
    const refusal = addressRefusal(bare);
    if (refusal !== null) return refusal;
  }

  return null;
}

/**
 * Every combination of enum values, in declared order, first variable slowest.
 *
 * @param enums - Variable names with their declared values
 * @returns Each assignment as name value pairs
 */
function assignments(
  enums: readonly (readonly [string, readonly string[]])[],
): readonly (readonly (readonly [string, string])[])[] {
  let combinations: (readonly [string, string])[][] = [[]];

  for (const [name, values] of enums) {
    combinations = combinations.flatMap((combination) =>
      values.map((value) => [...combination, [name, value] as const]),
    );
  }

  return combinations;
}

/**
 * The upstream form of one resolved url, or null when it is not an absolute http(s) url.
 *
 * Origin plus path, query and fragment dropped, trailing slash removed, so `https://a/` and
 * `https://a` are one upstream and path joining is uniform in every generator.
 *
 * @param url - The resolved server url
 * @returns The upstream, or null
 */
function asUpstream(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (!isHttpUrl(parsed)) return null;

  const path = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${path}`;
}

/**
 * Characters an upstream path may not carry into a generated configuration.
 *
 * EACH ONE IS READ AS SYNTAX BY AT LEAST ONE TARGET FORMAT, and the refusal is uniform across
 * targets so one document plans one set of upstreams everywhere. A quote breaks out of a
 * generated string literal in the two executable artefacts; `$` expands as a variable in an
 * nginx rewrite replacement, which would splice request facts such as `$http_cookie` into the
 * upstream path; an unquoted `;` terminates an nginx directive; `:` starts a route placeholder
 * in a Netlify `_redirects` destination and in a Vercel rewrite, whose own validator rejects a
 * destination placeholder the source does not bind, so the deploy fails after the build said
 * it was fine. The WHATWG URL parser already percent encodes space, `"`, `{`, `}` and
 * backslash, so these four are what remains legal in a parsed path and hostile in a config.
 */
const UNSAFE_PATH_CHARACTERS = /['$;]/;

/**
 * The colon of the placeholder refusal, checked against the path alone: the origin carries a
 * colon structurally in the scheme and the port, and no generated format reads either as a
 * placeholder, so refusing it over the whole upstream would refuse every upstream there is.
 */
const PLACEHOLDER_CHARACTER = ':';

/**
 * The unsafe character in an upstream, or null when it is clean.
 *
 * @param upstream - The pinned upstream url
 * @returns The character, or null
 */
export function unsafeUpstreamCharacter(upstream: string): string | null {
  const match = UNSAFE_PATH_CHARACTERS.exec(upstream);
  if (match !== null) return match[0];

  let path: string;
  try {
    path = new URL(upstream).pathname;
  } catch {
    // Not a parseable url, so there is no origin to exempt: the whole string is the path.
    path = upstream;
  }

  return path.includes(PLACEHOLDER_CHARACTER) ? PLACEHOLDER_CHARACTER : null;
}

/** Whether a url parses as absolute with a scheme this proxy cannot carry. */
function isAbsoluteNonHttp(url: string): boolean {
  try {
    const parsed = new URL(url);
    return !isHttpUrl(parsed);
  } catch {
    return false;
  }
}

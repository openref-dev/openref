/**
 * Where the proxy is allowed to send a request, derived from the document and from nothing else.
 *
 * AN EMPTY ALLOWLIST MEANS THE PROXY IS OFF, NOT OPEN, and that sentence is the whole of SPEC
 * 14.5's first clause. It is written here as the first branch rather than as a note, because the
 * shape a hurried implementation reaches for is a loop over the entries that refuses nothing when
 * there are none, and the state it produces is an open proxy on a document that declares no
 * servers. That is the default state of a document without a `servers` block, which is to say the
 * one a reader is most likely to be in.
 *
 * THE CLIENT NEVER NAMES A HOST, IT NAMES A URL THAT HAS TO ALREADY BE IN THE LIST. The difference
 * matters: a proxy that takes a target and checks it is one thing to get right, a proxy that takes
 * an index into a server list is another, and this is the first. What makes it safe is that the
 * list comes from the document the server itself normalized, so a page cannot add to it, and that
 * the match is on origin and path prefix rather than on a substring of the url.
 */

/** One place the proxy may reach, as an origin and the path everything under it hangs off. */
export interface AllowedTarget {
  /** Scheme, host and port, exactly as `URL.origin` writes it. */
  readonly origin: string;
  /** Path prefix, without a trailing slash, `''` for a server at the root. */
  readonly basePath: string;
  /** The server url this entry came from, for a message that names what the document said. */
  readonly server: string;
}

/** What the allowlist became, and what could not be read into it. */
export interface ProxyAllowlist {
  readonly targets: readonly AllowedTarget[];
  /**
   * Server urls that produced no entry, with the reason.
   *
   * REPORTED RATHER THAN DROPPED, because a server url that is a template or a relative path is a
   * server the console can name and the proxy cannot reach, and the two disagreeing silently is
   * how a reader gets a refusal with nothing in it to act on.
   */
  readonly ignored: readonly { readonly server: string; readonly reason: string }[];
}

/**
 * Builds the allowlist from the servers a document declares.
 *
 * @param servers - Server urls, document level and operation level alike
 * @returns The targets the proxy may reach, and the servers it could not read
 *
 * @example
 * buildAllowlist(['https://api.example.com/v1']);
 */
export function buildAllowlist(servers: readonly string[]): ProxyAllowlist {
  const targets: AllowedTarget[] = [];
  const ignored: { server: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const server of servers) {
    let url: URL;
    try {
      url = new URL(server);
    } catch {
      ignored.push({
        server,
        reason:
          'it is not an absolute url. A relative server is the same origin as the page already, ' +
          'and a templated one names no host until the template is filled in',
      });
      continue;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      ignored.push({ server, reason: `its scheme is ${url.protocol} and the proxy speaks http` });
      continue;
    }

    if (url.username !== '' || url.password !== '') {
      ignored.push({
        server,
        reason: 'it carries credentials in the url, which the proxy will not send anywhere',
      });
      continue;
    }

    const basePath = url.pathname.replace(/\/+$/, '');
    const key = `${url.origin}${basePath}`;
    if (seen.has(key)) continue;
    seen.add(key);

    targets.push({ origin: url.origin, basePath, server });
  }

  return { targets, ignored };
}

/** Why a target was refused, or the entry that admitted it. */
export type TargetDecision =
  | { readonly allowed: true; readonly target: AllowedTarget; readonly url: URL }
  | { readonly allowed: false; readonly reason: string };

/**
 * Decides whether one url is inside the allowlist.
 *
 * @param allowlist - What the document declared
 * @param candidate - The url the page asked the proxy to send to
 * @returns The entry that admitted it, or the reason it was refused
 */
export function decideTarget(allowlist: ProxyAllowlist, candidate: string): TargetDecision {
  // THE FIRST BRANCH, AND IT IS THE ONE THIS FILE EXISTS FOR. With no entries there is nothing to
  // compare against, and a comparison against nothing has to refuse rather than fall through.
  if (allowlist.targets.length === 0) {
    return {
      allowed: false,
      reason:
        'this document declares no server the proxy can reach, so the proxy is off. An empty ' +
        'allowlist refuses every request rather than permitting them',
    };
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { allowed: false, reason: `'${candidate}' is not a url` };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { allowed: false, reason: `the scheme ${url.protocol} is not one the proxy speaks` };
  }

  if (url.username !== '' || url.password !== '') {
    return { allowed: false, reason: 'the url carries credentials, which the proxy will not send' };
  }

  for (const target of allowlist.targets) {
    if (url.origin !== target.origin) continue;

    // A PREFIX ON SEGMENT BOUNDARIES AND NOT ON CHARACTERS. `/v1` must not admit `/v10`, which a
    // `startsWith` on its own does, and that is a different API on the same host.
    if (target.basePath !== '') {
      const path = url.pathname;
      if (path !== target.basePath && !path.startsWith(`${target.basePath}/`)) continue;
    }

    return { allowed: true, target, url };
  }

  return {
    allowed: false,
    reason:
      `${url.origin}${url.pathname} is not under any server this document declares: ` +
      allowlist.targets.map((target) => `${target.origin}${target.basePath}`).join(', '),
  };
}

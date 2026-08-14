/**
 * What crosses the proxy in each direction, and what is left behind.
 *
 * THE HEADERS THE PROXY REMOVES ARE THE ONES THAT DESCRIBE THE HOP RATHER THAN THE REQUEST.
 * `Host` names the server the browser was talking to, which is this documentation server and not
 * the API, so forwarding it asks the API to answer as somebody else; it is exactly the header a
 * virtual host routes on, so a forwarded one turns a proxy into a way to reach an internal site by
 * name. `X-Forwarded-*` is worse, because it is trusted: an application that reads
 * `X-Forwarded-For` to decide who is calling reads whatever the browser wrote, and an application
 * that reads `X-Forwarded-Proto` to decide whether the connection was secure can be told it was.
 *
 * COOKIES ARE OFF BY DEFAULT, PER SPEC 19.10, AND THAT IS A DECISION ABOUT WHOSE COOKIES THEY ARE.
 * The page is served by the documentation host, so the cookies a browser attaches to a request to
 * it belong to that host and to the session of whoever is reading. Forwarding them by default
 * would take a reader's session with the documentation site and hand it to whatever the document
 * declared as a server. The switch exists because a cookie parameter is something SPEC 14.2 does
 * define and a browser refuses to set, and the proxy is the only place that request can be made
 * at all.
 */

/** Headers that describe the connection rather than the message, per RFC 9110. */
const HOP_BY_HOP: ReadonlySet<string> = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Headers about this hop that must never describe the next one. */
const NEVER_FORWARDED: ReadonlySet<string> = new Set([
  'host',
  'forwarded',
  'via',
  // The browser sets these on its request to the documentation server, where they say who the
  // page is. To the API they would say who the caller is, which is a different claim.
  'origin',
  'referer',
  // Recomputed by whatever puts the body on the wire. A forwarded one that disagrees with the
  // body is a request smuggling primitive rather than a stale number.
  'content-length',
]);

/** Response headers the proxy answers with itself rather than repeating. */
const RESPONSE_STRIPPED: ReadonlySet<string> = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
]);

/*
 * THERE IS NO REDACTION LIST HERE, AND ITS ABSENCE IS THE DECISION. A list of header names whose
 * values are replaced by asterisks is the shape this reached for first, and it is one name short
 * the moment somebody's gateway invents `X-Auth-Token`. The record below carries no header value
 * at all, in either direction, so there is nothing to keep a list current about.
 */

/** How forwarding is configured for one proxy. */
export interface ForwardingOptions {
  /** Whether a cookie header crosses in either direction. Off by default, per SPEC 19.10. */
  readonly forwardCookies?: boolean;
}

/**
 * Whether a header name is one of the `X-Forwarded-*` family.
 *
 * MATCHED AS A FAMILY RATHER THAN BY NAME. `X-Forwarded-For`, `-Host`, `-Proto`, `-Port`,
 * `-Prefix` and `-Server` are the ones in use today, and a list of them is a list that is one
 * name short the moment a framework invents another.
 *
 * @param name - Lower cased header name
 * @returns True when it is in the family
 */
export function isForwardedHeader(name: string): boolean {
  return name.startsWith('x-forwarded-');
}

/**
 * The headers the proxy sends to the API.
 *
 * @param headers - What the page sent, keys in any case
 * @param options - Whether cookies cross
 * @returns Headers to forward, lower cased
 */
export function forwardableRequestHeaders(
  headers: Readonly<Record<string, string>>,
  options: ForwardingOptions = {},
): Record<string, string> {
  const forwarded: Record<string, string> = {};

  for (const [rawName, value] of Object.entries(headers)) {
    const name = rawName.toLowerCase();

    if (HOP_BY_HOP.has(name) || NEVER_FORWARDED.has(name) || isForwardedHeader(name)) continue;
    if (name === 'cookie' && options.forwardCookies !== true) continue;

    forwarded[name] = value;
  }

  return forwarded;
}

/**
 * The headers the proxy gives back to the page.
 *
 * @param headers - What the API answered with
 * @param options - Whether cookies cross
 * @returns Headers to return, lower cased
 */
export function forwardableResponseHeaders(
  headers: readonly (readonly [string, string])[],
  options: ForwardingOptions = {},
): (readonly [string, string])[] {
  const forwarded: (readonly [string, string])[] = [];

  for (const [rawName, value] of headers) {
    const name = rawName.toLowerCase();

    if (HOP_BY_HOP.has(name) || RESPONSE_STRIPPED.has(name)) continue;
    if (name === 'set-cookie' && options.forwardCookies !== true) continue;

    forwarded.push([name, value]);
  }

  return forwarded;
}

/** One line about a request the proxy handled, with nothing secret in it. */
export interface ProxyLogRecord {
  readonly method: string;
  /** Scheme, host, port and path of the target. Never the query, which carries an apiKey. */
  readonly target: string;
  /** Status the API answered with, or null when nothing was sent. */
  readonly status: number | null;
  /** Why the request was refused, or null when it was sent. */
  readonly refusedBecause: string | null;
  readonly durationMs: number;
  /** Header names that were forwarded, values never. */
  readonly headerNames: readonly string[];
}

/**
 * Builds the log record for one request.
 *
 * WHAT IS ABSENT IS THE POINT. There is no body on either side, there is no header value at all,
 * and the target is written without its query string, because SPEC 14.4 puts an `apiKey` there and
 * a log line holding one is a credential at rest. The header names are kept because "the request
 * carried an Authorization header" is the fact an operator needs and "the request carried this
 * Authorization header" is the one they must never get.
 *
 * @param input - What happened
 * @returns The record, safe to write anywhere
 */
export function proxyLogRecord(input: {
  readonly method: string;
  readonly url: string;
  readonly status: number | null;
  readonly refusedBecause: string | null;
  readonly durationMs: number;
  readonly headers: Readonly<Record<string, string>>;
}): ProxyLogRecord {
  let target = input.url;
  try {
    const parsed = new URL(input.url);
    target = `${parsed.origin}${parsed.pathname}`;
  } catch {
    // A url that does not parse was refused before anything was sent, and the text is kept as it
    // came so the refusal can be read. It carries no query because it carries no url.
    target = input.url.split('?')[0] ?? '';
  }

  return {
    method: input.method,
    target,
    status: input.status,
    refusedBecause: input.refusedBecause,
    durationMs: input.durationMs,
    headerNames: Object.keys(input.headers)
      .map((name) => name.toLowerCase())
      .sort(),
  };
}

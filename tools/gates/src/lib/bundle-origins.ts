/**
 * Whether the bundle a page loads names an origin other than the page's own.
 *
 * SPEC 19.5 puts telemetry at zero and SPEC 19.4 puts external requests at zero, and the
 * browser proof in `tools/browser-budget` answers both for one page load: it watches every
 * request and finds none leaving the origin. That is the stronger evidence and it has one
 * blind spot, which is why this exists. A request made on a condition the proof did not
 * arrange, on a click, after an error, once a day, or when a flag is set, never happens during
 * the navigation the proof measures, and a page load that calls nobody is exactly what such a
 * bundle looks like.
 *
 * So the address is looked for rather than the request. A bundle that calls home has to carry
 * somewhere to call, and an origin cannot be assembled out of nothing: the shipped file is
 * built from this repository's source, and a literal appearing in it was written by somebody.
 *
 * NOTHING IS EXEMPT FOR BEING PUBLISHED BY SOMEBODY REPUTABLE. An entry on the allowlist
 * carries the mechanism by which that particular string is not a request, and the two
 * mechanisms are not equally strong, so they are labelled rather than mixed:
 *
 * - `namespace`, a URI a DOM implementation compares strings against. It is not an address at
 *   all and could not be fetched by the code that holds it.
 * - `diagnostic`, a documentation link printed into a message for a developer. This is the
 *   weaker of the two, because such a string is a syntactically valid address, and it is
 *   admitted only with the reason written beside it. What covers the runtime is the browser
 *   proof, which watches the requests a page actually makes.
 *
 * A new address fails this gate until somebody reads it and records why it is there, which is
 * the same shape as the licence attestations and the never shipped list.
 */

/** An absolute URL the shipped bundle is allowed to carry, and why. */
export interface AllowedOrigin {
  /** Exact prefix, matched against the literal found in the file. */
  readonly prefix: string;
  /** Why this string is not an address the bundle can call. */
  readonly kind: 'namespace' | 'diagnostic';
  readonly reason: string;
}

export const ALLOWED_BUNDLE_ORIGINS: readonly AllowedOrigin[] = [
  {
    prefix: 'http://www.w3.org/2000/svg',
    kind: 'namespace',
    reason: 'the SVG namespace, compared as a string by createElementNS and never fetched',
  },
  {
    prefix: 'http://www.w3.org/1998/Math/MathML',
    kind: 'namespace',
    reason: 'the MathML namespace, same mechanism',
  },
  {
    prefix: 'http://www.w3.org/1999/xhtml',
    kind: 'namespace',
    reason: 'the XHTML namespace, same mechanism',
  },
  {
    prefix: 'http://www.w3.org/XML/1998/namespace',
    kind: 'namespace',
    reason: 'the reserved xml: namespace, same mechanism',
  },
  {
    prefix: 'http://www.w3.org/1999/xlink',
    kind: 'namespace',
    reason: 'the XLink namespace, used by SVG attributes, same mechanism',
  },
  {
    prefix: 'https://vuejs.org/error-reference/',
    kind: 'diagnostic',
    reason:
      'Vue 3.5 builds this link into the runtime error handler and prints it beside a caught ' +
      'error, so a developer reading a console message can look the code up. It is passed to ' +
      'a string template and to nothing else. Read in the shipped bundle rather than taken ' +
      'from the changelog, and it is the only entry of this kind.',
  },
];

/** One absolute URL found in a bundle that no entry allows. */
export interface ForeignOrigin {
  /** The origin, scheme and host, without the path. */
  readonly origin: string;
  /** The literal as it appears, truncated. */
  readonly excerpt: string;
}

/**
 * Absolute http and https URLs, however they are quoted.
 *
 * The tail is zero or more characters rather than one or more, so that a bare `https://` is
 * matched and then reported as unparseable. Requiring a host would make the one string that
 * carries no host the one string this never sees.
 */
const URL_PATTERN = /https?:\/\/[^\s"'`)\\]*/g;

/**
 * Finds every absolute URL in a bundle that the allowlist does not cover.
 *
 * @param bundle - Contents of the built file
 * @returns One entry per distinct foreign origin, in the order first seen
 *
 * @example
 * findForeignOrigins('fetch("https://metrics.example.com/e")'); // one finding
 */
export function findForeignOrigins(bundle: string): ForeignOrigin[] {
  const seen = new Set<string>();
  const findings: ForeignOrigin[] = [];

  for (const match of bundle.matchAll(URL_PATTERN)) {
    const literal = match[0];
    if (ALLOWED_BUNDLE_ORIGINS.some((allowed) => literal.startsWith(allowed.prefix))) continue;

    let origin: string;
    try {
      origin = new URL(literal).origin;
    } catch {
      // A string that begins like a URL and does not parse is reported rather than skipped.
      // Skipping it would make a malformed literal the way past this check.
      origin = literal;
    }

    if (seen.has(origin)) continue;
    seen.add(origin);

    findings.push({
      origin,
      excerpt: literal.length > 120 ? `${literal.slice(0, 117)}...` : literal,
    });
  }

  return findings;
}

/**
 * What `--base` is, and what a build can honestly say with it.
 *
 * TWO SHAPES, AND THE DIFFERENCE IS A FACT RATHER THAN A PREFERENCE, per SPEC 16.1 as amended
 * by T039. A canonical link, an `og:url` and a `<loc>` in a sitemap each need an absolute
 * address with a scheme and a host; `/docs` has neither, and inventing one would be exactly the
 * substituted guess SPEC 6 forbids everywhere else. So a base that carries an origin produces
 * those three, and a base that does not produces the rest of the head and says what it left
 * out.
 */

import { ErrorCode, InvalidOptionsError } from '@openref/core';
import { isHttpUrl } from '@openref/core/security';

/** The base of one build, in the two shapes it comes in. */
export interface SiteBase {
  /** Mount point, with a leading slash and no trailing one, `''` for the root. */
  readonly basePath: string;
  /** Origin plus base path, no trailing slash, when `--base` carried one. */
  readonly siteUrl: string | null;
}

/** The one message a build prints when it was given no origin to be absolute about. */
export const NO_ORIGIN_NOTICE =
  'no absolute --base was given, so sitemap.xml is not written and the canonical link and og:url are omitted. Pass --base https://host/path to publish them';

/**
 * Reads `--base`.
 *
 * @param base - What the caller passed, or undefined for the root
 * @returns The base
 * @throws {InvalidOptionsError} When the value is neither a path nor an http(s) url
 */
export function resolveSiteBase(base?: string): SiteBase {
  const value = (base ?? '').trim();
  if (value === '' || value === '/') return { basePath: '', siteUrl: null };

  if (value.startsWith('/')) {
    return { basePath: stripTrailingSlash(parsedPath(value, base ?? '')), siteUrl: null };
  }

  // A SCHEME IS WHAT MAKES IT AN ORIGIN, AND ONLY TWO ARE PAGES. Anything else, `file:`
  // included, is not an address a canonical link or a sitemap may carry.
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidOptionsError(
      `--base must be a path such as /docs or an absolute url such as https://docs.example.com/api, received "${base ?? ''}"`,
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { base },
    );
  }

  if (!isHttpUrl(url)) {
    throw new InvalidOptionsError(
      `--base must be an http or https url when it carries an origin, received "${value}"`,
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { base: value },
    );
  }

  const path = stripTrailingSlash(url.pathname);

  return { basePath: path, siteUrl: `${url.origin}${path}` };
}

/**
 * The absolute url of one page, or null when there is no origin to build one from.
 *
 * @param base - The build's base
 * @param href - Page address, as `links.ts` produced it, base path included
 * @returns The absolute url, or null
 */
export function absoluteUrlOf(base: SiteBase, href: string): string | null {
  if (base.siteUrl === null) return null;

  const origin = base.siteUrl.slice(0, base.siteUrl.length - base.basePath.length);
  return href === '/' && base.basePath === '' ? `${origin}/` : `${origin}${href}`;
}

/**
 * A base that is a path alone, taken from the url parser rather than from the string.
 *
 * THE PATH IS PARSED, NOT INTERPOLATED, which is the rule SPEC 19 item 11 already states for the
 * one other address this tool assembles from a flag. Before `T043` the path half of `--base` was
 * whatever followed a slash, and it reaches the generated proxy configuration of SPEC 16.2 as
 * text: a newline in it wrote a working `location / { proxy_pass ... }` into the nginx snippet,
 * so the value that decides where the documentation is mounted also decided where the whole site
 * goes. The absolute url branch never had the hole, because the parser had already laundered it.
 *
 * REFUSED RATHER THAN REWRITTEN when the parser would change the value: a base silently
 * percent encoded is a base whose pages answer at an address the deployer did not choose, and
 * nothing downstream would say so. The same sentence is why `T062` widened the escape rule from a
 * character class to the value itself: `%2F` is a slash, and a slash the class allows, so the
 * character reading let a base spell the site root in escapes and walk past the one refusal SPEC
 * 16.4 calls unrecoverable.
 *
 * @param value - The trimmed value, known to start with a slash
 * @param original - What the caller wrote, for the message
 * @returns The path exactly as the url parser produces it
 * @throws {InvalidOptionsError} When the parser would not produce this path from this value
 */
function parsedPath(value: string, original: string): string {
  const parsed = new URL(value, 'http://openref.invalid');

  if (parsed.pathname !== value || parsed.search !== '' || parsed.hash !== '') {
    throw new InvalidOptionsError(
      `--base must be a path a url can carry as written, such as /docs; "${original}" is not one, ` +
        `a url reads it as "${parsed.pathname}${parsed.search}${parsed.hash}"`,
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { base: original },
    );
  }

  const unsafe = FOREIGN_BASE_CHARACTER.exec(parsed.pathname);
  if (unsafe !== null) {
    throw new InvalidOptionsError(
      `--base may not carry "${unsafe[0]}": at least one generated proxy configuration reads it ` +
        `as syntax rather than as a path, so "${original}" would produce a file the platform ` +
        'refuses to load. A base path is letters, digits and -._~%, separated by /',
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { base: original },
    );
  }

  // AND THE RULE IS ABOUT THE VALUE, NOT ABOUT THE CHARACTER SET, WHICH `T062` MEASURED THE HARD
  // WAY. The first form of this check decoded once and looked for a forbidden character, which is
  // right about `%0A` and blind about `%2F`: a slash and a dot are both in the class above, so
  // `/docs%2F..%2F..` and `/a%2F..` passed, and one decode turns each of them into the site root.
  // That is the exact configuration SPEC 16.4 refuses by name, reachable by spelling it in escapes,
  // so the refusal a deployment cannot recover from was bypassable.
  //
  // SO ANY ESCAPE THAT CHANGES THE PATH IS REFUSED, and the reason it costs nothing is the class
  // above: an escape either encodes a character the class already allows written plainly, in which
  // case it is redundant, or it encodes one the class forbids, in which case it is smuggling. In
  // neither case is the address the deployer chose the address a platform that decodes before it
  // routes will use, and two addresses for one mount is the whole defect.
  const decoded = decodeOnce(parsed.pathname);
  if (decoded === null || decoded !== parsed.pathname) {
    throw new InvalidOptionsError(
      `--base carries a percent escape, and one decode of "${original}" is ` +
        `"${decoded ?? 'not a valid escape sequence'}", which is a different path. A base is ` +
        'written as the address it mounts at: letters, digits and -._~, separated by /',
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { base: original },
    );
  }

  return parsed.pathname;
}

/**
 * One decoding pass over a path, or null when the escapes are not well formed.
 *
 * EXACTLY ONE PASS, the same rule SPEC 19 states for the proxy path guard: a value that is still
 * ambiguous after one decode is refused rather than decoded again, because deciding how many times
 * a platform will decode is deciding for the platform.
 *
 * @param path - The parsed pathname
 * @returns The decoded path, or null when it cannot be decoded
 */
function decodeOnce(path: string): string | null {
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}

/**
 * Anything a base path is not made of.
 *
 * AN ALLOWLIST, AFTER A DENYLIST WAS FOUND SHORT TWICE. The first cut named the four characters
 * `unsafeUpstreamCharacter` refuses; `T043`'s verification then drove `*`, `|`, `[`, `]`, `!`, `,`
 * and `=` straight through it. A base ending in a star put one into the middle of a Caddy
 * `handle_path` and into the middle of a Netlify rule, and both platforms allow one only at the
 * start or the end. A denylist of route syntax has to know every generator's grammar and stay
 * right as generators are added. What a path is made of does not change: the unreserved characters
 * of the URL grammar, the percent that introduces an escape, and the slash that separates
 * segments. Everything else is refused by name.
 */
const FOREIGN_BASE_CHARACTER = /[^A-Za-z0-9\-._~%/]/;

/** A path with any trailing slashes removed, `''` for the root. */
function stripTrailingSlash(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '/' ? '' : trimmed;
}

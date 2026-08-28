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
    return { basePath: stripTrailingSlash(value), siteUrl: null };
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

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
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

/** A path with any trailing slashes removed, `''` for the root. */
function stripTrailingSlash(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '/' ? '' : trimmed;
}

/**
 * The console half of coming back from an authorization server.
 *
 * SEPARATE FROM `oauth-landing.ts` BECAUSE OF WHICH CHUNK EACH ENDS UP IN. The entry statically
 * imports the landing half to find out whether a page load is a callback, so everything in that
 * file is paid for by every reader on every page. What is here is reached only from the try-it
 * console, which is behind a dynamic import, so it is paid for by the reader who presses Sign in.
 * The two were one module first, and the first paint grew by the whole of it.
 */

import {
  currentLocation,
  noticeStorage,
  SIGN_IN_NOTICE_KEY,
  type LocationLike,
  type SignInNotice,
} from './oauth-landing';

/**
 * Where an authorization server sends the reader back to, and where they were.
 *
 * THE RETURN PATH TRAVELS IN THE CALLBACK'S OWN QUERY RATHER THAN IN SERVER STATE, and the route
 * that reads it back checks that it is a path under this mount. A reference is often a static
 * directory with no server to remember anything, and an absolute url here would make the callback
 * an open redirector.
 *
 * @param basePath - Where the reference is mounted
 * @param location - The location to read, defaulting to the page's own
 * @returns The redirect uri to register and the path to come back to
 *
 * @example
 * const targets = redirectTargets('/docs');
 */
export function redirectTargets(
  basePath: string,
  location?: LocationLike,
): { readonly redirectUri: string; readonly returnPath: string } | undefined {
  const here = location ?? currentLocation();
  if (here === null) return undefined;

  return {
    redirectUri: `${here.origin}${basePath}/_oauth/callback`,
    returnPath: `${here.pathname}${here.search}`,
  };
}

/**
 * Sends the reader to an authorization server.
 *
 * @param url - The absolute url to go to
 *
 * @example
 * navigateTo(outcome.url);
 */
export function navigateTo(url: string): void {
  const candidate = (globalThis as { location?: { assign?: (url: string) => void } }).location;

  candidate?.assign?.(url);
}

/**
 * Reads and clears the sentence a landing left.
 *
 * READ ONCE. A notice that survived being read would reappear on every operation page of the
 * reference, long after the sign in it describes.
 *
 * @returns The notice, or null when there is none
 *
 * @example
 * const notice = readSignInNotice();
 */
export function readSignInNotice(): SignInNotice | null {
  const store = noticeStorage();
  const raw = store?.getItem(SIGN_IN_NOTICE_KEY) ?? null;
  if (raw === null) return null;

  store?.removeItem(SIGN_IN_NOTICE_KEY);

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const notice = parsed as Partial<SignInNotice>;

    return typeof notice.schemeId === 'string' && typeof notice.message === 'string'
      ? { schemeId: notice.schemeId, message: notice.message }
      : null;
  } catch {
    return null;
  }
}

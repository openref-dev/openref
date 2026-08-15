/**
 * Coming back from an authorization server, which happens on a page load rather than in a click.
 *
 * THE FLOW LEAVES THE PAGE AND RETURNS TO A NEW ONE, and that is what this file is about. The
 * console is deferred, so at the moment the reader lands there is no console: the exchange runs
 * from the entry, and its outcome waits in `sessionStorage` until somebody opens the console,
 * which is where a sentence about signing in belongs. Without that, a failed exchange would be a
 * blank page and a successful one would be indistinguishable from having done nothing.
 *
 * NOTHING HERE HOLDS A CREDENTIAL. What waits is one sentence and the scheme it is about. The
 * token goes to the runner's own store under the storage policy of SPEC 14.4, and the single use
 * PKCE verifier is cleared by the runner the moment it is spent.
 *
 * The members of `location` and `history` are named structurally, for the reason `dom.ts` gives:
 * this file is reachable from a component, and a component renders on the server too.
 */

import type { IRunnerPort } from '@openref/vue';

/** Query parameter the callback route adds, so a callback is recognised rather than guessed at. */
export const OAUTH_MARKER = 'oref_oauth';

/** Where the outcome of a landing waits for the console to be opened. */
export const SIGN_IN_NOTICE_KEY = 'oref.oauth.notice';

/** The part of `Location` this file reads. */
export interface LocationLike {
  readonly search: string;
  readonly hash: string;
  readonly pathname: string;
  readonly origin: string;
}

/** What a landing has to say once somebody opens the console. */
export interface SignInNotice {
  readonly schemeId: string;
  readonly message: string;
}

/**
 * The session storage a landing writes its outcome to, when there is one.
 *
 * EXPORTED SO THAT THE CONSOLE SIDE CAN READ IT BACK WITHOUT A SECOND COPY, and this file is the
 * one that has to be in the first chunk anyway: the entry statically imports it to find out
 * whether this load is a callback at all.
 *
 * @returns The storage, or null when there is none
 *
 * @example
 * noticeStorage()?.removeItem(SIGN_IN_NOTICE_KEY);
 */
export function noticeStorage(): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
} | null {
  const candidate = (globalThis as { sessionStorage?: unknown }).sessionStorage;
  if (candidate === null || typeof candidate !== 'object') return null;

  const store = candidate as { getItem?: unknown; setItem?: unknown; removeItem?: unknown };

  return typeof store.getItem === 'function' &&
    typeof store.setItem === 'function' &&
    typeof store.removeItem === 'function'
    ? (candidate as ReturnType<typeof noticeStorage> & object)
    : null;
}

/**
 * The page's own location, when this is running in a browser.
 *
 * @returns The location, or null on the server
 *
 * @example
 * const here = currentLocation();
 */
export function currentLocation(): LocationLike | null {
  const candidate = (globalThis as { location?: unknown }).location;
  if (candidate === null || typeof candidate !== 'object') return null;

  const value = candidate as Partial<LocationLike>;

  return typeof value.search === 'string' && typeof value.pathname === 'string'
    ? (candidate as LocationLike)
    : null;
}

/**
 * The parameters an authorization server answered with, or null when this is not a callback.
 *
 * BOTH HALVES OF THE URL ARE READ, because the two redirect flows answer in different places: an
 * authorization code arrives in the query string and an implicit token arrives in the fragment,
 * which no server ever sees. The marker is in the query either way, because the callback route
 * puts it there.
 *
 * @param location - The location to read, defaulting to the page's own
 * @returns The parameters, or null when this page is not a callback landing
 *
 * @example
 * const params = callbackParams();
 */
export function callbackParams(location?: LocationLike): Readonly<Record<string, string>> | null {
  const here = location ?? currentLocation();
  if (here === null) return null;

  const query = new URLSearchParams(here.search);
  if (query.get(OAUTH_MARKER) !== '1') return null;

  const params: Record<string, string> = {};
  for (const [name, value] of query) {
    if (name !== OAUTH_MARKER) params[name] = value;
  }
  for (const [name, value] of new URLSearchParams(here.hash.replace(/^#/, ''))) {
    params[name] = value;
  }

  return params;
}

/**
 * Leaves a sentence for the console to show when it is next opened.
 *
 * @param notice - Which scheme, and what to say about it
 *
 * @example
 * writeSignInNotice({ schemeId: 'oauth', message: 'signed in' });
 */
export function writeSignInNotice(notice: SignInNotice): void {
  noticeStorage()?.setItem(SIGN_IN_NOTICE_KEY, JSON.stringify(notice));
}

/**
 * Finishes an OAuth2 flow the reader has just come back from.
 *
 * THIS IS THE ONE REQUEST A PAGE LOAD MAY MAKE OFF ORIGIN, AND IT IS STILL NOT THE BUNDLE CALLING
 * HOME. SPEC 19.4 forbids the client bundle going anywhere by itself, and SPEC 14.4.1 draws the
 * boundary at the load: a page that was opened and not touched makes no request outside its
 * origin. This module is fetched only when the callback route sent the reader back with its
 * marker on the url, which is one page load per sign in and none at all for a reader who never
 * pressed Sign in.
 *
 * THE URL IS CLEANED WHATEVER HAPPENS. A code left in the address bar is a code in the reader's
 * history and in whatever they paste next, and a reload would attempt an exchange the
 * authorization server has already spent.
 *
 * @param runner - The runner, when the host handed one over eagerly
 * @param load - How to build the runner, which is the shipped path
 * @returns Nothing, once the url has been cleaned and the outcome recorded
 *
 * @example
 * await completeSignIn(options.runner, options.loadRunner);
 */
export async function completeSignIn(
  runner?: IRunnerPort,
  load?: () => Promise<IRunnerPort>,
): Promise<void> {
  const params = callbackParams();
  if (params === null) return;

  const port = runner ?? (load === undefined ? undefined : await load());
  const here = currentLocation()?.pathname ?? '';
  // NAMED STRUCTURALLY LIKE EVERYTHING ELSE IN THIS FILE, for the reason `dom.ts` gives: the
  // renderer compiles in a program with the DOM types deliberately out of scope.
  const history = (
    globalThis as { history?: { replaceState(a: null, b: string, c: string): void } }
  ).history;

  try {
    const landed = await port?.completeAuthorization?.(params);

    history?.replaceState(null, '', landed?.returnPath ?? here);

    if (landed !== undefined) {
      writeSignInNotice({ schemeId: landed.schemeId, message: 'signed in' });
      return;
    }

    // NOTHING PENDING IS NOT NOTHING TO SAY, per T035. This is what a replayed callback reaches:
    // the record was spent by the first landing, so the second has no flow to finish. Before, the
    // url was cleaned and the reader was told nothing at all, which reads exactly like a sign in
    // that worked. The one case that must stay silent is a page with no runner at all, because
    // there the module did not decline the answer, it never saw one.
    // THE SENTENCE IS SHORT BECAUSE THIS CHUNK IS 800 BYTES GZIP, and the first draft of it put the
    // chunk 9 bytes over. A budget is not moved to fit a sentence.
    if (port !== undefined) {
      writeSignInNotice({
        schemeId: '',
        message: 'nothing was waiting for that answer; it is spent, or it belongs to another tab',
      });
    }
  } catch (cause) {
    // NO SCHEME ID, BECAUSE THE FAILURE IS THAT NOBODY KNOWS WHICH FLOW THIS WAS. The pending
    // record is the runner's and refusing to read it is the refusal; the console shows the
    // sentence against the first scheme that could have produced it rather than dropping it.
    history?.replaceState(null, '', here);
    writeSignInNotice({
      schemeId: '',
      message: cause instanceof Error ? cause.message : 'the sign in did not complete',
    });
  }
}

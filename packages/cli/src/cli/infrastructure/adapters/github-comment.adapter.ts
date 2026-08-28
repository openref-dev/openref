import { ErrorCode, UsageError } from '@openref/core';
import type { ApiOrigin } from '../../domain/api-origin';
import { repositoryPath, type RepositorySlug } from '../../domain/repository-slug';

/**
 * The one comment `openref pr` keeps on a pull request, per SPEC 17.2.
 *
 * IT UPDATES IN PLACE, AND THE MECHANISM IS THE MARKER RATHER THAN A STORED ID. A run has no
 * memory of the run before it: a workflow re-runs on a fresh machine with a fresh token and
 * nothing to read. So the comment carries its own identity in its first line, and the next run
 * finds it by listing what is already there.
 *
 * ADOPTION HAS TWO CONDITIONS AND THE FIRST IS THE AUTHOR. Anybody can write the marker: measured
 * against a fake API, a contributor whose whole first line was the marker had their comment
 * adopted and overwritten, and could claim the slot before the first run ever posted. So the
 * identity the token authenticates as is resolved once from the API, and only a comment that
 * identity wrote is adopted. AN IDENTITY THE API DID NOT GIVE IS NOT A PASS: nothing is adopted, a
 * new comment is posted, and the caller is told, because a check that could not establish a fact
 * must never answer with the value that means success.
 *
 * THERE ARE TWO PATHS TO THAT IDENTITY BECAUSE THERE ARE TWO KINDS OF TOKEN. A user token, a
 * personal access token or an OAuth token, is named by `GET /user`, and a candidate is adopted on
 * a login match. A GitHub App installation token, which is what `GITHUB_TOKEN` is inside Actions,
 * is refused by that endpoint, and no endpoint names it without a JWT this command does not hold.
 * For it the proof is on the candidate instead, in two fields GitHub sets and no commenter can
 * write: `user.type` is `Bot` and `performed_via_github_app.slug` is the app that acted. A comment
 * with both, the slug being the Actions app, was written by an Actions token. Everything else, any
 * other failure of `GET /user`, a missing field, or a slug that is somebody else's app, leaves the
 * identity unestablished and posts.
 *
 * WHAT IS EXPECTATION RATHER THAN MEASUREMENT, SAID HERE. No live GitHub runs in this suite, so
 * that `GET /user` refuses an installation token with 403, and that the Actions app answers to the
 * slug below, are read from GitHub's documented behaviour and exercised against a fake that
 * reproduces it. The residual is named too: a token that is neither, and that `GET /user` happens
 * to refuse, would adopt a comment the Actions app wrote. That comment is still one this tool
 * wrote under another token, and it is never a contributor's.
 *
 * THE MARKER RULE IS THE SECOND CONDITION AND IT IS EXACT. The looser test, the marker anywhere in
 * the body, would adopt any comment that quoted one of ours. The first line is compared byte for
 * byte with one exception: a trailing CR is removed, because GitHub stores bodies with CRLF and
 * without that no real comment would ever match. Leading whitespace no longer adopts: every body
 * this tool writes begins with the marker as its first byte, so a first line with anything before
 * it is not a body this tool wrote.
 *
 * THE ONLY HOST IT SPEAKS TO IS THE ONE THE RUNNER NAMED, AND THAT NAME IS NOW CHECKED.
 * `GITHUB_API_URL` is what the workflow environment provides and what GitHub Enterprise Server
 * changes; nothing here has a hard coded address to fall back to, because a fallback would be this
 * package deciding where a customer's credential gets sent. What it does have, since T041's final
 * review, is a parse: the root arrives as an `ApiOrigin`, so it has already been held to https, or
 * to http on the loopback address, before any target can be built out of it.
 *
 * AND IT FOLLOWS NO REDIRECT, WHICH IS THE REST OF THAT SAME GUARANTEE. Every request here carries
 * `redirect: 'manual'` and a 3xx is a refusal naming what came back, per SPEC 14.5 and SPEC 19.11.
 * Without it the promise rested on the runtime: undici strips `authorization` when a redirect
 * crosses origins, so nothing leaks today, but that is Node's behaviour rather than anything this
 * repository states or tests, and a same origin redirect keeps the header and delivers the token to
 * a path this tool never constructed, which is exactly what item 11 promises against. The stripping
 * is a second line of defence and is not the first.
 */

/** Where the comment goes and what it is posted with. */
export interface GitHubCommentTarget {
  /** The API root, parsed from `GITHUB_API_URL` before it could reach a URL. */
  readonly apiOrigin: ApiOrigin;
  /** The repository, parsed into its two segments before it can reach a URL. */
  readonly repository: RepositorySlug;
  /** The pull request number, which is the issue number of the same thread. */
  readonly pullRequest: number;
  readonly token: string;
}

/**
 * Who the token authenticates as, in whichever of the two ways the API could say.
 *
 * `user` is a login to compare with a comment's author. `app` is an installation, whose comments
 * are recognised by the two server set fields on the comment rather than by a login.
 */
export type CommentIdentity =
  | { readonly kind: 'user'; readonly login: string }
  | { readonly kind: 'app'; readonly slug: string };

/**
 * The slug GitHub's own Actions app answers to in `performed_via_github_app`.
 *
 * It is the app behind `${{ github.token }}`, and its comments appear as `github-actions[bot]`.
 */
export const ACTIONS_APP_SLUG = 'github-actions';

/** What the upsert did. */
export interface UpsertedComment {
  readonly url: string;
  readonly updated: boolean;
  /**
   * Who the token authenticates as, or undefined when neither path could establish it.
   *
   * Carried out so the command can print the reason a run posted instead of updating rather than
   * leaving a second comment on the thread with no explanation anywhere.
   */
  readonly identity: CommentIdentity | undefined;
  /**
   * True when the search spent its page cap without finding this tool's comment.
   *
   * Carried out for the same reason as `identity`: it is the other way a run posts a second
   * comment instead of updating the first, and an unexplained duplicate reads as a fault.
   */
  readonly searchCapReached: boolean;
}

/** The `fetch` this uses, narrowed to what it needs, so a test hands it a function. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: 'manual';
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  text: () => Promise<string>;
  /** Present on a real response; a refusal reads `location` off it and nothing else. */
  readonly headers?: { get: (name: string) => string | null };
}>;

/** What every request this adapter sends carries, on top of its method and headers. */
const NO_REDIRECT = { redirect: 'manual' } as const;

/**
 * How many pages of existing comments are read before the search gives up.
 *
 * THE CAP IS REAL AND IS THEREFORE SAID OUT LOUD WHEN IT IS REACHED. Ten pages of a hundred is a
 * thousand comments, and a thread longer than that pushes this tool's own comment off the end of
 * what the search reads: every push then posts a new one. That is a limit rather than a defect, but
 * a silent limit reads from the outside as a broken update, so `capReached` travels out of the
 * search and the command prints one sentence naming the number.
 */
export const MAX_COMMENT_PAGES = 10;

/** Comments per page, the GitHub maximum. */
export const COMMENTS_PER_PAGE = 100;

/**
 * Creates or updates the marked comment on one pull request.
 *
 * @param target - Where to post, and with what
 * @param marker - The first line that identifies this tool's own comment
 * @param body - The whole comment, marker included
 * @param fetchImpl - The fetch to use; the global one by default
 * @returns The comment's address, whether it already existed, and the identity that was resolved
 * @throws {UsageError} When GitHub refuses a request, with its status and first line of body
 */
export async function upsertMarkedComment(
  target: GitHubCommentTarget,
  marker: string,
  body: string,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<UpsertedComment> {
  const identity = await resolveIdentity(target, fetchImpl);

  // NO IDENTITY MEANS NO LISTING AT ALL. Reading the thread could only produce a candidate that
  // cannot be adopted, so the request is not sent: the run goes straight to posting a new one.
  const search: MarkedCommentSearch =
    identity === undefined
      ? { id: undefined, capReached: false }
      : await findMarkedComment(target, marker, fetchImpl, identity);

  const request =
    search.id === undefined
      ? {
          url: `${issuesRoot(target)}/${String(target.pullRequest)}/comments`,
          method: 'POST',
        }
      : {
          url: `${issuesRoot(target)}/comments/${String(search.id)}`,
          method: 'PATCH',
        };

  const response = await fetchImpl(request.url, {
    method: request.method,
    headers: headers(target.token),
    body: JSON.stringify({ body }),
    ...NO_REDIRECT,
  });

  if (isRedirect(response.status)) {
    throw redirectRefusal(request.method, response.status, locationOf(response));
  }

  const text = await response.text();
  if (!response.ok) throw refusal(request.method, response.status, text);

  return {
    url: commentUrlOf(text) ?? request.url,
    updated: search.id !== undefined,
    identity,
    searchCapReached: search.capReached,
  };
}

/**
 * Who the token authenticates as, by whichever of the two paths the API allows.
 *
 * THE 403 IS A CLASSIFICATION, NOT A FAILURE. GitHub answers `GET /user` for a user token and
 * refuses it with 403 for a GitHub App installation token, so the refusal is what tells the run
 * which of the two it holds. Any other outcome, a different status, a network fault, or a body
 * with no login in it, is neither path and leaves the identity unestablished.
 *
 * NOTHING HERE THROWS, WITH ONE EXCEPTION, AND THE EXCEPTION IS THE HAZARD RATHER THAN AN OUTAGE.
 * The run still has a report to print and a comment to post, and failing the whole command because
 * the identity endpoint was unavailable would turn a degraded update into a red pull request. A 3xx
 * is not an outage: it is the answer telling this run to send `GITHUB_TOKEN` somewhere else, and
 * carrying on afterwards would mean sending it again to the next address on the same wiring. So a
 * redirect stops the run here, before a second request exists.
 *
 * @param target - The API root and the token
 * @param fetchImpl - The fetch to use
 * @returns The identity, or undefined when neither path established one
 * @throws {UsageError} When the answer is a redirect, which is never followed
 */
export async function resolveIdentity(
  target: GitHubCommentTarget,
  fetchImpl: FetchLike,
): Promise<CommentIdentity | undefined> {
  let text = '';
  let redirected: UsageError | undefined;
  try {
    const response = await fetchImpl(`${apiRoot(target)}/user`, {
      method: 'GET',
      headers: headers(target.token),
      ...NO_REDIRECT,
    });
    if (isRedirect(response.status)) {
      // THROWN OUTSIDE THE CATCH, NOT INSIDE IT. A throw here would be swallowed by the very
      // handler that exists to keep a network fault from failing the command, and the refusal
      // would become the undefined identity that means "carry on and post".
      redirected = redirectRefusal('GET', response.status, locationOf(response));
    } else {
      text = await response.text();
      if (response.status === 403) return { kind: 'app', slug: ACTIONS_APP_SLUG };
      if (!response.ok) return undefined;
    }
  } catch {
    return undefined;
  }
  if (redirected !== undefined) throw redirected;

  try {
    const payload: unknown = JSON.parse(text);
    if (typeof payload !== 'object' || payload === null) return undefined;
    const login = (payload as Record<string, unknown>).login;
    return typeof login === 'string' && login !== '' ? { kind: 'user', login } : undefined;
  } catch {
    return undefined;
  }
}

/** What the search for an existing comment found, and whether it ran out of pages looking. */
export interface MarkedCommentSearch {
  /** The comment id, or undefined when the thread carries none of ours. */
  readonly id: number | undefined;
  /**
   * True when the page cap was spent without reaching the end of the thread.
   *
   * `id` undefined and this true is the one case that needs explaining: there may well be a
   * comment of ours further down, and this run will post a second one anyway.
   */
  readonly capReached: boolean;
}

/**
 * The id of this tool's own comment on the pull request, or undefined when there is none yet.
 *
 * @param target - Where to look
 * @param marker - The first line that identifies it
 * @param fetchImpl - The fetch to use
 * @param identity - Who the token authenticates as; only its own comments are adopted
 * @returns The comment id when there is one, and whether the search hit its page cap
 * @throws {UsageError} When GitHub refuses the listing
 */
export async function findMarkedComment(
  target: GitHubCommentTarget,
  marker: string,
  fetchImpl: FetchLike,
  identity: CommentIdentity,
): Promise<MarkedCommentSearch> {
  for (let page = 1; page <= MAX_COMMENT_PAGES; page++) {
    const url = `${issuesRoot(target)}/${String(target.pullRequest)}/comments?per_page=${String(COMMENTS_PER_PAGE)}&page=${String(page)}`;
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: headers(target.token),
      ...NO_REDIRECT,
    });
    if (isRedirect(response.status)) {
      throw redirectRefusal('GET', response.status, locationOf(response));
    }
    const text = await response.text();
    if (!response.ok) throw refusal('GET', response.status, text);

    const comments = parseComments(text);
    for (const comment of comments) {
      if (writtenBy(comment, identity) && carriesMarker(comment.body, marker)) {
        return { id: comment.id, capReached: false };
      }
    }
    // A SHORT PAGE IS THE END OF THE THREAD, which is the only way this search finishes having
    // actually looked at everything. Anything else falls out of the loop with the cap spent.
    if (comments.length < COMMENTS_PER_PAGE) return { id: undefined, capReached: false };
  }

  return { id: undefined, capReached: true };
}

/**
 * Whether one listing entry was written by the identity this run holds.
 *
 * THE APP PATH RESTS ON TWO FIELDS A COMMENTER CANNOT WRITE. `user.type` and
 * `performed_via_github_app` are set by GitHub from the credential that made the request, not from
 * the body somebody typed, which is exactly why they can stand in for a login the API refuses to
 * give. Both are required: `Bot` alone would match any app's comment, and a slug alone would match
 * a field that is absent on a human's comment and therefore compares as undefined.
 *
 * @param comment - One entry of the listing
 * @param identity - Who the token authenticates as
 * @returns True when this identity wrote it
 */
export function writtenBy(comment: ExistingComment, identity: CommentIdentity): boolean {
  if (identity.kind === 'user')
    return comment.author !== undefined && comment.author === identity.login;
  return comment.authorType === 'Bot' && comment.appSlug === identity.slug;
}

/**
 * Whether a body's whole first line is the marker.
 *
 * @param body - The comment body as GitHub stored it
 * @param marker - The marker every body this tool writes begins with
 * @returns True when the first line is exactly the marker, CRLF allowed for
 */
export function carriesMarker(body: string, marker: string): boolean {
  const first = body.split('\n')[0] ?? '';
  return (first.endsWith('\r') ? first.slice(0, -1) : first) === marker;
}

/** The API root of one target, already parsed and already stripped of trailing slashes. */
function apiRoot(target: GitHubCommentTarget): string {
  return target.apiOrigin.url;
}

/** The `/repos/{owner}/{repo}/issues` root of one target. */
function issuesRoot(target: GitHubCommentTarget): string {
  return `${apiRoot(target)}/repos/${repositoryPath(target.repository)}/issues`;
}

/**
 * The headers every request carries.
 *
 * The version header is pinned so a future default cannot change the shape of what comes back
 * under a build that was never run against it.
 */
function headers(token: string): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'openref',
  };
}

/** One existing comment, reduced to what the search needs. */
export interface ExistingComment {
  readonly id: number;
  readonly body: string;
  /** `user.login` as GitHub reported it, or undefined when the entry did not carry one. */
  readonly author: string | undefined;
  /** `user.type`, which GitHub sets from the credential: `User`, `Bot`, `Organization`. */
  readonly authorType: string | undefined;
  /** `performed_via_github_app.slug`, present only when an app made the request. */
  readonly appSlug: string | undefined;
}

/**
 * Reads a comment listing.
 *
 * An entry missing an integer `id` or a string `body` is skipped rather than defaulted: it
 * cannot be the comment being looked for, and inventing a value for it would make the search
 * answer a question it was never asked. An entry with no readable author, no type or no app slug
 * keeps its place in the list and carries undefined for each, and undefined equals no identity, so
 * a missing field can never adopt.
 */
export function parseComments(text: string): ExistingComment[] {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(payload)) return [];

  const comments: ExistingComment[] = [];
  for (const entry of payload) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const id = record.id;
    const body = record.body;
    if (typeof id === 'number' && Number.isInteger(id) && typeof body === 'string') {
      comments.push({
        id,
        body,
        author: stringField(record.user, 'login'),
        authorType: stringField(record.user, 'type'),
        appSlug: stringField(record.performed_via_github_app, 'slug'),
      });
    }
  }
  return comments;
}

/** One non empty string field of a nested object, when it carried a readable one. */
function stringField(parent: unknown, key: string): string | undefined {
  if (typeof parent !== 'object' || parent === null) return undefined;
  const value = (parent as Record<string, unknown>)[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The `html_url` of a created or updated comment, when the response carried one. */
function commentUrlOf(text: string): string | undefined {
  try {
    const payload: unknown = JSON.parse(text);
    if (typeof payload !== 'object' || payload === null) return undefined;
    const url = (payload as Record<string, unknown>).html_url;
    return typeof url === 'string' && url !== '' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Whether one answer is a redirect, which is the one thing no request here follows. */
export function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

/**
 * The error a 3xx becomes, naming the status and the address that was refused.
 *
 * THE DESTINATION IS PRINTED BECAUSE IT IS THE WHOLE POINT OF THE REFUSAL. A maintainer reading
 * this needs to know where the API tried to send a request carrying `GITHUB_TOKEN`; the value is
 * truncated for the same reason a response body is, since it is text somebody else wrote.
 *
 * @param method - The method of the request that was answered
 * @param status - The 3xx that came back
 * @param location - The `location` header, when the answer carried one
 * @returns The usage error the caller throws
 */
export function redirectRefusal(
  method: string,
  status: number,
  location: string | undefined,
): UsageError {
  return new UsageError(
    `GitHub answered ${method} with ${String(status)}, a redirect${
      location === undefined || location === '' ? '' : ` to ${location.slice(0, 300)}`
    }. A request carrying GITHUB_TOKEN is never followed to an address this tool did not build, per SPEC 14.5 and SPEC 19.11`,
    ErrorCode.CLI_USAGE_INVALID,
    undefined,
    { status },
  );
}

/** The `location` of one answer, when the response object carried headers at all. */
function locationOf(response: {
  readonly headers?: { get: (name: string) => string | null };
}): string | undefined {
  return response.headers?.get('location') ?? undefined;
}

/**
 * The error a refused request becomes.
 *
 * THE RESPONSE BODY IS TRUNCATED AND THE REQUEST IS NOT ECHOED. What GitHub returns on a failure
 * is its own message; the token is in the request, never in the response, and nothing here puts
 * a header into a message.
 */
function refusal(method: string, status: number, text: string): UsageError {
  const first = text.trim().split('\n')[0] ?? '';
  return new UsageError(
    `GitHub refused ${method} with ${String(status)}${first === '' ? '' : `: ${first.slice(0, 300)}`}`,
    ErrorCode.CLI_USAGE_INVALID,
    undefined,
    { status },
  );
}

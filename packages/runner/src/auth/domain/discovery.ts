/**
 * OpenID Connect discovery: turning one url into the flows an `openIdConnect` scheme can run.
 *
 * A DISCOVERY DOCUMENT IS AN INSTRUCTION TO SEND CREDENTIALS SOMEWHERE. That is the whole reason
 * this file is suspicious of it rather than merely parsing it. Whatever it names as the
 * authorization endpoint is where the reader is sent, and whatever it names as the token endpoint
 * is where a code verifier, a client secret and possibly a password are posted. A document that
 * arrives from an unexpected host, through a redirect, or with an endpoint on a scheme that is not
 * https is refused, because each of those is a way for the answer to have come from someone else.
 *
 * `code_challenge_methods_supported` IS READ AND CAN ONLY EVER REFUSE. A server that advertises
 * `plain` and not `S256` does not get a plain exchange; it gets a refusal naming what is missing.
 * The one thing discovery is not allowed to do is negotiate SPEC 14.4's mandatory rule downwards.
 */

import { AuthError } from '@openref/core';
import { isSecureCredentialUrl } from '@openref/core/security';
import type { RequestPlan, RunnableOAuthFlow } from '../../request/domain/request-plan';
import type { IHttpTransport } from '../../send/application/ports/http-transport.port';
import { PKCE_METHOD } from './pkce';

/** What discovery produced: the issuer, and the flows it can run. */
export interface DiscoveredProvider {
  readonly issuer: string;
  readonly flows: readonly RunnableOAuthFlow[];
  readonly scopes: readonly string[];
}

function refuse(message: string, context: Record<string, unknown>): never {
  throw new AuthError(message, 'RUN_AUTH_FAILED', undefined, context);
}

/**
 * Whether a url may be fetched or sent a credential.
 *
 * HTTPS, OR HTTP ON A LOOPBACK HOST. The exception is not a convenience: an authorization server
 * running on a developer's own machine is the case this console is used in most, and `localhost`
 * is the one origin a browser already treats as a secure context.
 */
function isSecureUrl(url: URL): boolean {
  return isSecureCredentialUrl(url);
}

function parseUrl(value: string, what: string): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return refuse(`the discovery document's ${what} is not an absolute url`, { value, what });
  }

  if (!isSecureUrl(url)) {
    return refuse(
      `the discovery document's ${what} is not https, and a credential is not sent over http`,
      { value, what },
    );
  }

  return url;
}

function stringOf(record: Record<string, unknown>, name: string): string | undefined {
  const value = record[name];

  return typeof value === 'string' && value !== '' ? value : undefined;
}

function stringsOf(record: Record<string, unknown>, name: string): readonly string[] {
  const value = record[name];

  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/**
 * Builds the request for a discovery document.
 *
 * @param url - The `openIdConnectUrl` the document declares
 * @returns The request to send
 * @throws {AuthError} When the url is not an absolute https url
 *
 * @example
 * const plan = discoveryPlan('https://issuer.example/.well-known/openid-configuration');
 */
export function discoveryPlan(url: string): RequestPlan {
  const parsed = parseUrl(url, 'openIdConnectUrl');

  return {
    method: 'GET',
    url: parsed.toString(),
    headers: { Accept: 'application/json' },
    body: null,
    // A REDIRECT IS REFUSED RATHER THAN FOLLOWED, and this is the field that makes the refusal
    // possible: `manual` gives an opaque answer in a browser and the 3xx itself in Node, and both
    // are visible below. Following it would let any host that can answer the declared url name the
    // issuer, which is exactly the check underneath.
    redirect: 'manual',
  };
}

/**
 * Reads a discovery document, refusing every shape of it that is not one.
 *
 * @param requestedUrl - The url the document was asked for at
 * @param status - HTTP status of the answer
 * @param body - The answer's body, as text
 * @returns The issuer and its flows
 * @throws {AuthError} When the answer redirected, is not an object, names another issuer, or
 *         carries no usable endpoint
 *
 * @example
 * const provider = readDiscoveryDocument(url, 200, body);
 */
export function readDiscoveryDocument(
  requestedUrl: string,
  status: number,
  body: string,
): DiscoveredProvider {
  // STATUS 0 IS WHAT A BROWSER REPORTS FOR AN OPAQUE REDIRECT and a 3xx is what Node reports for
  // the same thing, so both are the same finding: the document is not where it was said to be.
  if (status === 0 || (status >= 300 && status < 400)) {
    refuse(
      'the OpenID discovery document answered with a redirect, which is refused: the host that ' +
        'answers must be the one the document named',
      { url: requestedUrl, status },
    );
  }

  if (status !== 200) {
    refuse(`the OpenID discovery document answered ${String(status)}`, {
      url: requestedUrl,
      status,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return refuse('the OpenID discovery document is not JSON', { url: requestedUrl });
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    refuse('the OpenID discovery document is not a JSON object', { url: requestedUrl });
  }

  const record = parsed as Record<string, unknown>;
  const issuer = stringOf(record, 'issuer');

  if (issuer === undefined) {
    refuse('the OpenID discovery document names no issuer', { url: requestedUrl });
  }

  const issuerUrl = parseUrl(issuer, 'issuer');
  const requested = new URL(requestedUrl);

  // THE HOST THAT ANSWERED IS THE HOST THE ISSUER NAMES, per RFC 8414 §3.3. Without this, a
  // document served from anywhere can claim to be an issuer and name its own endpoints, and the
  // reader's credential goes wherever it says. The check is the origin rather than the whole url,
  // because an issuer's endpoints legitimately live under different paths and real providers do
  // put them under different hosts once the document itself is trusted.
  if (issuerUrl.origin !== requested.origin) {
    refuse(
      `the OpenID discovery document was served from ${requested.origin} and claims to be the ` +
        `issuer ${issuerUrl.origin}, so it is refused`,
      { url: requestedUrl, issuer },
    );
  }

  const methods = stringsOf(record, 'code_challenge_methods_supported');
  if (methods.length > 0 && !methods.includes(PKCE_METHOD)) {
    refuse(
      `this provider advertises ${methods.join(', ')} and not ${PKCE_METHOD}; PKCE ${PKCE_METHOD} ` +
        'is mandatory here and is not negotiated down, so the authorization code flow is refused',
      { url: requestedUrl, methods: [...methods] },
    );
  }

  const authorization = stringOf(record, 'authorization_endpoint');
  const token = stringOf(record, 'token_endpoint');
  const device = stringOf(record, 'device_authorization_endpoint');
  const scopes = stringsOf(record, 'scopes_supported');

  if (authorization !== undefined) parseUrl(authorization, 'authorization_endpoint');
  if (token !== undefined) parseUrl(token, 'token_endpoint');
  if (device !== undefined) parseUrl(device, 'device_authorization_endpoint');

  const grants = stringsOf(record, 'grant_types_supported');
  const flows: RunnableOAuthFlow[] = [];

  const supports = (grant: string, fallback: boolean): boolean =>
    grants.length === 0 ? fallback : grants.includes(grant);

  if (authorization !== undefined && token !== undefined && supports('authorization_code', true)) {
    flows.push({
      kind: 'authorizationCode',
      authorizationUrl: authorization,
      tokenUrl: token,
      scopes,
    });
  }

  if (token !== undefined && supports('client_credentials', false)) {
    flows.push({ kind: 'clientCredentials', tokenUrl: token, scopes });
  }

  if (token !== undefined && supports('password', false)) {
    flows.push({ kind: 'password', tokenUrl: token, scopes });
  }

  if (device !== undefined && token !== undefined) {
    flows.push({
      kind: 'deviceAuthorization',
      deviceAuthorizationUrl: device,
      tokenUrl: token,
      scopes,
    });
  }

  if (flows.length === 0) {
    refuse(
      'the OpenID discovery document names no endpoint pair this console can run a flow with',
      { url: requestedUrl, issuer },
    );
  }

  return { issuer, flows, scopes };
}

/**
 * Fetches and reads a discovery document.
 *
 * @param url - The `openIdConnectUrl` the document declares
 * @param transport - The transport to fetch with
 * @returns The issuer and its flows
 * @throws {AuthError} When the document is unusable, for any of the reasons above
 *
 * @example
 * const provider = await discoverProvider(scheme.openIdConnectUrl, transport);
 */
export async function discoverProvider(
  url: string,
  transport: IHttpTransport,
): Promise<DiscoveredProvider> {
  const plan = discoveryPlan(url);
  const response = await transport.send(plan);

  return readDiscoveryDocument(plan.url, response.status, response.body);
}

/**
 * The token lifecycle of SPEC 14.4.1: what is held, for how long, and what a 401 causes.
 *
 * THE REFRESH TOKEN IS IN MEMORY AND NOWHERE ELSE, under every one of the four storage modes,
 * `local` included. The reason is the difference in lifetime rather than tidiness: an access token
 * lives minutes and its window of compromise closes by itself, a refresh token lives days and
 * presents the whole session. This page renders arbitrary markdown from somebody else's document,
 * and the sanitizer and the strict CSP exist so that rendering it is survivable; that is why we
 * come through it, not permission to widen the target.
 *
 * The consequence, written down so it is not later "fixed": under `session` and `local` a reload
 * keeps the access token and loses the refresh token, so when the access token expires the reader
 * is asked to sign in again. `local` plus a memory-only refresh token looks inconsistent and is
 * not: the reader asked for a short lived token to survive a closed tab, not for the long lived
 * bearer of the whole session to be handed to any script that ever runs on this origin.
 *
 * AND THERE IS NO TIMER HERE. Renewal happens when the reader pressed Send and the API answered
 * 401, and at no other moment. A page that sits open in a tab for hours quietly renewing a session
 * against somebody's production API, with nobody present, is not a documentation tool. The absence
 * is asserted by a test rather than described here.
 */

import { AuthError } from '@openref/core';
import type { IHttpTransport } from '../../../send/application/ports/http-transport.port';
import { base64UrlText } from '../../domain/base64';
import type { CredentialStorageMode, CredentialStore } from '../../domain/credentials';
import type { RunnableOAuthFlow } from '../../../request/domain/request-plan';
import { discoverProvider } from '../../domain/discovery';
import {
  authorizationUrl,
  clientCredentialsPlan,
  codeExchangePlan,
  deviceAuthorizationPlan,
  devicePollPlan,
  parseDeviceAuthorization,
  parseTokenResponse,
  passwordPlan,
  readAuthorizationCode,
  readImplicitToken,
  refreshPlan,
  REDIRECT_FLOWS,
  type CallbackParams,
  type DeviceAuthorization,
  type OAuthClient,
  type OAuthToken,
  type PendingAuthorization,
} from '../../domain/oauth';
import { createPkceChallenge, randomToken, type RandomBytes } from '../../domain/pkce';

/** Key the pending authorization is kept under, so a host page's own keys are never touched. */
export const PENDING_AUTHORIZATION_KEY = 'oref.oauth.pending';

/** What a renewal did, per the three outcomes of SPEC 14.4.1. */
export type RenewOutcome =
  /** A new access token is in place and the request may be retried once. */
  | { readonly kind: 'renewed' }
  /** The grant is dead. The session is over and the reader is asked to sign in again. */
  | { readonly kind: 'ended'; readonly message: string }
  /** Nothing is known. The session is untouched and the reader may try again. */
  | { readonly kind: 'failed'; readonly message: string };

/** What a sign in produced. */
export type SignInOutcome =
  | { readonly kind: 'signed-in' }
  /** The reader has to be sent to an authorization server, at this url. */
  | { readonly kind: 'redirect'; readonly url: string }
  /** The device flow started: show the code, then poll. */
  | { readonly kind: 'device'; readonly device: DeviceAuthorization };

/** What one scheme's session looks like to whatever draws it. */
export interface SessionStatus {
  readonly signedIn: boolean;
  /**
   * When the token endpoint's `expires_in` says the token runs out, in epoch milliseconds.
   *
   * AN ESTIMATE, NEVER A GATE. It is shown so that an expiry is visible before it bites, and it
   * is undefined after a reload even when the token survived, because the estimate lives in
   * memory with the refresh token. The authority on whether a token is alive is the API's 401.
   */
  readonly expiresAtMs?: number;
  /** Whether a 401 can be answered with a renewal rather than with a sign in. */
  readonly renewable: boolean;
}

/** What one scheme's session holds while the page is open. */
interface Session {
  readonly flow: RunnableOAuthFlow;
  readonly client: OAuthClient;
  /** IN MEMORY ONLY, WHATEVER THE STORAGE MODE IS. */
  readonly refreshToken?: string;
  readonly expiresAtMs?: number;
}

/** How the session service reaches the world outside it. */
export interface OAuthSessionOptions {
  readonly transport: IHttpTransport;
  /** The same store the typed credentials use, so the storage policy applies to access tokens. */
  readonly store: CredentialStore;
  readonly storage: CredentialStorageMode;
  /** Where a pending authorization waits out a full page redirect. */
  readonly pendingStorage?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
  readonly now?: () => number;
  readonly random?: RandomBytes;
  /** Waits between device polls. Injected so a test does not wait and can count what waited. */
  readonly wait?: (ms: number) => Promise<void>;
}

function refuse(message: string, context: Record<string, unknown>): never {
  throw new AuthError(message, 'RUN_AUTH_FAILED', undefined, context);
}

/**
 * Holds one session per security scheme, and decides what a 401 means.
 *
 * One instance per runner. The access token goes through {@link CredentialStore}, so it obeys the
 * storage mode the deployment chose and `off` retains nothing; everything else here is a field of
 * this object and dies with the page.
 */
export class OAuthSessionService {
  private readonly sessions = new Map<string, Session>();
  private readonly renewals = new Map<string, Promise<RenewOutcome>>();
  private readonly devices = new Map<string, DeviceAuthorization>();
  private readonly transport: IHttpTransport;
  private readonly store: CredentialStore;
  private readonly storage: CredentialStorageMode;
  private readonly pendingStorage: OAuthSessionOptions['pendingStorage'];
  private readonly now: () => number;
  private readonly random: RandomBytes | undefined;
  private readonly wait: (ms: number) => Promise<void>;

  /** @param options - The transport, the credential store and the sources of time and randomness */
  constructor(options: OAuthSessionOptions) {
    this.transport = options.transport;
    this.store = options.store;
    this.storage = options.storage;
    this.pendingStorage = options.pendingStorage;
    this.now = options.now ?? ((): number => Date.now());
    this.random = options.random;
    this.wait =
      options.wait ??
      ((ms: number): Promise<void> =>
        new Promise((resolve) => {
          setTimeout(resolve, ms);
        }));
  }

  /**
   * Reads what a scheme's session looks like.
   *
   * @param schemeId - Id of the security scheme
   * @returns Whether there is a token, when it is estimated to run out, and whether it can renew
   *
   * @example
   * const status = sessions.status('oauth');
   */
  status(schemeId: string): SessionStatus {
    const session = this.sessions.get(schemeId);
    const token = this.store.read(schemeId);

    return {
      signedIn: token !== undefined && token !== '',
      ...(session?.expiresAtMs === undefined ? {} : { expiresAtMs: session.expiresAtMs }),
      renewable: this.renewableWith(session) !== null,
    };
  }

  /**
   * Forgets everything about one scheme's session.
   *
   * @param schemeId - Id of the security scheme
   *
   * @example
   * sessions.signOut('oauth');
   */
  signOut(schemeId: string): void {
    this.sessions.delete(schemeId);
    this.devices.delete(schemeId);
    this.store.write(schemeId, '');
  }

  /**
   * Starts a flow.
   *
   * @param schemeId - Id of the security scheme
   * @param flow - The flow the reader chose
   * @param client - Client id, secret and scopes as the reader supplied them
   * @param redirect - Where the authorization server sends the reader back to, and where they were
   * @returns What the caller has to do next
   * @throws {AuthError} When the flow cannot be run as configured
   *
   * @example
   * const outcome = await sessions.signIn('oauth', flow, { clientId }, { redirectUri, returnPath });
   */
  async signIn(
    schemeId: string,
    flow: RunnableOAuthFlow,
    client: OAuthClient,
    redirect?: { readonly redirectUri: string; readonly returnPath: string },
  ): Promise<SignInOutcome> {
    if (REDIRECT_FLOWS.includes(flow.kind)) {
      return await this.beginRedirectFlow(schemeId, flow, client, redirect);
    }

    if (flow.kind === 'deviceAuthorization') {
      const response = await this.transport.send(deviceAuthorizationPlan(flow, client));
      const device = parseDeviceAuthorization(response.status, response.body);

      this.devices.set(schemeId, device);
      this.sessions.set(schemeId, { flow, client });

      return { kind: 'device', device };
    }

    const plan =
      flow.kind === 'password' ? passwordPlan(flow, client) : clientCredentialsPlan(flow, client);
    const response = await this.transport.send(plan);
    const outcome = parseTokenResponse(response.status, response.body);

    if (outcome.kind !== 'token') {
      refuse(
        this.signInFailureMessage(
          outcome.kind === 'pending' ? 'the token endpoint is still waiting' : outcome.message,
        ),
        {
          schemeId,
          flow: flow.kind,
        },
      );
    }

    this.accept(schemeId, flow, client, outcome.token);

    return { kind: 'signed-in' };
  }

  /**
   * Polls the token endpoint until the reader has approved the device, or until it is over.
   *
   * THE LOOP IS AWAITED BY THE CALLER AND STARTED BY A READER, which is what makes it different
   * from the background refresh SPEC 14.4.1 rules out. Nothing here survives the call: when it
   * returns, no timer is outstanding.
   *
   * @param schemeId - Id of the security scheme
   * @returns Nothing, once a token is in place
   * @throws {AuthError} When there is no device flow in progress, or it expired or was refused
   *
   * @example
   * await sessions.completeDeviceAuthorization('oauth');
   */
  async completeDeviceAuthorization(schemeId: string): Promise<void> {
    const device = this.devices.get(schemeId);
    const session = this.sessions.get(schemeId);

    if (device === undefined || session === undefined) {
      refuse('no device authorization is in progress for this scheme', { schemeId });
    }

    const deadline = this.now() + device.expiresInSeconds * 1000;
    let intervalMs = device.intervalSeconds * 1000;

    for (;;) {
      await this.wait(intervalMs);

      if (this.now() > deadline) {
        this.devices.delete(schemeId);
        refuse('the device code expired before it was approved; start the sign in again', {
          schemeId,
        });
      }

      const response = await this.transport.send(
        devicePollPlan(session.flow, session.client, device.deviceCode),
      );
      const outcome = parseTokenResponse(response.status, response.body);

      if (outcome.kind === 'token') {
        this.devices.delete(schemeId);
        this.accept(schemeId, session.flow, session.client, outcome.token);
        return;
      }

      if (outcome.kind === 'pending') {
        // `slow_down` IS AN INSTRUCTION AND IS OBEYED, per RFC 8628 §3.5: five more seconds each
        // time the server says so, rather than the same interval that just earned the complaint.
        if (outcome.slowDown) intervalMs += 5000;
        continue;
      }

      this.devices.delete(schemeId);
      refuse(outcome.message, { schemeId });
    }
  }

  /**
   * Runs discovery for an `openIdConnect` scheme.
   *
   * @param openIdConnectUrl - The url the document declares
   * @returns The flows the provider advertises
   * @throws {AuthError} When the document is unusable
   *
   * @example
   * const provider = await sessions.discover(scheme.openIdConnectUrl);
   */
  async discover(openIdConnectUrl: string): Promise<readonly RunnableOAuthFlow[]> {
    const provider = await discoverProvider(openIdConnectUrl, this.transport);

    return provider.flows;
  }

  /**
   * Finishes a flow the reader came back from, whichever of the two it was.
   *
   * @param params - The callback parameters, from the query string or the fragment
   * @returns Which scheme was signed in and where the reader was, or undefined when this page is
   *          not a callback at all
   * @throws {AuthError} When the answer does not match what was sent, or the exchange failed
   *
   * @example
   * const landed = await sessions.completeAuthorization(params);
   */
  async completeAuthorization(
    params: CallbackParams,
  ): Promise<{ readonly schemeId: string; readonly returnPath: string } | undefined> {
    const pending = this.readPending();
    if (pending === undefined) return undefined;

    this.clearPending();

    // THE RECORD IS THE AUTHORITY AND THE MAP IS THE SHORTCUT, per T035. A return happens on a page
    // that never ran `signIn`, so `sessions` is empty there and the record is all there is; the map
    // is still read first for the flows that never leave the page.
    const session = this.sessions.get(pending.schemeId);
    const flow = session?.flow ?? pending.runnableFlow;
    const client = session?.client ?? pending.client;

    if (flow === undefined || client === undefined) {
      refuse(
        'this page has no record of the flow that answer belongs to, so it is refused; sign in ' +
          'again from the console',
        { schemeId: pending.schemeId },
      );
    }

    // A SECRET CANNOT SURVIVE THE REDIRECT AND IS NOT MADE TO. Writing it beside the state in
    // `sessionStorage` would put a credential at rest for every script on this origin, which SPEC
    // 14.4 refuses; sending the exchange without it earns an `invalid_client` the reader would
    // read as the server's fault. So the reason is named here.
    if (pending.secretSupplied === true && (client.clientSecret ?? '') === '') {
      refuse(
        'this sign in used a client secret, and a secret is never written to storage, so it did ' +
          'not survive the redirect to the authorization server; use a public client with PKCE, ' +
          'which is what this console sends anyway, or the device flow, which never leaves the page',
        { schemeId: pending.schemeId, flow: pending.flow },
      );
    }

    if (pending.flow === 'implicit') {
      this.accept(pending.schemeId, flow, client, readImplicitToken(params, pending));

      return { schemeId: pending.schemeId, returnPath: pending.returnPath };
    }

    const code = readAuthorizationCode(params, pending);
    const response = await this.transport.send(
      codeExchangePlan(flow, client, {
        code,
        // NON NULL BECAUSE `readAuthorizationCode` REFUSED THE RECORD WITHOUT ONE. The check is
        // there rather than here so that a pending record with no verifier never reaches a
        // request that carries a code and no proof of possession.
        verifier: pending.verifier ?? '',
        redirectUri: pending.redirectUri,
      }),
    );
    const outcome = parseTokenResponse(response.status, response.body);

    if (outcome.kind !== 'token') {
      refuse(
        outcome.kind === 'pending'
          ? 'the token endpoint is still waiting, which an authorization code exchange never does'
          : outcome.message,
        { schemeId: pending.schemeId },
      );
    }

    this.accept(pending.schemeId, flow, client, outcome.token);

    return { schemeId: pending.schemeId, returnPath: pending.returnPath };
  }

  /**
   * Renews one scheme's session, once, however many callers ask at the same time.
   *
   * ONE RENEWAL FOR ALL CONCURRENT 401s, per SPEC 14.4.1. A documentation page sends several
   * requests in a row easily and they can all come back 401 together; the first starts the
   * renewal and the rest wait for its answer, so the token endpoint is called once and everybody
   * gets the same sentence when it fails.
   *
   * @param schemeId - Id of the security scheme
   * @returns Which of the three things happened
   *
   * @example
   * const outcome = await sessions.renew('oauth');
   */
  async renew(schemeId: string): Promise<RenewOutcome> {
    const inFlight = this.renewals.get(schemeId);
    if (inFlight !== undefined) return inFlight;

    const renewal = this.renewOnce(schemeId).finally(() => {
      this.renewals.delete(schemeId);
    });

    this.renewals.set(schemeId, renewal);

    return renewal;
  }

  private async renewOnce(schemeId: string): Promise<RenewOutcome> {
    const session = this.sessions.get(schemeId);
    const grant = this.renewableWith(session);

    if (session === undefined || grant === null) {
      return {
        kind: 'ended',
        message:
          'this session cannot be renewed silently, so the API answered 401 on an expired ' +
          'sign in; sign in again to continue',
      };
    }

    let response;
    try {
      response = await this.transport.send(
        grant === 'refresh'
          ? refreshPlan(session.flow, session.client, session.refreshToken ?? '')
          : grant === 'password'
            ? passwordPlan(session.flow, session.client)
            : clientCredentialsPlan(session.flow, session.client),
      );
    } catch (cause) {
      // A TRANSPORT FAILURE DOES NOT END A SESSION. The grant is not known to be dead; the packet
      // is known to be lost. Ending the session here is what makes a tool unusable on exactly the
      // networks where it is most needed.
      return {
        kind: 'failed',
        message: `the session could not be renewed: ${
          cause instanceof Error ? cause.message : 'the token endpoint could not be reached'
        }. The API answered 401. Try again.`,
      };
    }

    const outcome = parseTokenResponse(response.status, response.body);

    if (outcome.kind === 'token') {
      this.accept(schemeId, session.flow, session.client, outcome.token);

      return { kind: 'renewed' };
    }

    if (outcome.kind === 'grant-dead') {
      this.signOut(schemeId);

      return {
        kind: 'ended',
        message: `the session has ended: ${outcome.message}. Sign in again to continue.`,
      };
    }

    return {
      kind: 'failed',
      message: `${
        outcome.kind === 'pending'
          ? 'the token endpoint is still waiting for the reader to approve the sign in'
          : outcome.message
      }. The session is untouched and the API answered 401. Try again.`,
    };
  }

  /** Which grant can renew this session without the reader, or null when none can. */
  private renewableWith(session: Session | undefined): 'refresh' | 'password' | 'client' | null {
    if (session === undefined) return null;
    if ((session.refreshToken ?? '') !== '') return 'refresh';

    // `clientCredentials` AND `password` HOLD WHAT A TOKEN IS MADE FROM, so the one-shot rule of
    // SPEC 14.4.1 applies to them with the original grant in place of a refresh token. `implicit`
    // and a device flow with no refresh token have nothing to run again, and their only answer to
    // a 401 is to ask the reader to sign in.
    if (session.flow.kind === 'clientCredentials') return 'client';
    if (session.flow.kind === 'password' && (session.client.username ?? '') !== '')
      return 'password';

    return null;
  }

  private accept(
    schemeId: string,
    flow: RunnableOAuthFlow,
    client: OAuthClient,
    token: OAuthToken,
  ): void {
    this.store.write(schemeId, token.accessToken);

    this.sessions.set(schemeId, {
      flow,
      client,
      ...(token.refreshToken === undefined ? {} : { refreshToken: token.refreshToken }),
      ...(token.expiresInSeconds === undefined
        ? {}
        : { expiresAtMs: this.now() + token.expiresInSeconds * 1000 }),
    });
  }

  private signInFailureMessage(detail: string): string {
    return `signing in failed: ${detail}`;
  }

  private async beginRedirectFlow(
    schemeId: string,
    flow: RunnableOAuthFlow,
    client: OAuthClient,
    redirect?: { readonly redirectUri: string; readonly returnPath: string },
  ): Promise<SignInOutcome> {
    if (redirect === undefined) {
      refuse(
        `the ${flow.kind} flow sends the reader to an authorization server and needs a redirect ` +
          'uri to come back to, and none was supplied',
        { schemeId, flow: flow.kind },
      );
    }

    // A REDIRECT FLOW LEAVES THIS PAGE AND COMES BACK TO A NEW ONE, so the verifier and the state
    // have to outlive a reload, and under `memory` and `off` nothing may. This is refused rather
    // than quietly written to `sessionStorage` anyway: a mode in which almost nothing is retained
    // is not a mode, and the reader chose it.
    if (this.storage === 'memory' || this.storage === 'off') {
      refuse(
        `the ${flow.kind} flow leaves this page and returns to a new one, and storage is set to ` +
          `'${this.storage}', which retains nothing across that; use the device flow, or a ` +
          'storage mode that survives a reload',
        { schemeId, flow: flow.kind, storage: this.storage },
      );
    }

    // THE STATE CARRIES THE RETURN PATH AS WELL AS THE NONCE, and both halves have a job. The
    // nonce is what this page compares on the way back, so an answer to somebody else's request is
    // refused; the path is what the callback route sends the reader back to, and it travels here
    // because a redirect uri has to match the one registered with the provider exactly, and a
    // static build has no server to remember anything. The route validates the path before it
    // redirects, so this is not a way to make the callback an open redirector.
    const state = `${randomToken(this.random)}.${base64UrlText(redirect.returnPath)}`;
    const challenge = flow.kind === 'implicit' ? undefined : await createPkceChallenge(this.random);

    // THE SECRET IS STRIPPED HERE AND NOWHERE ELSE, so there is one place to read to know what
    // leaves this page. Everything else in the record is a public fact of the document or a value
    // this runner generated.
    const { clientSecret, ...publicClient } = client;
    const secretSupplied = (clientSecret ?? '') !== '';

    const pending: PendingAuthorization = {
      schemeId,
      flow: flow.kind,
      state,
      ...(challenge === undefined ? {} : { verifier: challenge.verifier }),
      redirectUri: redirect.redirectUri,
      returnPath: redirect.returnPath,
      runnableFlow: flow,
      client: publicClient,
      ...(secretSupplied ? { secretSupplied } : {}),
    };

    this.sessions.set(schemeId, { flow, client });
    this.writePending(pending);

    return {
      kind: 'redirect',
      url: authorizationUrl(flow, client, {
        redirectUri: redirect.redirectUri,
        state,
        ...(challenge === undefined ? {} : { challenge: challenge.challenge }),
      }),
    };
  }

  private writePending(pending: PendingAuthorization): void {
    this.pendingStorage?.setItem(PENDING_AUTHORIZATION_KEY, JSON.stringify(pending));
  }

  private clearPending(): void {
    this.pendingStorage?.removeItem(PENDING_AUTHORIZATION_KEY);
  }

  private readPending(): PendingAuthorization | undefined {
    const raw = this.pendingStorage?.getItem(PENDING_AUTHORIZATION_KEY) ?? null;
    if (raw === null) return undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.clearPending();
      return undefined;
    }

    if (typeof parsed !== 'object' || parsed === null) {
      this.clearPending();
      return undefined;
    }

    const record = parsed as Partial<PendingAuthorization>;
    if (typeof record.schemeId !== 'string' || typeof record.state !== 'string') {
      this.clearPending();
      return undefined;
    }

    // THE TWO FIELDS THE EXCHANGE NOW DEPENDS ON ARE CHECKED SHAPE-WISE, and a record that fails is
    // dropped rather than repaired: this store is writable by any script on the origin, so a
    // half-shaped record is either an older format or somebody else's, and neither is a flow to
    // continue. The refusal a dropped record produces is the same one an absent one produces.
    if (record.runnableFlow !== undefined && typeof record.runnableFlow.kind !== 'string') {
      this.clearPending();
      return undefined;
    }

    if (record.client !== undefined && typeof record.client.clientId !== 'string') {
      this.clearPending();
      return undefined;
    }

    return record as PendingAuthorization;
  }
}

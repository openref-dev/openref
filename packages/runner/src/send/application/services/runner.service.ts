/**
 * The runner itself: hold the credentials, build the request, send it, time it.
 *
 * THE RESULT CARRIES NO CREDENTIALS AND NO REQUEST. Status, headers, body and duration are what
 * the try-it panel of SPEC 14.1 shows, and they are all it gets. A result that also carried the
 * plan would carry the `Authorization` header into whatever renders it, and from there into a
 * page, a log or a screenshot.
 */

import { InvalidOptionsError } from '@openref/core';
import {
  OAuthSessionService,
  type RenewOutcome,
  type SessionStatus,
  type SignInOutcome,
} from '../../../auth/application/services/oauth-session.service';
import {
  CredentialStore,
  DEFAULT_CREDENTIAL_STORAGE,
  applyCredentials,
  type CredentialStorageMode,
  type KeyValueStorage,
} from '../../../auth/domain/credentials';
import type { CallbackParams, OAuthClient } from '../../../auth/domain/oauth';
import type { RandomBytes } from '../../../auth/domain/pkce';
import { DEFAULT_MAX_BODY_BYTES, type RunnerBody } from '../../../request/domain/body';
import {
  buildRequest,
  type RequestPlan,
  type RunnableOAuthFlow,
  type RunnableOperation,
} from '../../../request/domain/request-plan';
import type { RunnerValue } from '../../../request/domain/serialize';
import { FetchHttpTransport } from '../../infrastructure/adapters/fetch-transport.adapter';
import type { IHttpTransport } from '../ports/http-transport.port';
import {
  noStreamTransport,
  runStream,
  type StreamHandle,
  type StreamHandlers,
  type StreamRunOptions,
} from '../../../stream/application/services/stream.service';
import type { IStreamTransport } from '../../../stream/application/ports/stream-transport.port';

/**
 * Whether the rendered reference is reachable by anyone.
 *
 * `public` is the deployment where the page is on the open internet. It is the one where a
 * prefilled credential is not a convenience but a published secret, which is why the ban is at
 * the type level rather than in a runtime check somebody can be talked out of.
 */
export type RunnerVisibility = 'internal' | 'public';

/** Credentials supplied ahead of time, keyed by security scheme id. */
export type PrefilledCredentials = Readonly<Record<string, string>>;

/**
 * How a runner is configured.
 *
 * PREFILLING IS FORBIDDEN AT THE TYPE LEVEL UNDER `public` VISIBILITY, per SPEC 14.4. The
 * conditional member is what enforces it: with `visibility: 'public'` the `credentials` member
 * has type `never`, so writing one is a compile error at the call site rather than a review
 * comment. `runner-visibility.spec.ts` pins that with `@ts-expect-error`, and the constructor
 * drops the value as well, for a caller reaching this package from JavaScript.
 */
export type RunnerOptions<TVisibility extends RunnerVisibility = RunnerVisibility> = {
  readonly visibility: TVisibility;
  /** Where credentials are kept, per SPEC 14.4. Defaults to `session`. */
  readonly storage?: CredentialStorageMode;
  /** Backing storage, for a host that has its own or a test that wants a plain object. */
  readonly storageBacking?: KeyValueStorage;
  /** Transport, defaulting to `fetch` in direct mode. */
  readonly transport?: IHttpTransport;
  /**
   * What opens a stream, per SPEC 14.6.
   *
   * A SECOND TRANSPORT AND NOT A SECOND MODE OF THE FIRST. Sending returns a body and streaming
   * returns the pieces of one, so they are two ports; a runner given only the first answers a
   * request to stream by saying it has no stream transport, which is what keeps a console from
   * drawing a Stream button that does nothing.
   */
  readonly streamTransport?: IStreamTransport;
  /** Clock, so a test can measure a duration without waiting for one. */
  readonly now?: () => number;
  /**
   * How many bytes of request body the console will build, per SPEC 14.3.
   *
   * Defaults to {@link DEFAULT_MAX_BODY_BYTES}. A host whose endpoint takes larger uploads raises
   * it deliberately, which is the same shape as the response ceiling beside it.
   */
  readonly maxBodyBytes?: number;
  /**
   * Multipart boundary generator, called once per send that needs one.
   *
   * A FUNCTION AND NOT A VALUE, so every request gets its own and a test can pin one. The default
   * is random where a random source exists, because a boundary that repeats across sends is
   * harmless and a boundary that appears in a payload is not, and the encoder refuses that one.
   */
  readonly boundary?: () => string;
  /**
   * Where a pending authorization waits out a full page redirect, per SPEC 14.4.
   *
   * Defaults to `sessionStorage`. It holds a state nonce and a PKCE verifier, both of which are
   * single use and both of which are cleared the moment the reader comes back. Under `memory` and
   * `off` storage this is never written at all and a redirect flow is refused instead.
   */
  readonly pendingStorage?: KeyValueStorage;
  /** Random bytes for PKCE and `state`, so a test can pin them. There is no insecure default. */
  readonly random?: RandomBytes;
  /** Waits between device flow polls. Injected so a test does not wait for a real interval. */
  readonly wait?: (ms: number) => Promise<void>;
} & (TVisibility extends 'public'
  ? { readonly credentials?: never }
  : { readonly credentials?: PrefilledCredentials });

/** One response header, as the panel lists it. */
export interface RunHeader {
  readonly name: string;
  readonly value: string;
}

/**
 * Something about the session that the response alone does not say.
 *
 * A 401 WHOSE CAUSE IS AN EXPIRED SESSION IS NEVER A BARE STATUS CODE, per SPEC 14.4.1. That is
 * the moment a reader concludes the endpoint is broken, and a documentation tool that lets them
 * conclude it has blamed somebody else's API for its own silence. All three outcomes of a renewal
 * are reported, including the one where nothing went wrong.
 */
export interface RunNotice {
  readonly kind: 'renewed' | 'session-ended' | 'renew-failed';
  readonly message: string;
}

/** What came back, and how long it took. */
export interface RunResult {
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly RunHeader[];
  readonly body: string;
  /** Wall clock from the call to the body being read, in milliseconds. */
  readonly durationMs: number;
  /** What happened to the session while this request was being answered, when anything did. */
  readonly notice?: RunNotice;
}

/**
 * One send: which operation, against which server, with what typed into it.
 *
 * NAMED `RunnableSendInput` AND NOT `RunnerSendInput` SINCE 2026-09-02, AND THE RENAME IS THE
 * WHOLE POINT. `@openref/vue` publishes an interface called `RunnerSendInput` too, and the two
 * were not the same type: this one takes a {@link RunnableOperation}, that one takes a
 * `RunnerOperationView`, and the difference is not cosmetic. Measured with the compiler over both
 * published `.d.ts` files: a value of this type handed to `IRunnerPort.send` is rejected, because
 * `RunnableParameter` has no `valueKind` and `RunnerParameterView` requires one; a value of the
 * vue type handed here is accepted, because the view is the narrower of the two. So one name
 * covered a shape and a strict subtype of it, in two packages a consumer installs together, and
 * the compiler error did not even print the same name on both sides: `@openref/vue` re-exports
 * its copy through a content hashed chunk, so the message read `is not assignable to parameter of
 * type 's'`.
 *
 * THE VUE ONE IS THE CONTRACT AND THIS ONE IS THE REQUIREMENT, which is why this side moved. What
 * `IRunnerPort.send` names is what a console actually hands over; what this names is the least an
 * operation must carry for a plan to be built from it. The `Runnable` prefix is this package's own
 * family for that idea, `RunnableOperation`, `RunnableParameter`, `RunnableSecurityScheme`,
 * `RunnableStream`, and this interface is made of them.
 */
export interface RunnableSendInput {
  readonly operation: RunnableOperation;
  readonly serverUrl: string;
  /** Parameter values keyed by `${location}:${name}`, absent when the reader filled nothing in. */
  readonly values: Readonly<Record<string, RunnerValue>>;
  /** What the reader supplied for the body, in one of the three forms of SPEC 14.3. */
  readonly body?: RunnerBody;
  readonly mediaType?: string;
}

/**
 * The M0 request runner.
 *
 * Credentials live here rather than travelling in the send call, so nothing above the runner
 * ever holds one. A component reads a value back to prefill its own field and writes one when
 * the reader types; neither is a prop, a page model field or part of a rendered page.
 */
export class RequestRunner {
  private readonly store: CredentialStore;
  private readonly transport: IHttpTransport;
  private readonly streamTransport: IStreamTransport | undefined;
  private readonly now: () => number;
  private readonly maxBodyBytes: number;
  private readonly boundary: () => string;
  private readonly sessions: OAuthSessionService;

  /** @param options - Visibility, storage and the transport to send with */
  constructor(options: RunnerOptions) {
    const storage = options.storage ?? DEFAULT_CREDENTIAL_STORAGE;
    const pendingStorage = options.pendingStorage ?? sessionStorageBacking();

    this.store = new CredentialStore(storage, options.storageBacking);
    this.transport = options.transport ?? new FetchHttpTransport();
    // NOT DEFAULTED THE WAY THE SEND TRANSPORT IS, and the asymmetry is deliberate. A console
    // that cannot send is broken; a console that cannot stream is a console over a document with
    // no streaming operation in it, which is most of them. Whoever composes the runner decides,
    // and `@openref/nest` supplies one because the page it serves has a Stream control.
    this.streamTransport = options.streamTransport;
    this.now = options.now ?? ((): number => Date.now());
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    this.boundary = options.boundary ?? randomBoundary;
    this.sessions = new OAuthSessionService({
      transport: this.transport,
      store: this.store,
      storage,
      now: this.now,
      ...(pendingStorage === null ? {} : { pendingStorage }),
      ...(options.random === undefined ? {} : { random: options.random }),
      ...(options.wait === undefined ? {} : { wait: options.wait }),
    });

    // The type gate above is the contract. This is the same rule enforced once more for a
    // caller with no types, and it drops the values rather than throwing: a reference that
    // refused to start because of a configuration mistake would take the documentation down.
    if (options.visibility !== 'public') {
      for (const [schemeId, value] of Object.entries(options.credentials ?? {})) {
        this.store.write(schemeId, value);
      }
    }
  }

  /**
   * Reads the stored credential for one scheme.
   *
   * @param schemeId - Id of the security scheme
   * @returns The value, or undefined when there is none
   */
  credential(schemeId: string): string | undefined {
    return this.store.read(schemeId);
  }

  /**
   * Stores the credential for one scheme. An empty value clears it.
   *
   * @param schemeId - Id of the security scheme
   * @param value - The credential as the reader typed it
   */
  setCredential(schemeId: string, value: string): void {
    this.store.write(schemeId, value);
  }

  /**
   * Builds and sends one request.
   *
   * @param input - Operation, server and what the reader typed
   * @returns Status, headers, body and duration
   * @throws {SerializationError} When the request cannot be built faithfully
   * @throws {AuthError} When a required scheme is outside the M0 subset
   * @throws {RunnerError} When the request never reached a server
   * @throws {InvalidOptionsError} When the operation declares no server to send to
   *
   * @example
   * const result = await runner.send({ operation, serverUrl, values: { 'path:id': '42' } });
   */
  async send(input: RunnableSendInput): Promise<RunResult> {
    if (input.operation.servers.length === 0) {
      throw new InvalidOptionsError(
        'the document declares no server, so there is nowhere to send this request',
        'CONFIG_INVALID_OPTIONS',
        undefined,
        { nodeId: input.operation.nodeId },
      );
    }

    // THE BOUNDARY IS DRAWN ONCE PER SEND AND REUSED BY THE RETRY. A retry is the same request
    // asked again, and a second boundary would make the two differ in a byte the reader never
    // chose, which is exactly what the plan comparison tests exist to notice.
    const boundary = this.boundary();
    const started = this.now();
    const response = await this.transport.send(this.planFor(input, boundary));

    if (response.status !== 401) {
      return this.resultOf(response, this.now() - started);
    }

    // A 401 IS THE API'S ANSWER UNLESS THIS RUNNER HAS A SESSION THAT COULD HAVE EXPIRED. An
    // operation sent with no credential, or with a key the reader typed, gets its 401 shown as
    // what it is: there is no session to blame and nothing to renew.
    const schemeId = this.renewableSchemeOf(input.operation);
    if (schemeId === undefined) {
      return this.resultOf(response, this.now() - started);
    }

    const outcome = await this.sessions.renew(schemeId);

    if (outcome.kind !== 'renewed') {
      return {
        ...this.resultOf(response, this.now() - started),
        notice: {
          kind: outcome.kind === 'ended' ? 'session-ended' : 'renew-failed',
          message: outcome.message,
        },
      };
    }

    // ONE REFRESH AND ONE RETRY, NEVER A LOOP, per SPEC 14.4.1. The retry is safe because the
    // request that carried the expired token was not performed on the other side. Whatever this
    // second answer is, including another 401, it is the API's and it is shown as the API's: the
    // token was issued a moment ago, and offering a sign in here would blame the session for a
    // decision the server made.
    const retried = await this.transport.send(this.planFor(input, boundary));

    return {
      ...this.resultOf(retried, this.now() - started),
      notice: {
        kind: 'renewed',
        message: 'the access token had expired, so the session was renewed and the request resent',
      },
    };
  }

  /**
   * Opens a streaming response and reports its elements as they arrive.
   *
   * @param input - Operation, server and what the reader typed
   * @param handlers - Where elements and the ending are reported
   * @returns A way to stop it, and a promise for how it ended
   * @throws {RunnerError} When this runner was built with no stream transport
   * @throws {InvalidOptionsError} When the operation declares no stream, or no server
   *
   * @example
   * const stream = runner.stream(input, { onElement: show });
   */
  stream(input: RunnableSendInput, handlers: StreamHandlers): StreamHandle {
    const transport = this.streamTransport;
    if (transport === undefined) throw noStreamTransport();

    const declared = input.operation.stream;
    if (declared === undefined) {
      throw new InvalidOptionsError(
        'this operation is not declared as a stream, so there is nothing to watch',
        'CONFIG_INVALID_OPTIONS',
        undefined,
        { nodeId: input.operation.nodeId },
      );
    }

    if (input.operation.servers.length === 0) {
      throw new InvalidOptionsError(
        'the document declares no server, so there is nowhere to open this stream',
        'CONFIG_INVALID_OPTIONS',
        undefined,
        { nodeId: input.operation.nodeId },
      );
    }

    // NO RENEW AND NO RETRY ON THIS PATH, WHICH IS A DECISION RATHER THAN AN OMISSION. The send
    // path retries a 401 once because the request it retries was never performed on the other
    // side. A stream that has already delivered elements has been performed, and resending it
    // would replay them; a stream refused with 401 before any element ends as `refused`, with the
    // status where the reader can see it.
    const options: StreamRunOptions = {
      format: declared.format,
      ...(declared.terminator === undefined ? {} : { terminator: declared.terminator }),
      ...(declared.itemSchema === undefined ? {} : { itemSchema: declared.itemSchema }),
    };

    return runStream(this.planFor(input, this.boundary()), options, handlers, { transport });
  }

  /**
   * Starts a sign in for one scheme.
   *
   * @param schemeId - Id of the security scheme
   * @param flow - The flow the reader chose
   * @param client - Client id, secret and scopes as the reader supplied them
   * @param redirect - Where an authorization server sends the reader back to, and where they were
   * @returns Whether the reader is signed in, has to be redirected, or has a device code to enter
   * @throws {AuthError} When the flow cannot be run as configured
   *
   * @example
   * const outcome = await runner.signIn('oauth', flow, { clientId: 'console' });
   */
  async signIn(
    schemeId: string,
    flow: RunnableOAuthFlow,
    client: OAuthClient,
    redirect?: { readonly redirectUri: string; readonly returnPath: string },
  ): Promise<SignInOutcome> {
    return this.sessions.signIn(schemeId, flow, client, redirect);
  }

  /**
   * Polls a device flow until the reader has approved it.
   *
   * @param schemeId - Id of the security scheme
   * @returns Nothing, once a token is in place
   * @throws {AuthError} When no device flow is in progress, or it expired or was refused
   *
   * @example
   * await runner.completeDeviceAuthorization('oauth');
   */
  async completeDeviceAuthorization(schemeId: string): Promise<void> {
    return this.sessions.completeDeviceAuthorization(schemeId);
  }

  /**
   * Finishes a redirect flow the reader has come back from.
   *
   * @param params - The callback parameters, from the query string or the fragment
   * @returns Which scheme was signed in and where the reader was, or undefined when nothing was
   *          pending on this page
   * @throws {AuthError} When the answer does not match what was sent, or the exchange failed
   *
   * @example
   * const landed = await runner.completeAuthorization(params);
   */
  async completeAuthorization(
    params: CallbackParams,
  ): Promise<{ readonly schemeId: string; readonly returnPath: string } | undefined> {
    return this.sessions.completeAuthorization(params);
  }

  /**
   * Reads the flows an `openIdConnect` scheme's provider advertises.
   *
   * @param openIdConnectUrl - The url the document declares
   * @returns The flows it can run
   * @throws {AuthError} When the discovery document is unusable
   *
   * @example
   * const flows = await runner.discover(scheme.openIdConnectUrl);
   */
  async discover(openIdConnectUrl: string): Promise<readonly RunnableOAuthFlow[]> {
    return this.sessions.discover(openIdConnectUrl);
  }

  /**
   * Reads one scheme's session.
   *
   * @param schemeId - Id of the security scheme
   * @returns Whether there is a token, when it is estimated to run out, and whether it can renew
   *
   * @example
   * const status = runner.sessionStatus('oauth');
   */
  sessionStatus(schemeId: string): SessionStatus {
    return this.sessions.status(schemeId);
  }

  /**
   * Forgets one scheme's session, token and all.
   *
   * @param schemeId - Id of the security scheme
   *
   * @example
   * runner.signOut('oauth');
   */
  signOut(schemeId: string): void {
    this.sessions.signOut(schemeId);
  }

  /**
   * Renews one scheme's session without waiting for a 401.
   *
   * Exposed for the console's own sign in path rather than for a timer. Nothing in this package
   * calls it on a schedule, and SPEC 14.4.1 says why.
   *
   * @param schemeId - Id of the security scheme
   * @returns Which of the three things happened
   *
   * @example
   * const outcome = await runner.renew('oauth');
   */
  async renew(schemeId: string): Promise<RenewOutcome> {
    return this.sessions.renew(schemeId);
  }

  private planFor(input: RunnableSendInput, boundary: string): RequestPlan {
    const credentials: Record<string, string> = {};
    for (const scheme of input.operation.security) {
      const value = this.store.read(scheme.id);
      if (value !== undefined) credentials[scheme.id] = value;
    }

    return buildRequest(
      input.operation,
      {
        values: input.values,
        serverUrl: input.serverUrl,
        maxBodyBytes: this.maxBodyBytes,
        boundary,
        ...(input.body === undefined ? {} : { body: input.body }),
        ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
      },
      applyCredentials(input.operation.security, credentials),
    );
  }

  /** The first scheme of this operation whose session could be renewed rather than retyped. */
  private renewableSchemeOf(operation: RunnableOperation): string | undefined {
    for (const scheme of operation.security) {
      if (scheme.type !== 'oauth2' && scheme.type !== 'openIdConnect') continue;
      if (this.sessions.status(scheme.id).signedIn) return scheme.id;
    }

    return undefined;
  }

  private resultOf(
    response: {
      status: number;
      statusText: string;
      headers: readonly (readonly [string, string])[];
      body: string;
    },
    durationMs: number,
  ): RunResult {
    return {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers.map(([name, value]) => ({ name, value })),
      body: response.body,
      durationMs,
    };
  }
}

/**
 * The session storage a pending authorization waits in, when there is one.
 *
 * `sessionStorage` AND NOT THE MODE'S OWN STORE. What waits here is a state nonce and a single use
 * PKCE verifier, not a credential, and it has to survive exactly one redirect. Under `memory` and
 * `off` the session service refuses the flow before this is ever written to.
 */
function sessionStorageBacking(): KeyValueStorage | null {
  const candidate = (globalThis as { sessionStorage?: unknown }).sessionStorage;
  if (candidate === null || typeof candidate !== 'object') return null;

  const store = candidate as Partial<KeyValueStorage>;

  return typeof store.getItem === 'function' && typeof store.setItem === 'function'
    ? (candidate as KeyValueStorage)
    : null;
}

/**
 * A multipart boundary nothing else will be carrying.
 *
 * FROM THE PLATFORM'S RANDOM SOURCE WHERE THERE IS ONE, AND A COUNTER WHERE THERE IS NOT. The
 * boundary is not a secret and does not have to be unguessable; what it has to be is absent from
 * the payloads, and the encoder refuses the body rather than trusting this either way. A runtime
 * with no `crypto` still sends multipart bodies, which a throw here would take away.
 */
let boundaryCounter = 0;

function randomBoundary(): string {
  const source = (
    globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }
  ).crypto;

  if (source?.getRandomValues !== undefined) {
    const bytes = source.getRandomValues(new Uint8Array(12));

    return `OpenRefFormBoundary${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }

  boundaryCounter += 1;

  return `OpenRefFormBoundary${String(boundaryCounter).padStart(12, '0')}`;
}

/**
 * Creates a runner, inferring the visibility from the literal so the type gate applies.
 *
 * @param options - Visibility, storage and the transport to send with
 * @returns The runner
 *
 * @example
 * const runner = createRunner({ visibility: 'public' });
 */
export function createRunner<TVisibility extends RunnerVisibility>(
  options: RunnerOptions<TVisibility>,
): RequestRunner {
  return new RequestRunner(options);
}

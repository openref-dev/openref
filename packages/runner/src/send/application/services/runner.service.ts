/**
 * The runner itself: hold the credentials, build the request, send it, time it.
 *
 * THE RESULT CARRIES NO CREDENTIALS AND NO REQUEST. Status, headers, body and duration are what
 * the try-it panel of SPEC 14.1 shows, and they are all it gets. A result that also carried the
 * plan would carry the `Authorization` header into whatever renders it, and from there into a
 * page, a log or a screenshot.
 */

import { ErrorCode, InvalidOptionsError } from '@openref/core';
import {
  CredentialStore,
  DEFAULT_CREDENTIAL_STORAGE,
  applyCredentials,
  type CredentialStorageMode,
  type KeyValueStorage,
} from '../../../auth/domain/credentials';
import { buildRequest, type RunnableOperation } from '../../../request/domain/request-plan';
import { FetchHttpTransport } from '../../infrastructure/adapters/fetch-transport.adapter';
import type { IHttpTransport } from '../ports/http-transport.port';

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
  /** Clock, so a test can measure a duration without waiting for one. */
  readonly now?: () => number;
} & (TVisibility extends 'public'
  ? { readonly credentials?: never }
  : { readonly credentials?: PrefilledCredentials });

/** One response header, as the panel lists it. */
export interface RunHeader {
  readonly name: string;
  readonly value: string;
}

/** What came back, and how long it took. */
export interface RunResult {
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly RunHeader[];
  readonly body: string;
  /** Wall clock from the call to the body being read, in milliseconds. */
  readonly durationMs: number;
}

/** One send: which operation, against which server, with what typed into it. */
export interface RunnerSendInput {
  readonly operation: RunnableOperation;
  readonly serverUrl: string;
  /** Parameter values keyed by `${location}:${name}`. */
  readonly values: Readonly<Record<string, string>>;
  /** Request body as typed. */
  readonly body?: string;
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
  private readonly now: () => number;

  /** @param options - Visibility, storage and the transport to send with */
  constructor(options: RunnerOptions) {
    this.store = new CredentialStore(
      options.storage ?? DEFAULT_CREDENTIAL_STORAGE,
      options.storageBacking,
    );
    this.transport = options.transport ?? new FetchHttpTransport();
    this.now = options.now ?? ((): number => Date.now());

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
  async send(input: RunnerSendInput): Promise<RunResult> {
    if (input.operation.servers.length === 0) {
      throw new InvalidOptionsError(
        'the document declares no server, so there is nowhere to send this request',
        ErrorCode.CONFIG_INVALID_OPTIONS,
        undefined,
        { nodeId: input.operation.nodeId },
      );
    }

    const credentials: Record<string, string> = {};
    for (const scheme of input.operation.security) {
      const value = this.store.read(scheme.id);
      if (value !== undefined) credentials[scheme.id] = value;
    }

    const plan = buildRequest(
      input.operation,
      {
        values: input.values,
        serverUrl: input.serverUrl,
        ...(input.body === undefined ? {} : { body: input.body }),
        ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
      },
      applyCredentials(input.operation.security, credentials),
    );

    const started = this.now();
    const response = await this.transport.send(plan);
    const durationMs = this.now() - started;

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

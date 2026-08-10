/**
 * The direct mode transport: the browser's own `fetch`, straight to the server.
 *
 * `direct` is the only mode in M0, per SPEC 14.1. It means the request is subject to the API's
 * CORS policy exactly as any other page's request would be, which is a property rather than a
 * limitation: nothing in this package can reach a host the browser would not let the page
 * reach. The same origin proxy of SPEC 14.5, which can, is M2 and is a second adapter.
 *
 * `fetch` is named structurally rather than through the DOM lib, for the reason `shared/dom.ts`
 * in the renderer gives: this package compiles in the server program, where the DOM types are
 * deliberately out of scope, and a transport that cannot be constructed there is fine while a
 * package that will not compile there is not.
 */

import { ErrorCode, RunnerError } from '@openref/core';
import type { RequestPlan } from '../../../request/domain/request-plan';
import type {
  IHttpTransport,
  TransportResponse,
} from '../../application/ports/http-transport.port';

/** What `fetch` returns, reduced to what this adapter reads. */
export interface FetchResponseLike {
  readonly status: number;
  readonly statusText: string;
  readonly headers: { forEach(callback: (value: string, key: string) => void): void };
  text(): Promise<string>;
}

/** What `fetch` is, reduced to how this adapter calls it. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    redirect?: 'follow';
    credentials?: 'omit';
  },
) => Promise<FetchResponseLike>;

/** How the adapter finds its `fetch`. */
export interface FetchTransportOptions {
  /** The implementation to call. Defaults to the global `fetch`. */
  readonly fetch?: FetchLike;
}

function globalFetch(): FetchLike | null {
  const candidate = (globalThis as { fetch?: unknown }).fetch;

  return typeof candidate === 'function' ? (candidate as FetchLike) : null;
}

/** Sends a request with `fetch` and reads the whole body. */
export class FetchHttpTransport implements IHttpTransport {
  private readonly fetch: FetchLike | null;

  /** @param options - The `fetch` to use, defaulting to the global one */
  constructor(options: FetchTransportOptions = {}) {
    this.fetch = options.fetch ?? globalFetch();
  }

  /**
   * @param plan - The request as `buildRequest` resolved it
   * @returns What the server answered
   * @throws {RunnerError} When there is no `fetch`, or when the request never reached a server
   */
  async send(plan: RequestPlan): Promise<TransportResponse> {
    const send = this.fetch;
    if (send === null) {
      throw new RunnerError(
        'no fetch implementation is available, so the try-it console cannot send anything',
        ErrorCode.RUN_NOT_AVAILABLE,
      );
    }

    let response: FetchResponseLike;
    try {
      response = await send(plan.url, {
        method: plan.method,
        headers: { ...plan.headers },
        // Credentials are carried by the headers this runner built, never by ambient cookies.
        // Sending the reader's session cookies to a third party API would be an authenticated
        // request nobody asked for, which is exactly the shape of a CSRF.
        credentials: 'omit',
        ...(plan.body === null ? {} : { body: plan.body }),
      });
    } catch (cause) {
      throw new RunnerError(
        'the request did not reach a server; the host may be unreachable or may refuse this origin',
        ErrorCode.RUN_NOT_AVAILABLE,
        cause instanceof Error ? cause : undefined,
        { url: plan.url },
      );
    }

    const headers: (readonly [string, string])[] = [];
    response.headers.forEach((value, key) => {
      headers.push([key, value]);
    });

    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      body: await response.text(),
    };
  }
}

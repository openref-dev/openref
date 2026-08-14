/**
 * The Express half of SPEC 23's "both adapters".
 *
 * A reply is written through the Node response API, `statusCode`, `setHeader` and `end`,
 * rather than through Express's own `status().send()`. Express's response object extends
 * `http.ServerResponse`, so those three exist in Express 4 and Express 5 alike, which is the
 * span NestJS 10 and 11 cover between them. `send` is where the two versions differ in what
 * they infer about a body, and there is nothing here to infer: every reply already carries
 * its own content type.
 */

import { readRequestBody } from '../../domain/request-body';
import { readNestedString, readStringRecord } from '../../domain/request-shape';
import { failureReply, type ErrorReporter } from '../../domain/reply';
import type {
  IReferenceHttpAdapter,
  ReferenceHandler,
  ReferenceReply,
} from '../../application/ports/reference-http.port';
import type { HttpAdapterLike } from '../../../shared/types/nest-surface';

/** Where a helmet integration leaves a nonce on an Express response. */
const NONCE_PATHS: readonly (readonly string[])[] = [
  ['locals', 'cspNonce'],
  ['locals', 'nonce'],
];

/** How a host tells this package what nonce it generated for a response. */
export type NonceReader = (request: unknown, reply: unknown) => string | undefined;

/** How an adapter is built. */
export interface ReferenceAdapterOptions {
  /** Host supplied nonce lookup, tried before the helmet conventions. */
  readonly nonce?: NonceReader;
  /** Where an unexpected failure is reported. Nothing is written anywhere without one. */
  readonly onError?: ErrorReporter;
}

/** The subset of a Node response a reply is written through. */
interface ServerResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(chunk: string | Uint8Array): unknown;
}

/**
 * Reports whether a value can be written to as a Node response.
 *
 * @param value - Whatever the framework passed
 * @returns True when it carries the members a reply is written through
 */
function isServerResponse(value: unknown): value is ServerResponseLike {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;

  return typeof candidate.setHeader === 'function' && typeof candidate.end === 'function';
}

/**
 * Writes one reply to an Express response.
 *
 * @param reply - Framework response
 * @param response - What to write
 * @returns True when it was written, false when the object was not a response at all
 */
export function writeExpressReply(reply: unknown, response: ReferenceReply): boolean {
  if (!isServerResponse(reply)) return false;

  reply.statusCode = response.status;
  for (const [name, value] of Object.entries(response.headers)) reply.setHeader(name, value);
  reply.end(response.body);

  return true;
}

/** Registers the route table on an Express based NestJS application. */
export class ExpressReferenceAdapter implements IReferenceHttpAdapter {
  readonly kind = 'express';

  /**
   * @param adapter - The NestJS http adapter to register routes on
   * @param options - Nonce lookup and error reporting
   */
  constructor(
    private readonly adapter: HttpAdapterLike,
    private readonly options: ReferenceAdapterOptions = {},
  ) {}

  /** @inheritdoc */
  get(pattern: string, handler: ReferenceHandler): void {
    this.adapter.get(pattern, (request: unknown, reply: unknown): void => {
      this.answer(handler, request, reply, null);
    });
  }

  /** @inheritdoc */
  post(pattern: string, handler: ReferenceHandler): void {
    this.adapter.post(pattern, (request: unknown, reply: unknown): void => {
      this.answer(handler, request, reply, readRequestBody(request));
    });
  }

  /**
   * Runs one handler and writes what it answered.
   *
   * @param handler - What answers the route
   * @param request - Framework request
   * @param reply - Framework response
   * @param body - The body being read, or null on a route that takes none
   */
  private answer(
    handler: ReferenceHandler,
    request: unknown,
    reply: unknown,
    body: Promise<string> | null,
  ): void {
    const nonce = this.nonceOf(request, reply);

    void (body ?? Promise.resolve(null))
      .then((text) =>
        handler({
          params: readStringRecord(request, 'params'),
          headers: readStringRecord(request, 'headers'),
          query: readStringRecord(request, 'query'),
          ...(nonce === undefined ? {} : { nonce }),
          ...(text === null ? {} : { body: text }),
        }),
      )
      .then((response) => writeExpressReply(reply, response))
      .catch((cause: unknown) => {
        this.options.onError?.(cause);
        writeExpressReply(reply, failureReply());
      });
  }

  /**
   * Finds the nonce for one response.
   *
   * @param request - Framework request
   * @param reply - Framework response
   * @returns The nonce, or undefined when the host serves no nonce policy
   */
  private nonceOf(request: unknown, reply: unknown): string | undefined {
    const supplied = this.options.nonce?.(request, reply);
    if (supplied !== undefined) return supplied;

    for (const path of NONCE_PATHS) {
      const found = readNestedString(reply, path);
      if (found !== undefined) return found;
    }

    return undefined;
  }
}
